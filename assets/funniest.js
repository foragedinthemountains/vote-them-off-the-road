"use strict";
(() => {
  const grid=document.querySelector("#funniest-grid");
  const status=document.querySelector("#funniest-status");
  const weekSelect=document.querySelector("#weekly-week-select");
  const categorySelect=document.querySelector("#feed-category");
  const panel=document.querySelector("#funniest");
  if(!grid||!status)return;
  const el=(tag,cls,text)=>{
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    if(text!=null)node.textContent=String(text);
    return node;
  };
  const dateLabel=seconds=>new Date(Number(seconds)*1000).toLocaleDateString("en-US",{
    timeZone:"America/New_York",month:"short",day:"numeric",year:"numeric"
  });
  let generation=0;
  function showCoverPhoto(card,row) {
    const photo=Array.isArray(row.photos)?row.photos[0]:null;
    if(typeof photo?.url!=="string" ||
       !/^\/media\/[A-Za-z0-9_-]{6,80}$/.test(photo.url)) return;
    const link=el("a","weekly-card-photo");
    link.href="/nh/?incident="+encodeURIComponent(row.id)+"#incidents";
    link.setAttribute("aria-label","View full incident and all photos");
    const image=el("img");
    image.src=photo.url;
    image.alt="Photo submitted with "+String(row.title||"this incident");
    image.loading="lazy";
    link.append(image);
    card.append(link);
  }
  async function refresh(offset=0){
    const req=++generation;
    const chosenCategory=categorySelect?.value||"";
    if(panel)panel.hidden=!!chosenCategory && chosenCategory!=="funny_unexpected";
    if(panel?.hidden)return;
    grid.replaceChildren();
    status.textContent="Finding the funniest community picks…";
    try{
      const response=await fetch("/api/weekly-funniest?offset="+encodeURIComponent(offset)+
        (chosenCategory ? "&category="+encodeURIComponent(chosenCategory) : ""),{
        cache:"no-store",credentials:"same-origin"
      });
      if(!response.ok)throw new Error("Funniest board unavailable");
      const data=await response.json();
      if(req!==generation)return;
      if(!data.ready){
        status.textContent="Funniest Moment voting opens after the 0004 database upgrade.";
        return;
      }
      const podiums=data.podiums||[];
      status.textContent=(offset?"Week of ":"This week, starting ")+
        dateLabel(data.week_start)+". "+
        (data.archived?"Final award results. ":"Weekly standings update as votes arrive. ")+
        data.minimum_votes+" combined reactions or duel points and a Funny majority qualify for the official title.";
      if(!podiums.length){
        grid.append(el("p","funny-empty",offset?
          "No qualifying funny moments recorded for that week.":
          "No funny nominees yet. Submit a Funny / Unexpected case to get the weekly laughs started!"));
        return;
      }
      for(const row of podiums){
        const card=el("article","weekly-card funniest-card"+(row.qualified?"":" provisional"));
        const rank = row.qualified ?
          ({1:"🥇",2:"🥈",3:"🥉"}[row.rank] || "#"+row.rank) :
          "#"+row.rank;
        const duelWins=Number(row.funny_battle_wins||0);
        const funnyScore=Number(row.funny_score??
          (Number(row.funny_votes||0)+duelWins));
        card.append(el("span","weekly-category",rank+
          (row.qualified?" · FUNNIEST MOMENT OF THE WEEK":" · FUNNIEST MOMENT NOMINEE")),
          el("strong","",row.title),
          el("span","weekly-votes","😂 "+Number(row.funny_votes||0)+
            " Funny reactions + ⚔️ "+duelWins+" comedy duel wins = "+funnyScore+
            " Funniest points"),
          el("span","weekly-votes","🚫 "+Number(row.off_votes||0)+" Off · ✓ "+
            Number(row.pass_votes||0)+" Pass"));
        const qualification=row.qualified?
          (data.archived?"🏆 Official Funniest Moment of the Week":"Currently qualified · Final winner announced after the week ends"):
          Number(row.total_votes)===0?
            "New contender · Be the first to react 😂":
          Number(row.total_votes)<Number(data.minimum_votes)?
            "Needs "+Math.max(0,data.minimum_votes-Number(row.total_votes))+
            " more reactions or duel points to qualify" :
            "Needs a majority of Funny reactions to qualify";
        if(row.author?.handle)
          card.append(el("p","weekly-author","Posted by @"+row.author.handle));
        showCoverPhoto(card,row);
        card.append(el("p","weekly-qualification",qualification));
        const controls=el("div","weekly-card-actions");
        const voteLink=el("a","jury-next-button","😂 React to this case");
        const caseLink="/nh/?incident="+encodeURIComponent(row.id)+"#incidents";
        voteLink.href=caseLink;
        const fb=el("a","jury-next-button funny-fb","f Share on Facebook");
        fb.href="https://www.facebook.com/sharer/sharer.php?u="+
          encodeURIComponent(location.origin+"/nh/?incident="+encodeURIComponent(row.id));
        fb.target="_blank";
        fb.rel="noopener noreferrer";
        fb.setAttribute("aria-label","Share funny incident on Facebook (opens in new tab)");
        controls.append(voteLink,fb);
        const share=el("button","jury-next-button","↗ Share winner graphic");
        share.type="button";
        share.addEventListener("click",()=>{
          if(typeof window.vtorShareWeeklyCard==="function")
            window.vtorShareWeeklyCard(row,"Funniest Moment of the Week",share);
          else share.textContent="Refresh to enable sharing";
        });
        controls.append(share);
        card.append(controls);
        grid.append(card);
      }
    }catch{
      if(req===generation)status.textContent="The funniest weekly board is temporarily unavailable.";
    }
  }
  window.addEventListener("vtor:category-change",() =>
    refresh(Number(weekSelect?.value||0)));
  if(weekSelect)weekSelect.addEventListener("change",()=>refresh(Number(weekSelect.value)));
  window.addEventListener("vtor:vote",()=>refresh(Number(weekSelect?.value||0)));
  window.addEventListener("vtor:battle",()=>refresh(Number(weekSelect?.value||0)));
  refresh(0);
})();
