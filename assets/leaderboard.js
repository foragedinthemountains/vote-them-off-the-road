"use strict";
(() => {
  const list=document.querySelector("#leaderboard-entries");
  const status=document.querySelector("#leaderboard-status");
  const empty=document.querySelector("#leaderboard-empty");
  const title=document.querySelector("#standings-heading");
  const buttons=[...document.querySelectorAll("[data-period]")];
  if(!list||!status||!empty||!title||!buttons.length)return;
  const glyphs=["⚖️","🚙","🚧","🛑","🚦","🏎️","👑","🦊"];
  const medal=["🥇","🥈","🥉"];
  let period="week",seq=0;
  const make=(tag,cls,text)=>{
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(text!==undefined)el.textContent=String(text);
    return el;
  };
  function drawPerson(entry){
    const li=make("li","leaderboard-juror"+(entry.place<=3?" podium":""));
    const place=make("span","leaderboard-place",medal[entry.place-1]||"#"+entry.place);
    place.setAttribute("aria-label","Place "+entry.place);
    const avatar=make("span","leaderboard-avatar");
    if(typeof entry.avatar_url==="string" &&
       /^\/avatars\/[0-9a-f-]{36}$/i.test(entry.avatar_url)){
      const img=make("img");
      img.alt="";
      img.loading="lazy";
      img.src=entry.avatar_url;
      avatar.append(img);
    }else{
      avatar.textContent=glyphs[Number(entry.avatar_preset)]||glyphs[0];
    }
    const name=make("div","leaderboard-identity");
    name.append(make("strong","","@"+entry.handle),
      make("span","leaderboard-tier",(entry.rank_icon||"⚖️")+" "+entry.rank));
    const score=make("div","leaderboard-score");
    score.append(make("strong","",(Number(entry.xp)||0).toLocaleString()+" XP"),
      make("span","",period==="week"?
        "this week · "+(Number(entry.total_xp)||0).toLocaleString()+" lifetime":
        "all-time Jury XP"));
    li.append(place,avatar,name,score);
    return li;
  }
  async function refresh(){
    const token=++seq;
    title.textContent=period==="week"?"This week's jurors":"All-time leaders";
    buttons.forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.period===period)));
    list.replaceChildren();
    empty.hidden=true;
    status.textContent="Loading the jury standings…";
    try{
      const response=await fetch("/api/jury/leaderboard?period="+period,{
        cache:"no-store",credentials:"same-origin",
        headers:{Accept:"application/json"}
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(result.error||"Could not load standings.");
      if(token!==seq)return;
      if(!result.ready){
        status.textContent="Standings aren't active yet.";
        empty.hidden=false;
        empty.textContent=result.message||"The jury board is getting ready.";
        return;
      }
      status.textContent=period==="week"?
        "Jury XP earned this week (Monday to Sunday, Eastern Time).":
        "Jury XP earned since launch.";
      const entries=Array.isArray(result.entries)?result.entries:[];
      if(!entries.length){
        empty.hidden=false;
        empty.append(make("strong","","No public jurors yet."),
          make("p","","Be among the first to join. Existing jury members stay private until they opt in."));
        const join=make("a","btn btn-primary","Join the board");
        join.href="/nh/account/#account-profile-panel";
        empty.append(join);
      }else{
        const fragment=document.createDocumentFragment();
        for(const item of entries)fragment.append(drawPerson(item));
        list.append(fragment);
      }
    }catch(error){
      if(token!==seq)return;
      status.textContent=error?.message||"The leaderboard couldn't load.";
      empty.hidden=false;
      const retry=make("button","btn btn-secondary","Try again");
      retry.type="button";
      retry.addEventListener("click",refresh);
      empty.append(retry);
    }
  }
  for(const button of buttons)button.addEventListener("click",()=>{
    if(button.dataset.period===period)return;
    period=button.dataset.period;
    refresh();
  });
  refresh();
})();
