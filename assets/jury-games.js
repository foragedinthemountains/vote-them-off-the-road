
"use strict";
(() => {
  const battleStatus=document.querySelector("#battle-status");
  const battleOptions=document.querySelector("#battle-options");
  const battleNext=document.querySelector("#battle-next");
  const predictionStatus=document.querySelector("#prediction-status");
  const predictionOptions=document.querySelector("#prediction-options");
  const predictionHistory=document.querySelector("#prediction-history");
  if(!battleStatus || !predictionStatus)return;
  const el=(tag,cls,text)=>{
    const item=document.createElement(tag);
    if(cls)item.className=cls;
    if(text!==undefined&&text!==null)item.textContent=String(text);
    return item;
  };
  async function requestJSON(path,options={}){
    const response=await fetch(path,{cache:"no-store",credentials:"same-origin",...options});
    const result=await response.json();
    if(!response.ok)throw Error(result.error||"Unable to complete this jury action");
    return result;
  }
  async function loadBattle(){
    battleOptions.replaceChildren();
    battleNext.hidden=true;
    battleStatus.textContent="Looking for two cases in the same category this week…";
    try{
      const result=await requestJSON("/api/jury/battle");
      if(!result.ready||!result.pair){
        battleStatus.textContent=result.message||"More same-category cases are needed for head-to-head voting.";
        battleNext.textContent="Check for new matchups ↻";
        battleNext.hidden=false;
        return;
      }
      const isFunny=result.competition==="funniest";
      battleStatus.textContent=result.message||
        (isFunny?"Which funny moment is funnier?":"Which driving case is worse?");
      const pair=result.pair;
      const container=el("div","battle-grid");
      const buttons=[];
      for(const incident of pair){
        const card=el("button","battle-choice");
        card.type="button";
        if(incident.photo && incident.photo.startsWith("/media/")){
          const img=el("img");
          img.src=incident.photo;
          img.alt="Image accompanying a publicly submitted driving incident";
          img.loading="lazy";
          card.append(img);
        }
        card.append(el("span","battle-category",(incident.category||"other").replace(/_/g," ")),
          el("strong","",incident.title),
          el("p","",incident.description||"Read the incident and pick a side."),
          el("span","battle-vote-label",isFunny?"This one is funnier 😂":"This one is worse ↗"));
        card.addEventListener("click",async()=>{
          for(const b of buttons)b.disabled=true;
          battleStatus.textContent="Recording your head-to-head verdict…";
          try{
            const result=await requestJSON("/api/jury/battle",{
              method:"POST",headers:{"Content-Type":"application/json"},
              body:JSON.stringify({left_id:pair[0].id,right_id:pair[1].id,winner_id:incident.id})
            });
            for(const b of buttons){
              b.classList.toggle("picked",b===card);
              const winnerId=b.dataset.incidentId;
              const count=(result.results||[]).find(row=>row.id===winnerId)?.votes||0;
              b.append(el("span","battle-results",count+" jury picks for this side"));
            }
            battleStatus.textContent=isFunny?
              "😂 Your comedy verdict contributes to Funniest of the Week without changing the normal Funny reaction total.":
              "⚔️ Your matchup verdict contributes to Worst of the Week without changing the normal Off/Pass reaction totals.";
            window.dispatchEvent(new Event("vtor:battle"));
            battleNext.hidden=false;
          }catch(error){
            battleStatus.textContent=error.message;
            battleNext.hidden=false;
          }
        });
        card.dataset.incidentId=incident.id;
        buttons.push(card);container.append(card);
      }
      battleOptions.append(container);
    }catch(error){
      battleStatus.textContent=error.message||"Head-to-head voting temporarily unavailable.";
      battleNext.hidden=false;
    }
  }
  async function loadPrediction(){
    predictionOptions.replaceChildren();
    predictionStatus.textContent="Checking next week's category challenge…";
    try{
      const data=await requestJSON("/api/jury/prediction");
      if(!data.ready){
        predictionStatus.textContent=data.message||"Predictions are not available yet.";
        return;
      }
      const week=new Date(Number(data.for_week_start)*1000).toLocaleDateString("en-US",{
        timeZone:"America/New_York",month:"short",day:"numeric",year:"numeric"
      });
      predictionStatus.textContent="Make your prediction now for the week beginning "+week+
        ". Change it anytime before that week begins.";
      const label=el("label","jury-prediction-label","Which category will get the most submissions?");
      const select=el("select","jury-prediction-select");
      for(const [value,title] of Object.entries(data.categories||{})){
        select.append(new Option(title,value));
      }
      if(data.selection)select.value=data.selection;
      const save=el("button","jury-next-button",data.selection?"Update prediction":"Lock in a prediction");
      save.type="button";
      const feedback=el("p","jury-prediction-feedback","");
      save.addEventListener("click",async()=>{
        save.disabled=true;feedback.textContent="Saving your prediction…";
        try{
          const result=await requestJSON("/api/jury/prediction",{
            method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({category:select.value})
          });
          save.textContent="Update prediction";
          feedback.textContent="✓ Saved! "+(data.categories?.[result.category]||"Your pick")+
            " is your prediction for next week.";
        }catch(error){feedback.textContent=error.message;}
        finally{save.disabled=false;}
      });
      label.htmlFor="jury-category-pick";
      select.id="jury-category-pick";
      predictionOptions.append(label,select,save,feedback);
      const wins=(data.last_week?.winners||[]).map(v=>data.categories?.[v]||v);
      predictionHistory.textContent=Number(data.total_predictions_settled||0)+
        " predictions settled · "+Number(data.correct_predictions||0)+
        " correct"+(wins.length?" · Last week's leading category: "+wins.join(", "):" · Last week has no finalized category winner yet.");
    }catch(error){
      predictionStatus.textContent=error.message||"Predictions temporarily unavailable.";
    }
  }
  if(battleNext)battleNext.addEventListener("click",loadBattle);
  loadBattle();
  loadPrediction();
})();
