"use strict";
(() => {
  const reactionLabels={
    off:"🚫 VOTE THEM OFF",
    pass:"✓ GIVE 'EM A PASS",
    funny:"😂 THAT'S JUST FUNNY!"
  };
  const accents={off:"#f17e50",pass:"#a7e0ab",funny:"#f7c744"};
  function wrap(ctx,text,maxWidth,maxLines=3){
    const lines=[],words=String(text||"").split(/\s+/);
    let current="";
    for(const word of words){
      const next=current?current+" "+word:word;
      if(current&&ctx.measureText(next).width>maxWidth){
        lines.push(current);current=word;
      }else current=next;
      if(lines.length===maxLines)break;
    }
    if(lines.length<maxLines&&current)lines.push(current);
    if(lines.length===maxLines&&words.length>1){
      let last=lines[maxLines-1];
      while(ctx.measureText(last+"…").width>maxWidth&&last.length>2)
        last=last.slice(0,-1);
      lines[maxLines-1]=last+"…";
    }
    return lines.slice(0,maxLines);
  }
  async function createCard({incident,choice,url}){
    const canvas=document.createElement("canvas");
    canvas.width=1200;canvas.height=630;
    const ctx=canvas.getContext("2d");
    if(!ctx)throw Error("Image graphics aren't supported by this browser.");
    ctx.fillStyle="#182b2c";ctx.fillRect(0,0,1200,630);
    ctx.fillStyle=accents[choice]||accents.funny;
    ctx.fillRect(0,0,1200,21);
    ctx.fillStyle="#f7c744";
    ctx.font="bold 33px sans-serif";
    ctx.fillText("VOTE THEM OFF THE ROAD",60,96);
    ctx.fillStyle="#d7e2db";ctx.font="bold 23px sans-serif";
    ctx.fillText("YOU BE THE JUDGE · MY VERDICT",60,154);
    ctx.fillStyle=accents[choice]||"#f7c744";
    ctx.font="bold 48px sans-serif";
    ctx.fillText(reactionLabels[choice]||"I CAST MY VERDICT",60,233);
    ctx.fillStyle="#fffefa";ctx.font="bold 61px sans-serif";
    const lines=wrap(ctx,incident.title,1060,3);
    lines.forEach((line,index)=>ctx.fillText(line,60,325+index*75));
    ctx.fillStyle="#bcd1c8";ctx.font="21px sans-serif";
    ctx.fillText("Community opinion · Not a verified traffic violation",60,565);
    ctx.fillText("votethemofftheroad.com/nh/",60,603);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
    if(!blob)throw Error("Couldn't create your share card.");
    return {blob,filename:"my-jury-verdict-"+incident.id.slice(0,8)+".png",url};
  }
  async function share(args){
    const choice=args.choice;
    if(!reactionLabels[choice])throw Error("Vote on this case first to share your verdict.");
    const link=args.url||location.origin+"/nh/?incident="+encodeURIComponent(args.incident.id);
    const card=await createCard({...args,url:link});
    const file=new File([card.blob],card.filename,{type:"image/png"});
    if(typeof navigator.share==="function"&&navigator.canShare?.({files:[file]})){
      try{
        await navigator.share({files:[file],title:"I cast my verdict",
          text:"What would you vote? "+args.incident.title,url:link});
        return "Share card sent through your device's share menu.";
      }catch(error){
        if(error?.name==="AbortError")return "Sharing cancelled.";
        // Fall back to saving the card instead of silently losing it.
      }
    }
    const objectUrl=URL.createObjectURL(card.blob);
    const download=document.createElement("a");
    download.href=objectUrl;
    download.download=card.filename;
    document.body.append(download);download.click();download.remove();
    setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);
    return "Your verdict graphic was saved. Use Share on Facebook to share the case link, and attach the graphic to your post.";
  }
  window.VTORShareVerdict={share};
})();
