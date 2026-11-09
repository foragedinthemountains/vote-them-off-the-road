// Public-member auth is separate from the Cloudflare Access admin dashboard.
// Clerk is OPTIONAL. No public sign-in is offered without explicit configuration.
// This module has no dependencies so the existing Wrangler ESM Worker can bundle it.
const SITE_ORIGIN = "https://votethemofftheroad.com";
let schemaCache = {until:0,ready:false};
const jwksCache = new Map();
export async function ownershipSchemaReady(env) {
  if(!env.DB)return false;
  if(schemaCache.until>Date.now())return schemaCache.ready;
  try{
    const row=await env.DB.prepare(
      "SELECT id FROM ownership_migration_complete WHERE id=1").first();
    if(!row)throw Error("Ownership migration inactive");
    await env.DB.prepare("SELECT incident_id FROM incident_ownership LIMIT 0").all();
    await env.DB.prepare("SELECT voter_key_hash FROM account_voter_links LIMIT 0").all();
    await env.DB.prepare("SELECT incident_id FROM incident_author_edits LIMIT 0").all();
    schemaCache={until:Date.now()+30000,ready:true};
  }catch{
    schemaCache={until:Date.now()+30000,ready:false};
  }
  return schemaCache.ready;
}
export async function publicAccountsReady(env){
  return !!(env.CLERK_PUBLISHABLE_KEY && env.CLERK_ISSUER &&
    await ownershipSchemaReady(env));
}
function fromB64Url(input) {
  if(typeof input!=="string"||input.length>12000||!/^[A-Za-z0-9_-]+$/.test(input))
    throw Error("Invalid JWT encoding");
  const raw=atob(input.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(input.length/4)*4,"="));
  return Uint8Array.from(raw,ch=>ch.charCodeAt(0));
}
function parsePart(text,maxBytes=4096){
  const bytes=fromB64Url(text);
  if(bytes.byteLength>maxBytes)throw Error("JWT part too large");
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function fetchKeys(issuer,force=false){
  const cached=jwksCache.get(issuer);
  if(!force&&cached?.until>Date.now())return cached.keys;
  const url=new URL(issuer);
  if(url.protocol!=="https:"||url.username||url.password||url.pathname!=="/"||
     url.search||url.hash)throw Error("Invalid authentication issuer configuration");
  const response=await fetch(issuer.replace(/\/$/,"")+"/.well-known/jwks.json");
  if(!response.ok)throw Error("Unable to retrieve authentication signing keys");
  const body=await response.json();
  const keys=Array.isArray(body.keys)?body.keys.filter(k=>
    k?.kty==="RSA"&&k.alg==="RS256"&&typeof k.kid==="string"&&
    typeof k.n==="string"&&typeof k.e==="string"&&
    (!k.use||k.use==="sig")):[];
  if(!keys.length)throw Error("No valid authentication signing keys");
  jwksCache.set(issuer,{keys,until:Date.now()+5*60*1000});
  return keys;
}
export async function getPublicAccountUser(request,env){
  const auth=request.headers.get("Authorization")||"";
  if(!auth)return null; // guest mode is always permitted for public posting
  if(!(await publicAccountsReady(env)))
    throw Error("Public accounts have not been activated yet");
  if(auth.length>12000||!/^Bearer [A-Za-z0-9_.-]+$/.test(auth))
    throw Error("Invalid sign-in token");
  const raw=auth.slice(7),pieces=raw.split(".");
  if(pieces.length!==3)throw Error("Invalid sign-in token");
  const header=parsePart(pieces[0],2048),claims=parsePart(pieces[1],8192);
  const issuer=String(env.CLERK_ISSUER).replace(/\/$/,"");
  const now=Math.floor(Date.now()/1000);
  if(header.alg!=="RS256"||typeof header.kid!=="string"||header.kid.length>128||
    claims.iss!==issuer||typeof claims.sub!=="string"||
    !/^user_[A-Za-z0-9]{6,128}$/.test(claims.sub)||
    typeof claims.sid!=="string"||!/^sess_[A-Za-z0-9]{6,128}$/.test(claims.sid)||
    !Number.isSafeInteger(claims.exp)||claims.exp<=now-30||
    (claims.nbf!==undefined&&(!Number.isSafeInteger(claims.nbf)||claims.nbf>now+30))||
    (claims.iat!==undefined&&(!Number.isSafeInteger(claims.iat)||claims.iat>now+30))||
    (claims.azp!==undefined&&claims.azp!==SITE_ORIGIN)||
    (env.CLERK_AUDIENCE && !(
      Array.isArray(claims.aud)?claims.aud.includes(env.CLERK_AUDIENCE):
        claims.aud===env.CLERK_AUDIENCE)))
    throw Error("Sign-in token claims not accepted");
  let keys=await fetchKeys(issuer);
  let signingKey=keys.find(k=>k.kid===header.kid);
  if(!signingKey){
    keys=await fetchKeys(issuer,true);
    signingKey=keys.find(k=>k.kid===header.kid);
  }
  if(!signingKey)throw Error("Unrecognized signing key");
  const key=await crypto.subtle.importKey("jwk",{
    kty:"RSA",n:signingKey.n,e:signingKey.e,alg:"RS256",ext:true},
    {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  const valid=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,
    fromB64Url(pieces[2]),new TextEncoder().encode(pieces[0]+"."+pieces[1]));
  if(!valid)throw Error("Invalid authentication signature");
  return {userId:claims.sub};
}
export async function hashManagementToken(token){
  if(typeof token!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(token))
    return null;
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
export function createManagementToken(){
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
}
