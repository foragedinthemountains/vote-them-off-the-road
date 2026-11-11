"use strict";
(() => {
  const status=document.querySelector("#account-status");
  const panelTitle=document.querySelector("#account-panel-title");
  const eyebrow=document.querySelector("#account-eyebrow");
  const signIn=document.querySelector("#account-signin");
  const signInButton=document.querySelector("#account-sign-in");
  const googleSignIn=document.querySelector("#account-sign-google");
  const signUpButton=document.querySelector("#account-sign-up");
  const signOutButton=document.querySelector("#account-sign-out");
  const loggedIn=document.querySelector("#account-user");
  const userName=document.querySelector("#account-user-name");
  const dashboardPanel=document.querySelector("#account-dashboard-panel");
  const dashboardStatus=document.querySelector("#jury-dashboard-status");
  const dashboardStats=document.querySelector("#jury-profile-stats");
  const dashboardRank=document.querySelector("#jury-profile-rank");
  const dashboardAchievements=document.querySelector("#jury-profile-achievements");
  const dashboardRecent=document.querySelector("#jury-profile-recent");
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
  function renderDashboard(score){
    dashboardStats.replaceChildren();
    dashboardRank.replaceChildren();
    dashboardAchievements.replaceChildren();
    dashboardRecent.replaceChildren();
    if(!score?.ready){
      dashboardStatus.hidden=false;
      dashboardStatus.textContent=score?.message||"Your jury progress is temporarily unavailable.";
      return;
    }
    dashboardStatus.hidden=true;
    const statValues=[
      ["Verdicts cast",Number(score.verdicts||0).toLocaleString(),"⚖️"],
      ["Current streak",Number(score.current_streak||0)+" day"+
        (Number(score.current_streak||0)===1?"":"s"),"🔥"],
      ["Days active (year)",Number(score.active_days||0).toLocaleString(),"📅"]
    ];
    for(const [label,value,icon] of statValues){
      const tile=make("div","jury-profile-stat");
      tile.append(make("span","jury-profile-stat-icon",icon),
        make("strong","",value),make("span","jury-profile-stat-label",label));
      dashboardStats.append(tile);
    }
    const current=score.rank||{name:"Jury Member",xp:0,icon:"⚖️"};
    const next=score.next_rank;
    const header=make("div","jury-profile-rank-head");
    const heading=make("div","jury-profile-rank-title");
    heading.append(make("span","jury-profile-rank-icon",current.icon||"⚖️"));
    const names=make("div");
    names.append(make("small","","CURRENT JURY RANK"),
      make("strong","",current.name));
    heading.append(names);
    header.append(heading,make("strong","jury-profile-total",
      Number(score.xp||0).toLocaleString()+" XP"));
    const currentXp=Number(score.xp||0),minimum=Number(current.xp||0);
    const limit=next?Number(next.xp||0):minimum;
    const fraction=next && limit>minimum?
      Math.max(0,Math.min(100,(currentXp-minimum)/(limit-minimum)*100)):100;
    const meter=make("div","jury-profile-meter");
    meter.setAttribute("role","progressbar");
    meter.setAttribute("aria-label","Jury rank progress");
    meter.setAttribute("aria-valuenow",String(Math.round(fraction)));
    meter.setAttribute("aria-valuemin","0");
    meter.setAttribute("aria-valuemax","100");
    const fill=make("span","jury-profile-meter-fill");
    fill.style.width=fraction+"%";
    meter.append(fill);
    const footer=make("p","jury-profile-next",next?
      Number(score.xp_to_next||0).toLocaleString()+" more XP to reach "+next.name:
      "You've reached the highest jury rank!");
    dashboardRank.append(header,meter,footer);
    const achievements=Array.isArray(score.achievements)?
      [...score.achievements].sort((a,b)=>Number(b.earned)-Number(a.earned)):[];
    if(!achievements.length){
      dashboardAchievements.append(make("p","owner-hint",
        "Your achievements will appear when you start participating."));
    }
    for(const entry of achievements){
      const card=make("div","jury-profile-achievement"+
        (entry.earned?" earned":" locked"));
      const icon=make("span","jury-profile-achievement-icon",entry.icon||"🏅");
      icon.setAttribute("aria-hidden","true");
      const details=make("div","jury-profile-achievement-copy");
      details.append(make("strong","",entry.title),
        make("span","",entry.detail));
      const done=make("span","jury-profile-achievement-progress",
        entry.earned?"Unlocked ✓":
        Number(entry.progress||0)+" / "+Number(entry.target||1));
      card.append(icon,details,done);
      dashboardAchievements.append(card);
    }
    const votes=Array.isArray(score.recent_votes)?score.recent_votes:[];
    if(!votes.length){
      dashboardRecent.append(make("p","owner-hint",
        "No verdicts yet. Visit the voting board to cast your first."));
      return;
    }
    const labels={off:"Voted off",pass:"Gave a pass",funny:"Just funny"};
    const categoryNames={bad_parking:"Parking fails",cutting_off:"Close calls",
      tailgating:"Tailgating",distracted:"Distracted driving",
      signal:"Signals",speeding:"Speeding",road_rage:"Road rage",
      roadside:"Roadside oddities",funny_unexpected:"Funny / Unexpected",
      other:"Other"};
    for(const item of votes){
      if(typeof item.id!=="string" || !/^[A-Za-z0-9_-]{6,80}$/.test(item.id))continue;
      const link=make("a","jury-profile-vote");
      link.href="/nh/?incident="+encodeURIComponent(item.id)+"#incidents";
      const left=make("span","jury-profile-vote-copy");
      left.append(make("strong","",item.title||"Driving incident"),
        make("span","",categoryNames[item.category]||"Driving incident"));
      const right=make("span","jury-profile-vote-meta");
      right.append(make("strong","",labels[item.choice]||"Voted"),
        make("span","",Number.isFinite(item.created_at)&&item.created_at>0?
          new Date(item.created_at*1000).toLocaleDateString("en-US",{
            timeZone:"America/New_York",month:"short",day:"numeric"
          }):""));
      link.append(left,right);
      dashboardRecent.append(link);
    }
  }

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
      if(dashboardPanel)dashboardPanel.hidden=true;
      return;
    }
    const user=accounts.getUser();
    if(!user){
      status.hidden=false;
      if(panelTitle)panelTitle.textContent="Sign in or create a free account";
      if(eyebrow)eyebrow.textContent="JURY ACCOUNT";
      loggedIn.hidden=true;incidentPanel.hidden=true;historyPanel.hidden=true;
      if(dashboardPanel)dashboardPanel.hidden=true;
      signIn.hidden=false;
      if(googleSignIn)googleSignIn.hidden=!accounts.state.googleEnabled;
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
    if(eyebrow)eyebrow.textContent="MY JURY DASHBOARD";
    status.hidden=true;
    signIn.hidden=true;loggedIn.hidden=false;
    incidentPanel.hidden=false;historyPanel.hidden=false;
    if(dashboardPanel)dashboardPanel.hidden=false;
    userName.textContent=user.email||"Signed-in juror";
    try{
      const [me,posts,score,profileResult]=await Promise.all([
        accounts.fetchAuthenticated("/api/account/me"),
        accounts.fetchAuthenticated("/api/account/incidents"),
        accounts.fetchAuthenticated("/api/account/xp"),
        accounts.fetchAuthenticated("/api/account/profile").catch(()=>({ready:false}))
      ]);
      if(current!==generation)return;
      if(dashboardPanel)renderDashboard(score);
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
        const handle=profileResult?.ready?profileResult.profile?.handle:null;
        if(handle){
          const credit=document.createElement("label");
          credit.className="owner-author-credit";
          const check=document.createElement("input");
          check.type="checkbox";
          check.checked=Number(incident.show_author)===1;
          const label=document.createElement("span");
          label.textContent="Show @"+handle+" as the author on this incident";
          const feedback=make("span","owner-hint","");
          feedback.setAttribute("role","status");
          credit.append(check,label);
          check.addEventListener("change",async()=>{
            const wantsCredit=check.checked;
            if(wantsCredit&&!confirm(
              "Show @"+handle+" publicly as the author of this incident? "+
              "Visitors will also be able to see your profile avatar.")){
              check.checked=false;return;
            }
            check.disabled=true;
            feedback.textContent="Saving…";
            try{
              await accounts.fetchAuthenticated(
                "/api/account/incidents/"+encodeURIComponent(incident.id)+"/credit",{
                  method:"PATCH",headers:{"Content-Type":"application/json"},
                  body:JSON.stringify({show_author:wantsCredit})
                });
              feedback.textContent=wantsCredit?
                "Your username is now public on this incident.":
                "This incident is now credited anonymously.";
            }catch(error){
              check.checked=!wantsCredit;
              feedback.textContent=error.message||"Could not update author credit.";
            }finally{check.disabled=false;}
          });
          card.append(credit,feedback);
        }else if(profileResult?.ready){
          const setup=make("a","owner-hint",
            "Want public author credit? Set a username in My Public Profile.");
          setup.href="#account-profile-panel";
          card.append(setup);
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
      if(dashboardStatus){
        dashboardStatus.hidden=false;
        dashboardStatus.textContent="Some account information couldn't load. Try refreshing.";
      }
      incidentList.replaceChildren(make("p","owner-hint",
        error?.message||"Could not load your account's incidents."));
    }
  }
  for(const [button,action] of [
    [signInButton,()=>accounts.signIn()],
    [googleSignIn,()=>accounts.signInWithGoogle()],
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
  window.addEventListener("vtor:profile-updated",()=>display());
  display();
})();
