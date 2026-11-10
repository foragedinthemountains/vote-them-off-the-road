// Server-managed WorkOS AuthKit session for a Cloudflare Worker.
// The browser receives an HttpOnly, AES-GCM sealed cookie. Only the Worker
// handles WorkOS authorization codes, API secrets, and refresh tokens.
import {ownershipSchemaReady, getPublicAccountUser} from "./ownership.js";

const ORIGIN = "https://votethemofftheroad.com";
const ACCOUNT_URL = ORIGIN + "/nh/account/";
const WORKOS_API = "https://api.workos.com";
const SESSION_COOKIE = "__Host-vtor_session";
const FLOW_COOKIE = "__Host-vtor_oauth";
const SESSION_TTL = 7 * 24 * 60 * 60; // App cookie ceiling; WorkOS may end sooner.
const FLOW_TTL = 10 * 60;
const NO_STORE = {"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer"};

function safeClientId(env) {
  const value = String(env.WORKOS_CLIENT_ID || "");
  return /^client_[A-Za-z0-9]{8,128}$/.test(value) ? value : null;
}
function validKeyString(env) {
  return typeof env.WORKOS_SESSION_KEY === "string" &&
    /^[0-9a-fA-F]{64}$/.test(env.WORKOS_SESSION_KEY);
}
function validWorkosApiKey(env) {
  // WorkOS guarantees a sk_ prefix; its remaining shape is not restricted
  // to the sk_live_/sk_test_ examples used in some integrations.
  return typeof env.WORKOS_API_KEY === "string" &&
    /^sk_[A-Za-z0-9_-]{10,}$/.test(env.WORKOS_API_KEY);
}
export async function authReadiness(env) {
  const checks = {
    client_id_valid: Boolean(safeClientId(env)),
    session_key_valid: validKeyString(env),
    workos_api_key_valid: validWorkosApiKey(env),
    ownership_schema_ready: await ownershipSchemaReady(env)
  };
  return {enabled:Object.values(checks).every(Boolean),checks};
}
export async function authConfigReady(env) {
  return (await authReadiness(env)).enabled;
}
function randomB64(bytesCount=32) {
  const bytes = crypto.getRandomValues(new Uint8Array(bytesCount));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-")
    .replace(/\//g,"_").replace(/=/g,"");
}
function bytesFromHex(hex) {
  const bytes = new Uint8Array(32);
  for(let i=0;i<32;i++) bytes[i]=parseInt(hex.slice(i*2,i*2+2),16);
  return bytes;
}
function b64url(bytes) {
  let result = "";
  for(let i=0;i<bytes.length;i++) result+=String.fromCharCode(bytes[i]);
  return btoa(result).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
}
function unB64url(text) {
  if(!/^[A-Za-z0-9_-]+$/.test(text) || text.length>6000) throw Error("Invalid seal");
  const binary = atob(text.replace(/-/g,"+").replace(/_/g,"/")
    .padEnd(Math.ceil(text.length/4)*4,"="));
  return Uint8Array.from(binary,char=>char.charCodeAt(0));
}
async function aesKey(env) {
  if(!validKeyString(env)) throw Error("Session encryption key is not configured");
  return crypto.subtle.importKey("raw",bytesFromHex(env.WORKOS_SESSION_KEY),
    {name:"AES-GCM"},false,["encrypt","decrypt"]);
}
async function seal(env,payload) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=new TextEncoder().encode(JSON.stringify(payload));
  const encrypted=new Uint8Array(await crypto.subtle.encrypt(
    {name:"AES-GCM",iv},await aesKey(env),data));
  const result=new Uint8Array(iv.length+encrypted.length);
  result.set(iv);result.set(encrypted,iv.length);
  const value=b64url(result);
  if(value.length>3800) throw Error("Session is too large for a cookie");
  return value;
}
async function unseal(env,value) {
  if(!value || typeof value!=="string") return null;
  try{
    const payload=unB64url(value);
    if(payload.length<29) return null;
    const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:payload.slice(0,12)},
      await aesKey(env),payload.slice(12));
    const result=JSON.parse(new TextDecoder().decode(plain));
    return result && typeof result==="object" && !Array.isArray(result) ? result : null;
  }catch {return null;}
}
function getCookie(request,name) {
  const cookie=request.headers.get("Cookie")||"";
  for(const segment of cookie.split(";")){
    const piece=segment.trim();
    if(piece.startsWith(name+"="))return piece.slice(name.length+1);
  }
  return null;
}
function cookie(name,value,age) {
  return name+"="+value+"; Path=/; Max-Age="+age+
    "; Secure; HttpOnly; SameSite=Lax";
}
function responseHeaders(setCookies=[]) {
  const headers=new Headers(NO_STORE);
  for(const item of setCookies)headers.append("Set-Cookie",item);
  return headers;
}
function redirect(target, cookies=[]) {
  const headers=responseHeaders(cookies);
  headers.set("Location",target);
  return new Response(null,{status:303,headers});
}
function failure(msg,status=503,cookies=[]) {
  return Response.json({error:msg},{status,headers:responseHeaders(cookies)});
}
function jwtClaims(accessToken) {
  const parts=String(accessToken||"").split(".");
  if(parts.length!==3)return null;
  try{
    const data=unB64url(parts[1]);
    return JSON.parse(new TextDecoder().decode(data));
  }catch{return null;}
}
function validSessionShape(s) {
  return !!s && typeof s==="object" &&
    typeof s.access==="string" && s.access.length<8000 &&
    typeof s.refresh==="string" && s.refresh.length<2000 &&
    s.user && typeof s.user.id==="string" &&
    /^user_[A-Za-z0-9]{8,128}$/.test(s.user.id) &&
    typeof s.user.email==="string" && s.user.email.length<260 &&
    Number.isSafeInteger(s.expiresAt) &&
    Number.isSafeInteger(s.createdAt);
}
async function validatedAccess(env,token,expectedUserId) {
  const claims=jwtClaims(token);
  if(!claims || claims.sub!==expectedUserId ||
    !Number.isSafeInteger(claims.exp) || claims.exp<=Date.now()/1000)
    throw Error("Invalid WorkOS access token");
  // Reuse the existing JWKS signature and issuer verification. Internal
  // VTOR user IDs are allocated only after this verification succeeds.
  const fake={headers:new Headers({Authorization:"Bearer "+token})};
  const identity=await getPublicAccountUser(fake,env);
  if(!identity?.userId)throw Error("Identity could not be verified");
  return claims.exp;
}
async function workosExchange(env,body) {
  const reply=await fetch(WORKOS_API+"/user_management/authenticate",{
    method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},
    body:JSON.stringify({client_id:safeClientId(env),
      client_secret:env.WORKOS_API_KEY,...body}),
    signal:AbortSignal.timeout(10000)
  });
  const data=await reply.json().catch(()=>({}));
  return {ok:reply.ok,status:reply.status,data};
}
function createAppSession(data,expiresAt,previous=null) {
  if(typeof data.access_token!=="string" ||
     typeof data.refresh_token!=="string" ||
     typeof data.user?.id!=="string")
    throw Error("WorkOS returned an incomplete session");
  const user={
    id:data.user.id,
    email:typeof data.user.email==="string"?data.user.email:"",
  };
  const s={access:data.access_token,refresh:data.refresh_token,user,
    expiresAt,createdAt:previous?.createdAt||Math.floor(Date.now()/1000)};
  if(!validSessionShape(s))throw Error("WorkOS session is malformed");
  return s;
}
function sameSiteAction(request) {
  const site=request.headers.get("Sec-Fetch-Site");
  return request.headers.get("Origin")===ORIGIN &&
    (!site || site==="same-origin");
}
export async function authStart(request,env) {
  if(request.method!=="GET")return failure("Method not allowed",405);
  if(!(await authConfigReady(env)))return failure("Sign-in is not configured",503);
  const url=new URL(request.url);
  const signUp=url.searchParams.get("mode")==="signup";
  const verifier=randomB64(),state=randomB64();
  const challenge=b64url(new Uint8Array(await crypto.subtle.digest(
    "SHA-256",new TextEncoder().encode(verifier))));
  const authUrl=new URL(WORKOS_API+"/user_management/authorize");
  authUrl.searchParams.set("response_type","code");
  authUrl.searchParams.set("provider","authkit");
  authUrl.searchParams.set("client_id",safeClientId(env));
  authUrl.searchParams.set("redirect_uri",ACCOUNT_URL);
  authUrl.searchParams.set("state",state);
  authUrl.searchParams.set("code_challenge_method","S256");
  authUrl.searchParams.set("code_challenge",challenge);
  if(signUp)authUrl.searchParams.set("screen_hint","sign-up");
  const value=await seal(env,{state,verifier,issuedAt:Date.now()});
  return redirect(authUrl.toString(),[cookie(FLOW_COOKIE,value,FLOW_TTL)]);
}
export async function authCallback(request,env) {
  if(request.method!=="GET")return failure("Method not allowed",405);
  const url=new URL(request.url);
  const flowCookie=getCookie(request,FLOW_COOKIE);
  const clearFlow=cookie(FLOW_COOKIE,"",0);
  const errorRedirect=()=>redirect(ACCOUNT_URL+"?auth=failed",[clearFlow]);
  if(!(await authConfigReady(env)))return errorRedirect();
  if(url.searchParams.get("error"))return errorRedirect();
  const code=url.searchParams.get("code"),state=url.searchParams.get("state");
  if(!code || code.length>1000 || !state || state.length>200) return errorRedirect();
  const flow=await unseal(env,flowCookie);
  if(!flow || !/^[A-Za-z0-9_-]{43}$/.test(flow.state||"") ||
     !/^[A-Za-z0-9_-]{43}$/.test(flow.verifier||"") ||
     !Number.isSafeInteger(flow.issuedAt) ||
     Math.abs(Date.now()-flow.issuedAt)>FLOW_TTL*1000 ||
     state!==flow.state) return errorRedirect();
  try{
    const result=await workosExchange(env,{
      grant_type:"authorization_code",code,code_verifier:flow.verifier
    });
    if(!result.ok)return errorRedirect();
    const userId=result.data?.user?.id;
    const expiresAt=await validatedAccess(env,result.data.access_token,userId);
    const session=createAppSession(result.data,expiresAt);
    const encrypted=await seal(env,session);
    return redirect(ACCOUNT_URL+"?auth=signed-in",[
      clearFlow,cookie(SESSION_COOKIE,encrypted,SESSION_TTL)
    ]);
  }catch(error){
    console.error("WorkOS callback error",error?.message||"unknown");
    return errorRedirect();
  }
}
export async function authSession(request,env) {
  if(request.method!=="GET")return failure("Method not allowed",405);
  if(!(await authConfigReady(env)))return failure("Sign-in is not configured",503);
  const raw=getCookie(request,SESSION_COOKIE);
  const session=await unseal(env,raw);
  const clearSession=cookie(SESSION_COOKIE,"",0);
  if(!validSessionShape(session))
    return Response.json({signed_in:false},{headers:responseHeaders(raw?[clearSession]:[])});
  const now=Math.floor(Date.now()/1000);
  if(session.createdAt>now+60 || session.createdAt<now-SESSION_TTL)
    return Response.json({signed_in:false},{headers:responseHeaders([clearSession])});
  const claims=jwtClaims(session.access);
  // The sealed cookie can't be modified by a visitor, but an expired access
  // token still needs to be rotated at WorkOS before it can be reused.
  if(claims?.sub===session.user.id && session.expiresAt>now+60 &&
     claims.exp===session.expiresAt) {
    return Response.json({signed_in:true,user:session.user,
      access_token:session.access,expires_at:session.expiresAt},
      {headers:responseHeaders()});
  }
  try{
    const result=await workosExchange(env,{
      grant_type:"refresh_token",refresh_token:session.refresh
    });
    if(!result.ok){
      const terminal=result.status===400 && result.data?.code==="invalid_grant";
      if(terminal)
        return Response.json({signed_in:false},{headers:responseHeaders([clearSession])});
      return failure("Sign-in service temporarily unavailable. Retry shortly.",503);
    }
    const expiresAt=await validatedAccess(env,result.data.access_token,session.user.id);
    // Refresh rotates the token: preserve the new token immediately.
    const renewed=createAppSession(result.data,expiresAt,session);
    const encrypted=await seal(env,renewed);
    return Response.json({signed_in:true,user:renewed.user,
      access_token:renewed.access,expires_at:renewed.expiresAt},
      {headers:responseHeaders([cookie(SESSION_COOKIE,encrypted,SESSION_TTL)])});
  }catch(error){
    console.error("WorkOS refresh error",error?.message||"unknown");
    return failure("Sign-in service temporarily unavailable. Retry shortly.",503);
  }
}
export async function authLogout(request,env) {
  if(request.method!=="POST")return failure("Method not allowed",405);
  if(!sameSiteAction(request))return failure("Invalid request origin",403);
  const session=await unseal(env,getCookie(request,SESSION_COOKIE));
  let logoutUrl=ACCOUNT_URL;
  if(validSessionShape(session)){
    const claims=jwtClaims(session.access);
    const sid=claims?.sub===session.user.id?claims.sid:null;
    if(typeof sid==="string" && /^session_[A-Za-z0-9]{8,128}$/.test(sid)){
      const u=new URL(WORKOS_API+"/user_management/sessions/logout");
      u.searchParams.set("session_id",sid);
      u.searchParams.set("return_to",ACCOUNT_URL);
      logoutUrl=u.toString();
    }
  }
  return Response.json({ok:true,logout_url:logoutUrl},
    {headers:responseHeaders([cookie(SESSION_COOKIE,"",0),
      cookie(FLOW_COOKIE,"",0)])});
}
