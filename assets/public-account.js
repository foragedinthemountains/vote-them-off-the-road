"use strict";
// Optional Clerk sign-in. If the site owner has not configured Clerk and
// activated migration 0006, this never loads a third-party authentication SDK.
(() => {
  const state={enabled:false,clerk:null,error:null};
  function script(url,attributes={}){
    return new Promise((resolve,reject)=>{
      const element=document.createElement("script");
      element.src=url;element.async=true;element.crossOrigin="anonymous";
      for(const [name,value] of Object.entries(attributes))
        element.setAttribute(name,value);
      element.onload=resolve;
      element.onerror=()=>reject(Error("Account sign-in could not be loaded."));
      document.head.append(element);
    });
  }
  const ready=(async()=>{
    try{
      const response=await fetch("/api/account/config",{credentials:"same-origin",cache:"no-store"});
      if(!response.ok)return state;
      const settings=await response.json();
      if(!settings.enabled||typeof settings.publishable_key!=="string")return state;
      const key=settings.publishable_key;
      if(!/^pk_(test|live)_[a-zA-Z0-9_-]+$/.test(key))
        throw Error("Account provider key invalid");
      const part=key.replace(/^pk_(test|live)_/,"");
      const host=atob(part.replace(/-/g,"+").replace(/_/g,"/")
        .padEnd(Math.ceil(part.length/4)*4,"=")).replace(/\$$/,"");
      // Clerk's publishable key identifies its instance-specific frontend host.
      if(!/^[a-z0-9.-]+$/i.test(host)||!host.includes(".")||
         host.includes("..")||
         !(host.endsWith(".clerk.accounts.dev")||
           host==="clerk.votethemofftheroad.com"))
        throw Error("Account frontend host isn't a configured Clerk domain");
      await script("https://"+host+"/npm/@clerk/ui@1/dist/ui.browser.js");
      await script("https://"+host+"/npm/@clerk/clerk-js@6/dist/clerk.browser.js",
        {"data-clerk-publishable-key":key});
      if(!window.Clerk)throw Error("Clerk SDK did not initialize");
      await window.Clerk.load({ui:{ClerkUI:window.__internal_ClerkUICtor}});
      state.clerk=window.Clerk;
      state.enabled=true;
      window.dispatchEvent(new CustomEvent("vtor:accounts-ready"));
    }catch(error){
      state.error=error?.message||"Sign-in unavailable";
    }
    return state;
  })();
  async function getToken(){
    await ready;
    if(!state.enabled||!state.clerk?.isSignedIn)return null;
    return (await state.clerk.session?.getToken())||null;
  }
  async function fetchAuthenticated(path,options={}){
    const token=await getToken();
    if(!token)throw Error("Please sign in to manage your account.");
    const headers=new Headers(options.headers||{});
    headers.set("Authorization","Bearer "+token);
    const response=await fetch(path,{...options,headers,credentials:"same-origin",cache:"no-store"});
    const result=await response.json().catch(()=>({error:"Unexpected response"}));
    if(!response.ok)throw Error(result.error||"Account request failed");
    return result;
  }
  window.VTORAccounts={ready,getToken,fetchAuthenticated,state};
})();
