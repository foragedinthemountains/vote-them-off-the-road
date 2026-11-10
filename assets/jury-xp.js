"use strict";
(() => {
  const juryFetch=(path,options)=>
    window.VTORAccounts?.juryFetch?
      window.VTORAccounts.juryFetch(path,options):fetch(path,options);
  const panel=document.querySelector("#jury-xp");
  const missionPanel=document.querySelector("#jury-missions");
  if(!panel||!missionPanel)return;
  const make=(tag,cls,text)=>{
    const e=document.createElement(tag);
    if(cls)e.className=cls;
    if(text!==undefined&&text!==null)e.textContent=String(text);
    return e;
  };
  let lastReq=0;
  async function load(){
    const current=++lastReq;
    try{
      const response=await juryFetch("/api/jury/xp",{
        credentials:"same-origin",cache:"no-store",headers:{Accept:"application/json"}
      });
      if(!response.ok)throw Error("Jury XP temporarily unavailable");
      const result=await response.json();
      if(lastReq!==current)return;
      panel.replaceChildren();
      missionPanel.replaceChildren();
      if(!result.ready){
        const message=make("p","jury-xp-unavailable",
          result.message||"Jury XP is preparing for launch.");
        panel.append(message);return;
      }
      const rank=result.rank||{name:"Jury Member",xp:0,icon:"⚖️"};
      const next=result.next_rank;
      const heading=make("div","jury-xp-header");
      const rankInfo=make("div","jury-rank-info");
      rankInfo.append(make("span","jury-rank-icon",rank.icon||"⚖️"),
        make("div","jury-rank-text"));
      const details=rankInfo.lastElementChild;
      details.append(make("span","jury-xp-eyebrow","YOUR JURY RANK"),
        make("h3","",rank.name));
      const points=make("div","jury-xp-totals");
      points.append(make("strong","",Number(result.xp||0).toLocaleString()+" XP"),
        make("span","", "+"+Number(result.today_xp||0)+" today"));
      heading.append(rankInfo,points);
      const meter=make("div","jury-rank-track");
      meter.setAttribute("role","progressbar");
      meter.setAttribute("aria-label","Progress toward next jury rank");
      const currentXp=Number(result.xp||0);
      const prior=Number(rank.xp||0);
      const nextAt=next?Number(next.xp||0):prior;
      const percent=next?Math.max(0,Math.min(100,
        ((currentXp-prior)/(nextAt-prior))*100)):100;
      meter.setAttribute("aria-valuenow",String(Math.round(percent)));
      meter.setAttribute("aria-valuemin","0");
      meter.setAttribute("aria-valuemax","100");
      const fill=make("span","jury-rank-fill");
      fill.style.width=percent+"%";
      meter.append(fill);
      panel.append(heading,meter,
        make("p","jury-rank-next",next?
          Number(result.xp_to_next||0)+" more XP until "+next.name:
          "Highest jury rank unlocked!"));
      const label=make("div","jury-missions-intro");
      label.append(make("h3","","Today's missions"),
        make("p","","Fresh challenges reset at midnight Eastern. No XP for changing a vote or filing reports."));
      missionPanel.append(label);
      const missionList=make("div","jury-mission-grid");
      for(const mission of result.missions||[]){
        const card=make("div","jury-mission"+
          (mission.complete?" complete":"")+
          (!mission.available?" unavailable":""));
        const top=make("div","jury-mission-top");
        top.append(make("strong","",mission.complete?"✓ "+mission.title:mission.title),
          make("span","jury-mission-reward","+"+mission.reward_xp+" XP"));
        card.append(top,make("p","",mission.description));
        card.append(make("span","jury-mission-progress",mission.complete?
          "Completed":(!mission.available?"Not available yet":
          mission.progress+" / "+mission.target)));
        if(!mission.complete&&mission.available){
          const link=make("a","jury-mission-link",
            mission.id==="guess"?"Play Guess the Verdict ↗":
            mission.id==="duel"?"Open head-to-head ↗":
            mission.id==="daily-duty"&&mission.title==="All caught up?"?
              "Go to check-in ↗":"Find cases ↗");
          link.href=mission.id==="guess"?"#verdict-guess-panel":
            mission.id==="duel"?"#battle-panel":
            mission.id==="daily-duty"&&mission.title==="All caught up?"?
              "#jury-checkin":"#incidents";
          card.append(link);
        }
        missionList.append(card);
      }
      missionPanel.append(missionList);
    }catch(error){
      if(lastReq!==current)return;
      panel.replaceChildren(make("p","jury-xp-unavailable",
        "Jury XP is temporarily unavailable. Regular voting still works."));
    }
  }
  for(const event of ["vtor:vote","vtor:battle","vtor:guess","vtor:checkin"]){
    window.addEventListener(event,load);
  }
  load();
})();
