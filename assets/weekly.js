
"use strict";
(() => {
  const grid=document.querySelector("#weekly-grid");
  const status=document.querySelector("#weekly-status");
  const tallies=document.querySelector("#category-tallies");
  const progress=document.querySelector("#jury-progress");
  const calendar=document.querySelector("#jury-calendar");
  const checkin=document.querySelector("#jury-checkin");
  const weekSelect=document.querySelector("#weekly-week-select");
  const countdown=document.querySelector("#weekly-countdown");
  const categorySelect=document.querySelector("#feed-category");
  const worstPanel=document.querySelector("#weekly-worst");
  const worstHeading=document.querySelector("#weekly-worst-heading");
  const mainHeading=document.querySelector("#weekly-main-heading");
  const mainIntro=document.querySelector("#weekly-main-intro");
  if(!grid||!status)return;
  let nextReset=null,weekEnd=null;
  const el=(tag,cls,value)=>{
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    if(value!==undefined&&value!==null)node.textContent=String(value);
    return node;
  };
  const easternDate=(seconds)=>new Date(Number(seconds)*1000).toLocaleDateString("en-US",{
    timeZone:"America/New_York",month:"short",day:"numeric",year:"numeric"
  });
  const countdownText=(seconds)=>{
    if(!Number.isFinite(seconds))return "";
    const remaining=Math.max(0,Math.floor(seconds*1000-Date.now())/1000);
    const days=Math.floor(remaining/86400),hours=Math.floor(remaining%86400/3600);
    const minutes=Math.floor(remaining%3600/60);
    const secs=Math.floor(remaining%60);
    return (days?days+"d ":"")+String(hours).padStart(2,"0")+":"+
      String(minutes).padStart(2,"0")+":"+String(secs).padStart(2,"0");
  };
  function tick(){
    const timer=nextReset&&progress?.querySelector(".jury-reset-timer");
    if(timer)timer.textContent="Resets in "+countdownText(nextReset)+" (Eastern)";
    if(countdown && weekEnd && weekSelect?.value==="0")
      countdown.textContent="Weekly verdict closes in "+countdownText(weekEnd);
  }
  async function loadProgress(){
    if(!progress)return;
    try{
      const res=await fetch("/api/my-stats",{credentials:"same-origin",cache:"no-store"});
      if(!res.ok)throw Error("Stats unavailable");
      const d=await res.json();
      nextReset=Number(d.next_reset_at);
      const votes=Number(d.votes||0),today=Number(d.today_votes||0),goal=Number(d.daily_target||0);
      const next=d.next_badge_at==null?"Top badge unlocked":
        Math.max(0,Number(d.next_badge_at)-votes)+" more unique cases to your next badge";
      progress.replaceChildren(
        el("strong","","⚖ "+d.badge),
        el("span","",votes+" cases judged · "+next),
        el("span","jury-duty",d.duty_complete?"✓ Today's Jury Duty complete":
          goal===0?"No new cases available today":
          today+"/"+goal+" cases for today's Jury Duty"),
        el("span","jury-streak","🔥 "+Number(d.streak_days||0)+"-day streak"),
        el("span","jury-reset-timer","")
      );
      const bar=el("div","jury-meter");
      const track=el("div","jury-meter-track");
      const fill=el("div","jury-meter-fill");
      fill.style.width=String(goal>0?Math.min(100,100*today/goal):(d.duty_complete?100:0))+"%";
      track.append(fill);
      bar.append(track,el("span","",goal>0?Math.min(today,goal)+"/"+goal:"Caught up"));
      progress.append(bar);
      if(calendar){
        calendar.replaceChildren();
        for(const entry of d.streak_calendar||[]){
          const day=el("div","jury-calendar-day"+(entry.active?" active":"")+(entry.saved?" saved":""));
          day.title=entry.day+(entry.saved?" · Streak save used":entry.active?" · Jury activity recorded":" · No jury activity");
          const label=new Date(entry.day+"T12:00:00Z").toLocaleDateString("en-US",{weekday:"short",timeZone:"UTC"});
          day.append(el("span","",label),el("b","",new Date(entry.day+"T12:00:00Z").getUTCDate()),
            el("span","",entry.saved?"★":entry.active?"✓":"·"));
          calendar.append(day);
        }
      }
      if(checkin){
        checkin.replaceChildren();
        if(d.can_check_in){
          checkin.append(el("p","jury-help","You've voted on every available case. Check in to keep your streak alive without inventing votes."));
          const button=el("button","jury-next-button","✓ Check in: all caught up");
          button.type="button";
          button.addEventListener("click",async()=>{
            button.disabled=true;
            try{
              const response=await fetch("/api/jury/checkin",{
                method:"POST",credentials:"same-origin",
                headers:{"Content-Type":"application/json"},
                body:"{}",cache:"no-store"
              });
              const data=await response.json();
              if(!response.ok)throw Error(data.error||"Check-in failed");
              await loadProgress();
            }catch(error){
              checkin.append(el("p","jury-help",error.message));
              button.disabled=false;
            }
          });
          checkin.append(button);
        }
        if(d.can_save_streak){
          checkin.append(el("p","jury-help",
            "You missed yesterday, but had a three-day streak before it. You have one streak rescue available this month."));
          const save=el("button","jury-next-button","★ Save my streak");
          save.type="button";
          save.addEventListener("click",async()=>{
            save.disabled=true;
            try{
              const response=await fetch("/api/jury/streak-save",{
                method:"POST",credentials:"same-origin",
                headers:{"Content-Type":"application/json"},
                body:"{}",cache:"no-store"
              });
              const result=await response.json();
              if(!response.ok)throw Error(result.error||"Streak rescue failed");
              await loadProgress();
            }catch(error){
              checkin.append(el("p","jury-help",error.message));
              save.disabled=false;
            }
          });
          checkin.append(save);
        }
      }
      tick();
    }catch(error){
      progress.replaceChildren(el("span","","Your jury stats are temporarily unavailable."));
    }
  }
  function drawWinnerGraphic(row,label){
    const canvas=document.createElement("canvas");
    canvas.width=1200;canvas.height=630;
    const ctx=canvas.getContext("2d");
    if(!ctx)return null;
    ctx.fillStyle="#162329";ctx.fillRect(0,0,1200,630);
    ctx.fillStyle="#f7c744";ctx.fillRect(0,0,1200,22);
    ctx.fillStyle="#f7c744";ctx.font="bold 30px sans-serif";
    ctx.fillText("VOTE THEM OFF THE ROAD",60,102);
    ctx.fillStyle="#e9edeb";ctx.font="bold 26px sans-serif";
    ctx.fillText(label.toUpperCase()+" · WEEKLY JURY BOARD",60,165);
    ctx.fillStyle="#fffefa";ctx.font="bold 62px sans-serif";
    const words=String(row.title||"").split(/\s+/);
    const lines=[];let line="";
    for(const word of words){
      if(ctx.measureText(line+" "+word).width>1060 && line){lines.push(line);line=word;}
      else line=line?line+" "+word:word;
    }
    if(line)lines.push(line);
    lines.slice(0,3).forEach((text,i)=>ctx.fillText(text.slice(0,48),60,260+i*78));
    ctx.fillStyle="#f7c744";ctx.font="bold 32px sans-serif";
    const emojiLine = "🚫 "+Number(row.off_votes||0)+" off   ✓ "+Number(row.pass_votes||0)+" pass" +
      (Number(row.funny_votes||0)>0?"   😂 "+row.funny_votes+" funny":"");
    ctx.fillText(emojiLine,60,525);
    ctx.fillStyle="#b4c5c2";ctx.font="22px sans-serif";
    ctx.fillText("Community votes · Not a verified traffic violation",60,588);
    return canvas;
  }
  async function shareCard(row,label,button){
    const url=location.origin+"/nh/?incident="+encodeURIComponent(row.id)+"#incidents";
    try{
      const canvas=drawWinnerGraphic(row,label);
      if(canvas){
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
        if(blob){
          const file=new File([blob],"vtor-weekly-"+row.id.slice(0,8)+".png",{type:"image/png"});
          if(navigator.canShare?.({files:[file]})){
            await navigator.share({title:"Vote Them Off the Road weekly picks",text:row.title,url,files:[file]});
            return;
          }
          const a=document.createElement("a");const objectUrl=URL.createObjectURL(blob);
          a.href=objectUrl;a.download=file.name;document.body.append(a);a.click();a.remove();
          setTimeout(()=>URL.revokeObjectURL(objectUrl),10000);
          button.textContent="✓ Graphic saved";return;
        }
      }
      await navigator.clipboard.writeText(url);button.textContent="✓ Link copied";
    }catch(error){
      if(error?.name!=="AbortError")button.textContent="Share: "+url;
    }
  }
  async function loadWeekly(offset=0){
    grid.replaceChildren();
    status.textContent="Loading jury results…";
    try{
      const res=await fetch("/api/weekly-board?offset="+offset,{cache:"no-store"});
      if(!res.ok)throw Error("Weekly results unavailable");
      const d=await res.json();
      if(!d.ready){
        status.textContent="Weekly rankings open once the database category upgrade is activated.";
        return;
      }
      weekEnd=Number(d.week_end);
      const isCurrent=offset===0;
      if(countdown){
        countdown.textContent=isCurrent?"":(d.archived?"✓ Final results recorded":"Historical totals are not yet finalized");
      }
      status.textContent=(isCurrent?"Current week: ":"Week: ")+
        easternDate(d.week_start)+" to "+easternDate(d.week_end-1)+
        " · "+d.minimum_votes+" total votes required for an official podium place."+
        (!isCurrent && !d.archived?" Historical figures may change until archived.":"");
      grid.replaceChildren();
      const labels=d.categories||{};
      const chosenCategory=categorySelect?.value||"";
      const choiceLabel=labels[chosenCategory]||"All categories";
      if (mainHeading) mainHeading.textContent=chosenCategory
        ? "Weekly awards · "+choiceLabel : "Weekly awards";
      if (mainIntro) mainIntro.textContent=chosenCategory==="funny_unexpected"
        ? "😂 Funny / Unexpected cases are nominated for Funniest Moment of the Week. The official award requires five reactions and a Funny majority."
        : chosenCategory
          ? "Showing weekly voting awards for "+choiceLabel+". Results are community opinions, not verified traffic violations."
          : "Browse weekly community favorites by category. Winners are determined by votes, not verified traffic violations.";
      if (worstPanel) worstPanel.hidden = chosenCategory === "funny_unexpected";
      if (worstHeading) worstHeading.textContent = chosenCategory && chosenCategory !== "funny_unexpected"
        ? "Worst of the Week · " + (labels[chosenCategory]||"Other")
        : "Worst of the Week";
      const podiums=(d.podiums||[]).filter(row =>
        !chosenCategory || row.category===chosenCategory);
      for(const row of podiums){
        const card=el("article","weekly-card"+(row.qualified?"":" provisional"));
        const rank={1:"🥇",2:"🥈",3:"🥉"}[row.rank]||"#"+row.rank;
        card.append(el("span","weekly-category",rank+" "+(labels[row.category]||"Other")),
          el("strong","",row.title),
          el("span","weekly-votes","🚫 "+row.off_votes+" off · ✓ "+row.pass_votes+
            " pass"+(row.funny_votes?" · 😂 "+row.funny_votes+" funny":"")));
        card.append(el("p","weekly-qualification",row.qualified?
          (d.archived?"Final weekly podium":"Qualified for the weekly podium"):
          (Number(row.total_votes)>=Number(d.minimum_votes) ?
            "Not qualified: fewer Off votes than Pass and Funny combined" :
            "Provisional · needs "+Math.max(0,d.minimum_votes-row.total_votes)+" more votes")));
        const actions=el("div","weekly-card-actions");
        const view=el("a","jury-next-button","Vote on this case");
        view.href="/nh/?incident="+encodeURIComponent(row.id)+"#incidents";
        const share=el("button","jury-next-button","↗ Share graphic");
        share.type="button";
        share.addEventListener("click",()=>shareCard(row,labels[row.category]||"Weekly Pick",share));
        actions.append(view,share);card.append(actions);grid.append(card);
      }
      if(!podiums.length && chosenCategory!=="funny_unexpected")
        grid.append(el("p","feed-empty",
          chosenCategory ? "No Worst of the Week contenders yet in "+
            (labels[chosenCategory]||"this category")+". Be the first to vote." :
          isCurrent ? "No votes on new cases yet this week. Your verdict could start the board.":
            "No eligible results recorded for this week."));
      if(tallies && isCurrent){
        tallies.replaceChildren();
        for(const entry of (d.category_counts||[]).filter(row =>
          !chosenCategory || row.category===chosenCategory)){
          tallies.append(el("span","",(labels[entry.category]||"Other")+": "+entry.incidents));
        }
      }
      tick();
    }catch{
      status.textContent="Weekly results are temporarily unavailable.";
    }
  }
  // Reuse the existing branded 1200x630 share-card creator for the funniest podium.
  window.vtorShareWeeklyCard = shareCard;
  window.addEventListener("vtor:category-change",() =>
    loadWeekly(Number(weekSelect?.value||0)));
  if(weekSelect)weekSelect.addEventListener("change",()=>loadWeekly(Number(weekSelect.value)));
  window.addEventListener("vtor:vote",()=>{loadProgress();loadWeekly(Number(weekSelect?.value||0));});
  setInterval(tick,1000);
  loadProgress();
  loadWeekly(0);
})();
