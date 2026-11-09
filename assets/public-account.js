"use strict";
// Optional public WorkOS AuthKit integration for a static HTML/JS site.
// This loads nothing from the provider until WORKOS_CLIENT_ID is configured
// and the ownership schema is fully activated. Guest mode never needs sign-in.
// SDK version is pinned to avoid unreviewed automatic dependency updates.
(() => {
  const SDK_URL="https://cdn.jsdelivr.net/npm/@workos-inc/authkit-js@0.20.4/+esm";
  const REDIRECT_URI="https://votethemofftheroad.com/nh/account/";
  const state={enabled:false,client:null,error:null};
  const ready=(async()=>{
    try{
      const response=await fetch("/api/account/config",{
        cache:"no-store",credentials:"same-origin",
        headers:{Accept:"application/json"}
      });
      if(!response.ok)return state;
      const config=await response.json();
      if(!config.enabled || typeof config.client_id!=="string")return state;
      if(!/^client_[A-Za-z0-9]{8,128}$/.test(config.client_id))
        throw Error("Account client ID is invalid");
      const {createClient}=await import(SDK_URL);
      if(typeof createClient!=="function")
        throw Error("WorkOS AuthKit SDK is unavailable");
      // The SDK handles OAuth PKCE, callback processing and token refresh.
      const client=await createClient(config.client_id,{
        redirectUri:REDIRECT_URI,
        onRedirectCallback:()=>{
          window.dispatchEvent(new Event("vtor:account-signed-in"));
        }
      });
      state.client=client;
      state.enabled=true;
      window.dispatchEvent(new Event("vtor:accounts-ready"));
    }catch(error){
      state.error=error?.message||"WorkOS authentication unavailable";
    }
    return state;
  })();
  async function getToken(){
    await ready;
    if(!state.enabled||!state.client?.getUser())return null;
    return await state.client.getAccessToken();
  }
  async function fetchAuthenticated(path,options={}){
    const token=await getToken();
    if(!token)throw Error("Please sign in to manage your account.");
    const headers=new Headers(options.headers||{});
    headers.set("Authorization","Bearer "+token);
    const response=await fetch(path,{
      ...options,headers,cache:"no-store",credentials:"same-origin"
    });
    const result=await response.json().catch(()=>({error:"Unexpected response"}));
    if(!response.ok)throw Error(result.error||"Account request failed");
    return result;
  }
  function getUser(){return state.client?.getUser()||null;}
  async function signIn(){
    await ready;
    if(!state.enabled)throw Error("Public sign-in isn't enabled yet");
    return state.client.signIn();
  }
  async function signUp(){
    await ready;
    if(!state.enabled)throw Error("Public registration isn't enabled yet");
    return state.client.signUp();
  }
  async function signOut(){
    await ready;
    if(!state.enabled||!getUser())return;
    return state.client.signOut({returnTo:REDIRECT_URI});
  }
  window.VTORAccounts={
    ready,state,getUser,signIn,signUp,signOut,getToken,fetchAuthenticated
  };
})();
