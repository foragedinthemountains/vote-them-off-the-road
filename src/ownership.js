// Public-member authentication, separate from Cloudflare Access admins.
// WorkOS AuthKit is optional. Guest voting, posting and management need no account.
// All stored ownership uses INTERNAL Vote Them Off the Road member IDs.
const WORKOS_ISSUER="https://api.workos.com";
const JWKS_ROOT="https://api.workos.com/sso/jwks/";
let schemaCache={until:0,ready:false};
const jwksCache=new Map();
export async function ownershipSchemaReady(env){
  if(!env.DB)return false;
  if(schemaCache.until>Date.now())return schemaCache.ready;
  try{
    const marker=await env.DB.prepare(
      "SELECT id FROM ownership_migration_complete WHERE id=1"
    ).first();
    if(!marker)throw Error("Ownership migration incomplete");
    await env.DB.prepare("SELECT id FROM public_members LIMIT 0").all();
    await env.DB.prepare("SELECT incident_id FROM incident_ownership LIMIT 0").all();
    await env.DB.prepare("SELECT voter_key_hash FROM account_voter_links LIMIT 0").all();
    await env.DB.prepare("SELECT incident_id FROM incident_author_edits LIMIT 0").all();
    schemaCache={ready:true,until:Date.now()+30000};
  }catch{
    schemaCache={ready:false,until:Date.now()+30000};
  }
  return schemaCache.ready;
}
function workosClientId(env){
  const id=String(env.WORKOS_CLIENT_ID||"");
  return /^client_[A-Za-z0-9]{8,128}$/.test(id)?id:null;
}
export async function publicAccountsReady(env){
  return !!(workosClientId(env) && await ownershipSchemaReady(env));
}
function fromB64Url(part){
  if(typeof part!=="string"||part.length>12000||!/^[A-Za-z0-9_-]+$/.test(part))
    throw Error("Malformed authentication token");
  const binary=atob(part.replace(/-/g,"+").replace(/_/g,"/")
    .padEnd(Math.ceil(part.length/4)*4,"="));
  return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
function parsePart(part,maxBytes){
  const bytes=fromB64Url(part);
  if(bytes.byteLength>maxBytes)throw Error("Authentication token too large");
  const obj=JSON.parse(new TextDecoder().decode(bytes));
  if(!obj||typeof obj!=="object"||Array.isArray(obj))
    throw Error("Invalid authentication token");
  return obj;
}
async function getWorkosKeys(clientId,force=false){
  const cached=jwksCache.get(clientId);
  if(!force && cached && cached.until>Date.now())return cached.keys;
  const response=await fetch(JWKS_ROOT+encodeURIComponent(clientId),{
    headers:{Accept:"application/json"}
  });
  if(!response.ok)throw Error("Auth signing keys unavailable");
  const jwks=await response.json();
  const keys=(Array.isArray(jwks.keys)?jwks.keys:[]).filter(k=>
    k?.kty==="RSA" && (!k.alg || k.alg==="RS256") &&
    typeof k.kid==="string" && k.kid.length<=128 &&
    typeof k.n==="string" && typeof k.e==="string" &&
    (!k.use || k.use==="sig")
  );
  if(!keys.length)throw Error("No compatible WorkOS signing keys");
  jwksCache.set(clientId,{keys,until:Date.now()+300000});
  return keys;
}
async function verifiedWorkosSubject(token,clientId){
  const parts=token.split(".");
  if(parts.length!==3)throw Error("Malformed authentication token");
  const header=parsePart(parts[0],2048);
  const claims=parsePart(parts[1],8192);
  const now=Math.floor(Date.now()/1000);
  // WorkOS session JWTs contain "client_id", not Clerk's "azp" or "aud".
  // Only the exact WorkOS project we configured may issue member sessions.
  if(header.alg!=="RS256" || typeof header.kid!=="string" ||
     (header.typ && header.typ!=="JWT") ||
     String(claims.iss||"").replace(/\/$/,"")!==WORKOS_ISSUER ||
     claims.client_id!==clientId ||
     typeof claims.sub!=="string" ||
     !/^user_[A-Za-z0-9]{8,128}$/.test(claims.sub) ||
     typeof claims.sid!=="string" ||
     !/^session_[A-Za-z0-9]{8,128}$/.test(claims.sid) ||
     !Number.isSafeInteger(claims.exp) || claims.exp<=now-30 ||
     !Number.isSafeInteger(claims.iat) || claims.iat>now+30 ||
     (claims.nbf!==undefined &&
       (!Number.isSafeInteger(claims.nbf)||claims.nbf>now+30)) ||
     claims.act!==undefined)
    throw Error("Authentication token claims rejected");
  let keys=await getWorkosKeys(clientId);
  let jwk=keys.find(k=>k.kid===header.kid);
  if(!jwk){
    keys=await getWorkosKeys(clientId,true);
    jwk=keys.find(k=>k.kid===header.kid);
  }
  if(!jwk)throw Error("Unknown WorkOS signing key");
  const publicKey=await crypto.subtle.importKey("jwk",{
    kty:"RSA",n:jwk.n,e:jwk.e,alg:"RS256",ext:true
  },{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  const signed=new TextEncoder().encode(parts[0]+"."+parts[1]);
  const valid=await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",publicKey,fromB64Url(parts[2]),signed
  );
  if(!valid)throw Error("Invalid WorkOS token signature");
  return claims.sub;
}
async function findOrCreateInternalMember(env,subject){
  const select=()=>env.DB.prepare(
    "SELECT id FROM public_members WHERE provider='workos' AND provider_subject=?"
  ).bind(subject).first();
  const existing=await select();
  if(existing?.id)return existing.id;
  // Unique(provider,provider_subject) protects parallel first sign-ins.
  await env.DB.prepare(
    "INSERT OR IGNORE INTO public_members(id,provider,provider_subject) "+
    "VALUES(?,'workos',?)"
  ).bind(crypto.randomUUID(),subject).run();
  const created=await select();
  if(!created?.id)throw Error("Unable to initialize member account");
  return created.id;
}
export async function getPublicAccountUser(request,env){
  const header=request.headers.get("Authorization")||"";
  if(!header)return null; // absence of auth = guest, never a forced login
  const clientId=workosClientId(env);
  if(!clientId || !(await publicAccountsReady(env)))
    throw Error("Public accounts aren't configured");
  if(header.length>12000 || !/^Bearer [A-Za-z0-9_.-]+$/.test(header))
    throw Error("Invalid account authorization");
  const providerSubject=await verifiedWorkosSubject(header.slice(7),clientId);
  const userId=await findOrCreateInternalMember(env,providerSubject);
  return {userId,provider:"workos"};
}
export async function hashManagementToken(token){
  if(typeof token!=="string" || !/^[A-Za-z0-9_-]{43}$/.test(token))return null;
  const digest=await crypto.subtle.digest(
    "SHA-256",new TextEncoder().encode(token)
  );
  return [...new Uint8Array(digest)]
    .map(b=>b.toString(16).padStart(2,"0")).join("");
}
export function createManagementToken(){
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
}
