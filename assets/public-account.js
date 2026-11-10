"use strict";
// The Worker owns WorkOS session exchange and refresh. No browser SDK, API key,
// or refresh token is exposed to JavaScript. Access tokens stay in memory only.
(() => {
  const state={enabled:false,user:null,error:null};
  let token=null,expiry=0,loading=null,lastSessionCheck=0;
  async function session(force=false) {
    if(loading)return loading;
    if(!force && token && Date.now()<expiry-30000)return token;
    // Guest browsers are anonymous by design. Avoid checking the login API
    // on every public jury read when there is no signed-in account.
    if(!force && !token && Date.now()-lastSessionCheck<60000)return null;
    loading=(async()=>{
      const response=await fetch("/api/auth/session",{
        method:"GET",credentials:"same-origin",cache:"no-store",
        headers:{Accept:"application/json"}
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(data.error||"Could not check your session.");
      state.user=data.signed_in?data.user:null;
      token=data.signed_in?data.access_token:null;
      expiry=data.signed_in&&Number.isSafeInteger(data.expires_at)?
        data.expires_at*1000:0;
      lastSessionCheck=Date.now();
      return token;
    })();
    try{return await loading;}finally{loading=null;}
  }
  const ready=(async()=>{
    try{
      const response=await fetch("/api/account/config",{
        cache:"no-store",credentials:"same-origin",
        headers:{Accept:"application/json"}
      });
      if(!response.ok)return state;
      const config=await response.json();
      if(config.enabled!==true || config.provider!=="workos")return state;
      state.enabled=true;
      await session();
    }catch(error){
      state.error=error?.message||"Sign-in is temporarily unavailable";
    }
    return state;
  })();
  async function getToken(){
    await ready;
    if(!state.enabled)return null;
    return session();
  }
  async function fetchAuthenticated(path,options={}){
    let current=await getToken();
    if(!current)throw Error("Please sign in to manage your account.");
    for(let attempt=0;attempt<2;attempt++){
      const headers=new Headers(options.headers||{});
      headers.set("Authorization","Bearer "+current);
      const response=await fetch(path,{
        ...options,headers,cache:"no-store",credentials:"same-origin"
      });
      if(response.status===401 && attempt===0){
        current=await session(true);
        if(current)continue;
      }
      const data=await response.json().catch(()=>({error:"Unexpected response"}));
      if(!response.ok)throw Error(data.error||"Account request failed");
      return data;
    }
    throw Error("Please sign in again.");
  }
  async function juryFetch(path,options={}){
    // Every public jury request is still usable anonymously. Signed-in
    // requests carry a short-lived WorkOS bearer so the Worker can recognize
    // the same juror across devices; refresh credentials remain HttpOnly.
    await ready;
    const send=async(force=false)=>{
      const access=state.enabled?await session(force).catch(error=>{
        // A temporary auth outage must not block guest voting. But if the
        // user was known signed in, never silently cast their vote as guest.
        if(state.user)throw error;
        return null;
      }):null;
      const headers=new Headers(options.headers||{});
      if(access)headers.set("Authorization","Bearer "+access);
      else headers.delete("Authorization");
      return fetch(path,{...options,headers,
        credentials:"same-origin",cache:"no-store"});
    };
    let response=await send();
    if(response.status===401 && token){
      response=await send(true);
    }
    return response;
  }
  function getUser(){return state.user;}
  async function signIn(){
    await ready;
    if(!state.enabled)throw Error("Public sign-in isn't enabled yet");
    location.assign("/api/auth/start?mode=signin");
  }
  async function signUp(){
    await ready;
    if(!state.enabled)throw Error("Public registration isn't enabled yet");
    location.assign("/api/auth/start?mode=signup");
  }
  async function signOut(){
    await ready;
    if(!state.enabled)return;
    const response=await fetch("/api/auth/logout",{
      method:"POST",credentials:"same-origin",cache:"no-store",
      headers:{"Accept":"application/json","Content-Type":"application/json"},
      body:"{}"
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(data.error||"Could not sign out.");
    token=null;expiry=0;state.user=null;
    // Only navigate to the fixed WorkOS logout host or our account page.
    const target=new URL(data.logout_url||"/nh/account/",location.origin);
    if(target.origin!=="https://api.workos.com"&&target.origin!==location.origin)
      throw Error("Invalid sign-out redirect.");
    location.assign(target.href);
  }
  window.VTORAccounts={
    ready,state,getUser,signIn,signUp,signOut,getToken,fetchAuthenticated,juryFetch
  };
})();
