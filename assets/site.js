'use strict';
const year = document.getElementById('year');
if (year) year.textContent = String(new Date().getFullYear());

(() => {
  // Never intercept private data. The service worker only supplies a generic
  // offline page for public navigation; the live feed always uses the network.
  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js", {scope:"/",updateViaCache:"none"})
        .catch(() => { /* Normal browsing remains available. */ });
    }, {once:true});
  }
  const button=document.getElementById("vtor-install-app");
  if (!button) return;
  const standalone=window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone===true;
  if (standalone) return;
  let prompt=null;
  window.addEventListener("beforeinstallprompt",event=>{
    event.preventDefault();
    prompt=event;
    button.hidden=false;
  });
  window.addEventListener("appinstalled",()=>{
    prompt=null;
    button.hidden=true;
  });
  button.addEventListener("click",async()=>{
    if (!prompt)return;
    const event=prompt;
    prompt=null;
    button.hidden=true;
    try{
      await event.prompt();
      await event.userChoice;
    }catch{
      // Installation is always user controlled and may be declined.
    }
  });
})();


(() => {
  const avatars=["⚖️","🚙","🚧","🛑","🚦","🏎️","👑","🦊"];
  if(location.pathname.startsWith("/admin/"))return; // Cloudflare Access admin is separate.
  const nav=document.querySelector("header .header-inner");
  if(!nav)return;
  const box=document.createElement("div");
  box.className="member-menu";
  const trigger=document.createElement("button");
  trigger.type="button";
  trigger.className="member-menu-trigger";
  trigger.setAttribute("aria-expanded","false");
  trigger.setAttribute("aria-haspopup","true");
  trigger.setAttribute("aria-label","Account menu");
  const face=document.createElement("span");
  face.className="member-menu-face";
  face.textContent="⚖️";
  const caption=document.createElement("span");
  caption.className="member-menu-caption";
  caption.textContent="Account";
  const chevron=document.createElement("span");
  chevron.textContent="▾";
  trigger.append(face,caption,chevron);
  const panel=document.createElement("div");
  panel.className="member-menu-panel";
  panel.hidden=true;
  panel.setAttribute("aria-label","Account options");
  box.append(trigger,panel);
  nav.append(box);
  function entry(text,target){
    const a=document.createElement("a");
    a.href=target;
    a.textContent=text;
    return a;
  }
  function close(){
    panel.hidden=true;
    trigger.setAttribute("aria-expanded","false");
  }
  trigger.addEventListener("click",()=>{
    panel.hidden=!panel.hidden;
    trigger.setAttribute("aria-expanded",String(!panel.hidden));
  });
  document.addEventListener("pointerdown",event=>{
    if(!box.contains(event.target))close();
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"){close();trigger.focus();}
  });
  async function ensureAccountHelper(){
    if(window.VTORAccounts)return window.VTORAccounts;
    if(!document.querySelector('script[src*="/assets/public-account.js"]')){
      await new Promise(resolve=>{
        const script=document.createElement("script");
        script.src="/assets/public-account.js?v=20261110-profile-menu";
        script.onload=resolve;
        script.onerror=resolve;
        document.head.append(script);
      });
    }
    return window.VTORAccounts||null;
  }
  function setFace(preset,url){
    face.replaceChildren();
    if(typeof url==="string" && /^\/avatars\/[0-9a-f-]{36}$/.test(url)){
      const img=document.createElement("img");
      img.src=url;img.alt="";
      face.append(img);
    }else{
      face.textContent=avatars[Number.isInteger(preset)&&preset>=0&&preset<avatars.length?preset:0];
    }
  }
  async function refresh(){
    const accounts=await ensureAccountHelper();
    if(accounts)await accounts.ready;
    const user=accounts?.getUser();
    panel.replaceChildren();
    if(user){
      let profile=null;
      try{
        const result=await accounts.fetchAuthenticated("/api/account/profile");
        if(result.ready)profile=result.profile;
      }catch{ /* Profile loading must never block account access. */ }
      caption.textContent=profile?.handle?"@"+profile.handle:"My Account";
      setFace(profile?.avatar_preset,profile?.avatar_url);
      const email=document.createElement("p");
      email.className="member-menu-email";
      email.textContent=user.email||"Signed in";
      panel.append(email,
        entry("Change avatar & username","/nh/account/#account-profile-panel"),
        entry("My Incidents","/nh/account/#account-incident-panel"),
        entry("Jury Dashboard","/nh/account/#account-dashboard-panel"),
        entry("Jury Leaderboard","/nh/leaderboard/"));
      const signOut=document.createElement("button");
      signOut.type="button";
      signOut.className="member-menu-signout";
      signOut.textContent="Sign Out";
      signOut.addEventListener("click",async()=>{
        signOut.disabled=true;
        signOut.textContent="Signing out…";
        try{await accounts.signOut();}
        catch{
          signOut.disabled=false;
          signOut.textContent="Sign Out (retry)";
        }
      });
      panel.append(signOut);
    }else{
      setFace(0,null);
      caption.textContent="Sign In";
      const signIn=document.createElement("button");
      signIn.type="button";
      signIn.textContent="Sign In / Create Account";
      signIn.className="member-menu-signout";
      signIn.addEventListener("click",()=>{
        if(accounts?.state?.enabled)accounts.signIn();
        else location.assign("/nh/account/");
      });
      panel.append(signIn,
        entry("Continue as a guest","/nh/"),
        entry("My guest submissions","/nh/my-submissions/"));
    }
  }
  const init=()=>refresh().catch(()=>{});
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",init,{once:true});
  }else init();
  window.addEventListener("vtor:profile-updated",init);
  window.addEventListener("vtor:account-jury-synced",init);
})();
