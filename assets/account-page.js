"use strict";
(() => {
  const status=document.querySelector("#account-status");
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
  async function display(){
    const current=++generation;
    await accounts.ready;
    if(!accounts.state.enabled){
      status.textContent=accounts.state.error?
        "Sign-in couldn't load. Guest voting and submissions still work.":
        "We're preparing free user accounts. You can keep voting and posting as a guest.";
      signIn.hidden=true;loggedIn.hidden=true;
      incidentPanel.hidden=true;historyPanel.hidden=true;
      return;
    }
    const user=accounts.getUser();
    if(!user){
      loggedIn.hidden=true;incidentPanel.hidden=true;historyPanel.hidden=true;
      signIn.hidden=false;
      status.textContent="Sign in or create a free account. You're also welcome to use the site as a guest.";
      return;
    }
    signIn.hidden=true;loggedIn.hidden=false;
    incidentPanel.hidden=false;historyPanel.hidden=false;
    userName.textContent=user.email||"Signed-in juror";
    status.textContent="You're signed in. Public member accounts are separate from the site's protected admin login.";
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
          "No account-owned incidents yet. Post while signed in or claim a guest submission using its private management link."));
      }
      for(const incident of posts.incidents||[]){
        const card=make("div","owner-case");
        const title=make("strong","",incident.title);
        const meta=make("p","owner-hint",
          (incident.category||"other").replace(/_/g," ")+" · "+
          incident.status+" · "+incident.photos+" photo(s)");
        const manage=make("a","btn btn-secondary","Manage incident");
        manage.href="/nh/manage/?id="+encodeURIComponent(incident.id);
        card.append(title,meta,manage);
        incidentList.append(card);
      }
      linkButton.disabled=me.browser_linked||me.browser_linked_elsewhere;
      linkButton.textContent=me.browser_linked?"✓ This browser is linked":
        me.browser_linked_elsewhere?"Already linked to a different account":
          "Link this browser's jury history";
      historyStatus.textContent=score.ready?
        Number(score.xp||0).toLocaleString()+" linked-browser Jury XP · "+
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
      catch(error){status.textContent=error.message;button.disabled=false;}
    });
  }
  linkButton?.addEventListener("click",async()=>{
    linkButton.disabled=true;
    historyStatus.textContent="Linking this browser's jury history…";
    try{
      const result=await accounts.fetchAuthenticated(
        "/api/account/link-browser",{
          method:"POST",headers:{"Content-Type":"application/json"},body:"{}"
        });
      historyStatus.textContent=result.message;
      await display();
    }catch(error){
      historyStatus.textContent=error.message;linkButton.disabled=false;
    }
  });
  display();
})();
