"use strict";
(() => {
  const root=document.getElementById("account-profile-panel");
  const accounts=window.VTORAccounts;
  if(!root||!accounts)return;
  const status=document.getElementById("member-profile-status");
  const editor=document.getElementById("member-profile-editor");
  const handle=document.getElementById("member-handle");
  const avatarGrid=document.getElementById("member-avatar-presets");
  const preview=document.getElementById("member-avatar-preview");
  const upload=document.getElementById("member-avatar-upload");
  const uploadButton=document.getElementById("member-avatar-upload-button");
  const removeButton=document.getElementById("member-avatar-remove");
  const save=document.getElementById("member-profile-save");
  const glyphs=["⚖️","🚙","🚧","🛑","🚦","🏎️","👑","🦊"];
  let current=null;
  let selection=0;
  let processing=false;
  const validPhotoUrl=url=>typeof url==="string" &&
    /^\/avatars\/[0-9a-f-]{36}$/i.test(url);
  function message(value){status.textContent=value;}
  function showPreview(){
    preview.replaceChildren();
    if(current?.avatar_url && validPhotoUrl(current.avatar_url)){
      const image=document.createElement("img");
      image.src=current.avatar_url;
      image.alt="Your uploaded avatar";
      preview.append(image);
      removeButton.hidden=false;
    }else{
      preview.textContent=glyphs[selection]||glyphs[0];
      removeButton.hidden=true;
    }
    avatarGrid.querySelectorAll("button").forEach((button,index)=>{
      button.setAttribute("aria-pressed",String(index===selection));
    });
  }
  function busy(value){
    processing=value;
    save.disabled=value;
    uploadButton.disabled=value;
    removeButton.disabled=value;
    avatarGrid.querySelectorAll("button").forEach(button=>button.disabled=value);
  }
  function announceUpdate(){
    window.dispatchEvent(new Event("vtor:profile-updated"));
  }
  function renderProfile(profile){
    current=profile||{handle:null,avatar_preset:0,avatar_url:null};
    selection=Number.isInteger(current.avatar_preset)?current.avatar_preset:0;
    handle.value=current.handle||"";
    showPreview();
  }
  for(let index=0;index<glyphs.length;index++){
    const button=document.createElement("button");
    button.type="button";
    button.className="member-preset";
    button.textContent=glyphs[index];
    button.title="Choose avatar "+(index+1);
    button.setAttribute("aria-label",button.title);
    button.addEventListener("click",async()=>{
      if(processing)return;
      selection=index;
      showPreview();
      if(current?.avatar_url){
        message("Save your profile to switch from the uploaded photo to this preset.");
      }else{
        message("Avatar selected. Save your profile to keep it.");
      }
    });
    avatarGrid.append(button);
  }
  async function refresh(){
    await accounts.ready;
    if(!accounts.getUser()){
      root.hidden=true;
      return;
    }
    root.hidden=false;
    try{
      const result=await accounts.fetchAuthenticated("/api/account/profile");
      if(!result.ready){
        editor.hidden=true;
        message("Profile customization is being enabled. Your account and jury history still work.");
        return;
      }
      editor.hidden=false;
      renderProfile(result.profile);
      message("Your username and avatar are public only on incidents where you enable author credit.");
    }catch(error){
      editor.hidden=true;
      message(error.message||"Profile customization is temporarily unavailable.");
    }
  }
  async function compress(file){
    if(!["image/jpeg","image/png","image/webp"].includes(file.type))
      throw Error("Choose a JPG, PNG or WebP image.");
    if(file.size>12*1024*1024)
      throw Error("Choose a photo smaller than 12 MB.");
    const bitmap=await createImageBitmap(file);
    try{
      const scale=Math.min(1,320/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement("canvas");
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));
      canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const ctx=canvas.getContext("2d");
      if(!ctx)throw Error("Your browser cannot resize this image.");
      ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      for(const quality of [.85,.7,.55,.4]){
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",quality));
        if(blob?.type==="image/webp"&&blob.size<=250*1024)return blob;
      }
      throw Error("Photo is still too large after resizing. Choose a different one.");
    }finally{bitmap.close();}
  }
  save.addEventListener("click",async()=>{
    if(processing)return;
    const value=handle.value.trim();
    if(value&&!/^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(value)){
      message("Username must be 3–20 letters, digits or underscores, starting with a letter.");
      return;
    }
    busy(true);
    message("Saving profile…");
    try{
      const result=await accounts.fetchAuthenticated("/api/account/profile",{
        method:"PATCH",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({handle:value,avatar_preset:selection})
      });
      if(current?.avatar_url && selection!==Number(current.avatar_preset)){
        // A preset selected over an uploaded avatar explicitly replaces it.
        await accounts.fetchAuthenticated("/api/account/avatar",{method:"DELETE"});
      }
      const latest=await accounts.fetchAuthenticated("/api/account/profile");
      renderProfile(latest.profile||result.profile);
      message("Profile saved.");
      announceUpdate();
    }catch(error){message(error.message||"Unable to save profile.");}
    finally{busy(false);}
  });
  uploadButton.addEventListener("click",()=>upload.click());
  upload.addEventListener("change",async()=>{
    const file=upload.files?.[0];
    upload.value="";
    if(!file||processing)return;
    busy(true);
    message("Preparing your profile photo…");
    try{
      const blob=await compress(file);
      const jwt=await accounts.getToken();
      if(!jwt)throw Error("Sign in to upload your photo.");
      const response=await fetch("/api/account/avatar",{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{Authorization:"Bearer "+jwt,"Content-Type":"image/webp"},
        body:blob
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(data.error||"Photo upload failed.");
      renderProfile(data.profile);
      message("Profile photo uploaded.");
      announceUpdate();
    }catch(error){message(error.message||"Photo upload failed.");}
    finally{busy(false);}
  });
  removeButton.addEventListener("click",async()=>{
    if(processing)return;
    busy(true);
    message("Removing your custom photo…");
    try{
      const result=await accounts.fetchAuthenticated("/api/account/avatar",{
        method:"DELETE"
      });
      renderProfile(result.profile);
      message("Photo removed. Your preset avatar is now active.");
      announceUpdate();
    }catch(error){message(error.message||"Couldn't remove the photo.");}
    finally{busy(false);}
  });
  refresh().catch(()=>{message("Could not load your profile.");});
})();
