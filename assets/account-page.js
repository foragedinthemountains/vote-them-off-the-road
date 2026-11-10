"use strict";
(() => {
  const status=document.querySelector("#account-status");
  const panelTitle=document.querySelector("#account-panel-title");
  const signIn=document.querySelector("#account-signin");
  const signInButton=document.querySelector("#account-sign-in");
  const signUpButton=document.querySelector("#account-sign-up");
  const signOutButton=document.querySelector("#account-sign-out");
  const loggedIn=document.querySelector("#account-user");
  const userName=document.querySelector("#account-user-name");
  const incidentPanel=document.querySelector("#account-incident-panel");
  const incidentList=document.querySelector("#account-incidents");
  const historyPanel=document.querySelector("#account-history-panel");
  const linkButton=document.querySelector("#account-link-browser");
  const historyStatus=document.querySelector("#account-history-status");
  if(!status||!window.VTORAccounts)return;
  const accounts=window.VTORAccounts;
  const make=(tag,cls,text)=>{
    const e=document.createElement(tag);
    if(cls)e.className=cls;
    if(text!==undefined&&text!==null)e.textContent=String(text);
    return e;
  };
  let generation=0;
  const photoObjectUrls=new Set();
  function clearPhotos(){
    for(const url of photoObjectUrls)URL.revokeObjectURL(url);
    photoObjectUrls.clear();
  }
  window.addEventListener("pagehide",clearPhotos);
  async function display(){
    const current=++generation;
    clearPhotos();
    await accounts.ready;
    if(!accounts.state.enabled){
      status.hidden=false;
      if(panelTitle)panelTitle.textContent="My account";
      status.textContent=accounts.state.error?
        "Sign-in couldn't load. Guest voting and submissions still work.":
        "We're preparing free user accounts. You can keep voting and posting as a guest.";
      signIn.hidden=true;loggedIn.hidden=true;
      incidentPanel.hidden=true;historyPanel.hidden=true;
      return;
    }
    const user=accounts.getUser();
    if(!user){
      status.hidden=false;
      if(panelTitle)panelTitle.textContent="Sign in or create a free account";
      loggedIn.hidden=true;incidentPanel.hidden=true;historyPanel.hidden=true;
      signIn.hidden=false;
      const callbackStatus=new URLSearchParams(location.search).get("auth");
      const reason=new URLSearchParams(location.search).get("reason");
      const safeReasons=new Set(["configuration","workos_authorization",
        "callback_parameters","missing_flow_cookie","oauth_state",
        "exchange_network","exchange_rejected","token_validation","session_cookie",
        "token_precheck","token_malformed","token_header","token_issuer",
        "token_client","token_subject","token_session","token_time",
        "token_impersonation","jwks_fetch","jwks_format","jwks_key",
        "token_signature","member_database","token_unexpected"]);
      status.textContent=callbackStatus==="failed"?
        "Sign-in didn't finish. Diagnostic: "+
        (safeReasons.has(reason)?reason:"unknown")+
        ". Please report this code to the site administrator.":
        accounts.state.error?
          "Sign-in service is temporarily unavailable. Guest posting and voting still work.":
          "Sign in or create a free account. You're also welcome to use the site as a guest.";
      return;
    }
    if(panelTitle)panelTitle.textContent="My account";
    status.hidden=true;
    signIn.hidden=true;loggedIn.hidden=false;
    incidentPanel.hidden=false;historyPanel.hidden=false;
    userName.textContent=user.email||"Signed-in juror";
    try{
      const [me,posts,score]=await Promise.all([
        accounts.fetchAuthenticated("/api/account/me"),
        accounts.fetchAuthenticated("/api/account/incidents"),
        accounts.fetchAuthenticated("/api/account/xp")
      ]);
      if(current!==generation)return;
      incidentList.replaceChildren();
      if(!posts.incidents?.length){
        incidentList.append(make("p","owner-hint",
          "You haven't posted any incidents with this account yet. Submit an incident or visit My Submissions to manage guest posts."));
      }
      for(const incident of posts.incidents||[]){
        const card=make("div","owner-case");
        const title=make("strong","",incident.title);
        const meta=make("p","owner-hint",
          (incident.category||"other").replace(/_/g," ")+" · "+
          incident.status+" · "+incident.photos+" photo(s)");
        const manage=make("a","btn btn-secondary","Manage incident");
        manage.href="/nh/manage/?id="+encodeURIComponent(incident.id);
        card.append(title,meta);
        const photoId=incident.cover_photo_id;
        if(typeof photoId==="string" && /^[A-Za-z0-9_-]{6,80}$/.test(photoId)){
          const link=make("a","owner-case-photo");
          link.target="_blank";link.rel="noopener noreferrer";
          link.setAttribute("aria-label","Open full incident photo");
          const image=make("img");
          image.alt="Photo from your incident";
          image.loading="lazy";
          link.append(image);
          card.append(link);
          (async()=>{
            try{
              const jwt=await accounts.getToken();
              if(!jwt)return;
              const response=await fetch("/api/owner/media/"+encodeURIComponent(photoId),{
                headers:{Authorization:"Bearer "+jwt},
                credentials:"same-origin",cache:"no-store"
              });
              if(!response.ok || !response.headers.get("Content-Type")?.startsWith("image/"))
                throw Error("Cannot display this photo");
              const imageUrl=URL.createObjectURL(await response.blob());
              if(generation!==current || !card.isConnected){
                URL.revokeObjectURL(imageUrl);return;
              }
              photoObjectUrls.add(imageUrl);
              image.src=imageUrl;link.href=imageUrl;
            }catch{link.remove();}
          })();
        }
        card.append(manage);
        incidentList.append(card);
      }
      linkButton.disabled=me.browser_linked_elsewhere;
      linkButton.textContent=me.browser_linked_elsewhere?
        "This browser's history belongs to another account":
        me.browser_linked?"Sync new guest activity from this browser":
          "Add this browser's guest jury history to my account";
      historyStatus.textContent=score.ready?
        Number(score.xp||0).toLocaleString()+" account Jury XP · "+
        (score.rank?.name||"Jury Member")+" · "+
        Number(score.linked_browsers||0)+" linked browser(s)":
        "Jury XP is not active yet.";
    }catch(error){
      if(current!==generation)return;
      incidentList.replaceChildren(make("p","owner-hint",
        error?.message||"Could not load your account's incidents."));
    }
  }
  for(const [button,action] of [
    [signInButton,()=>accounts.signIn()],
    [signUpButton,()=>accounts.signUp()],
    [signOutButton,()=>accounts.signOut()]
  ]){
    button?.addEventListener("click",async()=>{
      button.disabled=true;
      try{await action();}
      catch(error){status.hidden=false;status.textContent=error.message;button.disabled=false;}
    });
  }
  linkButton?.addEventListener("click",async()=>{
    if(!confirm("Add this browser's guest votes, XP, games and streaks to "+
      "your signed-in account? Duplicate case votes won't count twice. "+
      "Guest history moved into your account will no longer appear when "+
      "you're signed out."))return;
    linkButton.disabled=true;
    historyStatus.textContent="Syncing guest jury history…";
    try{
      const result=await accounts.fetchAuthenticated(
        "/api/account/link-browser",{
          method:"POST",headers:{"Content-Type":"application/json"},body:"{}"
        });
      await display();
      historyStatus.textContent=result.message;
      window.dispatchEvent(new Event("vtor:account-jury-synced"));
    }catch(error){
      historyStatus.textContent=error.message;linkButton.disabled=false;
    }
  });
  display();
})();
