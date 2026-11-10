"use strict";
(() => {
  const juryFetch=(path,options)=>
    window.VTORAccounts?.juryFetch?
      window.VTORAccounts.juryFetch(path,options):fetch(path,options);
  const status=document.querySelector("#verdict-guess-status");
  const caseNode=document.querySelector("#verdict-guess-case");
  const reveal=document.querySelector("#verdict-guess-reveal");
  const next=document.querySelector("#verdict-guess-next");
  const categorySelect=document.querySelector("#feed-category");
  if(!status||!caseNode||!reveal||!next)return;
  const make=(tag,cls,value)=>{
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    if(value!=null)node.textContent=String(value);
    return node;
  };
  const reactions=[
    {key:"off",label:"🚫 Vote Them Off"},
    {key:"pass",label:"✓ Give 'Em a Pass"},
    {key:"funny",label:"😂 That's Just Funny!"}
  ];
  const names={off:"Vote Them Off",pass:"Give 'Em a Pass",funny:"That's Just Funny!"};
  let version=0;
  async function request(url,options={}){
    const response=await juryFetch(url,{credentials:"same-origin",cache:"no-store",...options});
    const body=await response.json();
    if(!response.ok)throw Error(body.error||"The jury game is temporarily unavailable.");
    return body;
  }
  async function load(){
    const current=++version;
    status.textContent="Finding a case for your prediction…";
    next.hidden=true;caseNode.replaceChildren();reveal.replaceChildren();
    try{
      const category=categorySelect?.value||"";
      const response=await request("/api/jury/verdict-guess"+
        (category?"?category="+encodeURIComponent(category):""));
      if(version!==current)return;
      if(!response.ready||!response.incident){
        status.textContent=response.message||"No new cases are available for this game yet.";
        next.hidden=false;next.textContent="Check for another case ↻";
        return;
      }
      const item=response.incident;
      status.textContent="Which reaction currently leads? Your first guess locks in, then the totals are revealed.";
      caseNode.append(make("strong","verdict-case-title",item.title));
      if(item.description)caseNode.append(make("p","verdict-case-description",item.description));
      const choices=make("div","verdict-guess-options");
      const buttons=[];
      for(const reaction of reactions){
        const button=make("button","verdict-guess-choice",reaction.label);
        button.type="button";
        button.addEventListener("click",async()=>{
          for(const b of buttons)b.disabled=true;
          status.textContent="Checking your guess against the current community verdict…";
          try{
            const result=await request("/api/jury/verdict-guess",{
              method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},
              body:JSON.stringify({incident_id:item.id,guess:reaction.key})
            });
            if(version!==current)return;
            button.classList.add("picked");
            const headline=make("h4","",result.tie?"The jury is split!":
              result.correct?"You called it! 🎯":"The community picked differently.");
            const summary=make("p","",result.tie?
              "There's currently a tie for the leading reaction.":
              "Leading reaction: "+names[result.current_lead]);
            const score=make("div","verdict-guess-tallies");
            for(const entry of reactions){
              const n=Number(result.counts?.[entry.key]||0);
              score.append(make("span","",entry.label+" · "+n));
            }
            const note=make("p","verdict-guess-award",
              "+"+Number(result.xp_earned||0)+" Jury XP · Quick-game totals are a snapshot and may change.");
            reveal.replaceChildren(headline,summary,score,note);
            status.textContent=result.message||"Guess complete.";
            next.hidden=false;next.textContent="Guess another case ↻";
            window.dispatchEvent(new Event("vtor:guess"));
          }catch(error){
            status.textContent=error.message;
            for(const b of buttons)b.disabled=false;
          }
        });
        choices.append(button);
        buttons.push(button);
      }
      caseNode.append(choices);
    }catch(error){
      if(version!==current)return;
      status.textContent=error.message||"Unable to load a case.";
      next.hidden=false;next.textContent="Try again ↻";
    }
  }
  next.addEventListener("click",load);
  window.addEventListener("vtor:category-change",load);
  load();
})();
