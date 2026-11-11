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
