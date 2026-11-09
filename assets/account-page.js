"use strict";
(() => {
  const status=document.querySelector("#account-status");
  const signIn=document.querySelector("#account-signin");
  const loggedIn=document.querySelector("#account-user");
  const userButton=document.querySelector("#account-user-button");
  const incidentPanel=document.querySelector("#account-incident-panel");
  const incidentList=document.querySelector("#account-incidents");
  const historyPanel=document.querySelector("#account-history-panel");
  const linkButton=document.querySelector("#account-link-browser");
  const historyStatus=document.querySelector("#account-history-status");
  if(!status||!window.VTORAccounts)return;
  const make=(tag,cls,text)=>{
    const e=document.createElement(tag);if(cls)e.className=cls;
    if(text!==undefined&&text!==null)e.textContent=String(text);
    return e;
  };
  let lastUser="";
  async function display(){
    const {state,ready,fetchAuthenticated}=window.VTORAccounts;
    await ready;
    if(!state.enabled){
      status.textContent=state.error?
        "Public sign-in is temporarily unavailable. Guest voting and submissions still work.":
        "Public accounts are being prepared. You can keep voting and posting as a guest for now.";
      return;
    }
    if(!state.clerk?.isSignedIn){
      lastUser="";
      loggedIn.hidden=true;incidentPanel.hidden=true;historyPanel.hidden=true;
      status.textContent="Sign in with an existing account, or create one for free. Guest voting remains available without registration.";
      signIn.replaceChildren();
      try{state.clerk.mountSignIn(signIn,{forceRedirectUrl:"/nh/account/"});}
      catch{status.textContent="The sign-in form could not load. Refresh this page.";}
      return;
    }
    signIn.replaceChildren();
    const user=state.clerk.user;
    const thisUser=user?.id||"";
    status.textContent="You're signed in. Your account isn't the same as the protected administrator login.";
    loggedIn.hidden=false;incidentPanel.hidden=false;historyPanel.hidden=false;
    if(thisUser!==lastUser){
      userButton.replaceChildren();
      try{state.clerk.mountUserButton(userButton);}catch{}
      lastUser=thisUser;
    }
    try{
      const [me,posts,score]=await Promise.all([
        fetchAuthenticated("/api/account/me"),
        fetchAuthenticated("/api/account/incidents"),
        fetchAuthenticated("/api/account/xp")
      ]);
      const scoreText=score.ready?
        Number(score.xp||0).toLocaleString()+" total linked-browser Jury XP · "+
        (score.rank?.name||"Jury Member")+" · "+
        Number(score.linked_browsers||0)+" linked browser(s)":
        "Jury XP is not active yet.";
      historyStatus.textContent=scoreText;
      incidentList.replaceChildren();
      if(!posts.incidents?.length){
        incidentList.append(make("p","owner-hint",
          "No account-owned incidents yet. Submit your next story while signed in, or claim a guest post using its private management link."));
      }
      for(const incident of posts.incidents||[]){
        const card=make("div","owner-case");
        const title=make("strong","",incident.title);
        const meta=make("p","owner-hint",
          (incident.category||"other").replace(/_/g," ")+" · "+incident.status+
          " · "+incident.photos+" photo(s)");
        const manage=make("a","btn btn-secondary","Manage incident");
        manage.href="/nh/manage/?id="+encodeURIComponent(incident.id);
        card.append(title,meta,manage);
        incidentList.append(card);
      }
      linkButton.disabled=me.browser_linked||me.browser_linked_elsewhere;
      linkButton.textContent=me.browser_linked?"✓ This browser is linked":
        me.browser_linked_elsewhere?"Already linked to another account":
          "Link this browser's jury history";
    }catch(error){
      incidentList.replaceChildren(make("p","owner-hint",
        error.message||"Could not load account incidents."));
    }
  }
  linkButton?.addEventListener("click",async()=>{
    linkButton.disabled=true;
    historyStatus.textContent="Linking this browser's jury activity…";
    try{
      const response=await window.VTORAccounts.fetchAuthenticated(
        "/api/account/link-browser",{
          method:"POST",
          headers:{"Content-Type":"application/json"},body:"{}"
        });
      historyStatus.textContent=response.message;
      await display();
    }catch(error){
      historyStatus.textContent=error.message;
      linkButton.disabled=false;
    }
  });
  (async()=>{
    const {state,ready}=window.VTORAccounts;
    await ready;
    if(state.clerk?.addListener)state.clerk.addListener(()=>display());
    await display();
  })();
})();
