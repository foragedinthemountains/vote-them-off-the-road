"use strict";
(() => {
  const status=document.querySelector("#owner-status");
  const form=document.querySelector("#owner-edit-form");
  const removeButton=document.querySelector("#owner-remove");
  const claimButton=document.querySelector("#owner-claim");
  const access=document.querySelector("#owner-access-info");
  const photoList=document.querySelector("#owner-photo-list");
  if(!status||!form)return;
  const params=new URLSearchParams(location.search);
  const incidentId=params.get("id")||"";
  const fragment=new URLSearchParams(location.hash.replace(/^#/,""));
  let managementKey=fragment.get("key")||"";
  let busy=false;
  if(!/^[A-Za-z0-9_-]{6,80}$/.test(incidentId)){
    status.textContent="No incident selected. Open your private management link or visit My Account.";
    return;
  }
  async function headers(body=false,forceAccount=false){
    const result=new Headers();
    if(body)result.set("Content-Type","application/json");
    if(managementKey)result.set("X-Incident-Manage-Key",managementKey);
    // In normal guest-link mode, don't add an unrelated signed-in identity.
    if(forceAccount||!managementKey){
      const jwt=await window.VTORAccounts?.getToken();
      if(jwt)result.set("Authorization","Bearer "+jwt);
    }
    return result;
  }
  async function action(method,path,payload,forceAccount=false){
    const response=await fetch(path,{
      method,headers:await headers(payload!==undefined,forceAccount),
      credentials:"same-origin",cache:"no-store",
      body:payload===undefined?undefined:JSON.stringify(payload)
    });
    const data=await response.json().catch(()=>({error:"Unexpected response"}));
    if(!response.ok)throw Error(data.error||"Incident action failed");
    return data;
  }
  const url="/api/owner/incidents/"+encodeURIComponent(incidentId);
  async function load(){
    form.hidden=true;removeButton.disabled=true;claimButton.hidden=true;
    status.textContent="Checking permission to manage this incident…";
    try{
      const data=await action("GET",url);
      const incident=data.incident;
      let storageWarning=false;
      if(data.owner_access==="guest"&&managementKey){
        storageWarning=!window.VTORGuestSubmissions?.save(incidentId,managementKey,incident.title||"");
      }
      document.querySelector("#owner-title").value=incident.title||"";
      document.querySelector("#owner-description").value=incident.description||"";
      document.querySelector("#owner-location").value=incident.location_label||"";
      document.querySelector("#owner-category").value=incident.category||"other";
      photoList.replaceChildren();
      for(const photo of incident.photos||[]){
        if(!photo.url?.startsWith("/media/"))continue;
        const image=document.createElement("img");
        image.src=photo.url;image.loading="lazy";
        image.alt="Photo from your incident";
        photoList.append(image);
      }
      const allowed=data.can_edit===true;
      form.hidden=!allowed;removeButton.disabled=!allowed;
      access.textContent=storageWarning?
        "Your browser could not save this private link. Back it up securely.":
        data.owner_access==="guest"?
        "You're using the private guest management link. Keep it safe. You may claim this case with an account later.":
        "You're managing this case with your verified account.";
      status.textContent=incident.status==="removed"?
        "This incident has already been removed from public view.":
        incident.status==="hidden"?
          "This case is currently hidden, possibly pending moderation review.":
          "You may edit this incident. Save changes to update it.";
      if(data.owner_access==="guest"&&managementKey){
        const auth=await window.VTORAccounts?.getToken();
        claimButton.hidden=!auth;
      }
    }catch(error){
      status.textContent=error.message;
      access.textContent="For guest submissions, open the original private management link. For account-owned submissions, sign in first.";
    }
  }
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    if(busy||!form.reportValidity())return;
    busy=true;
    const button=form.querySelector('button[type="submit"]');
    button.disabled=true;
    status.textContent="Saving your changes…";
    const data={
      title:document.querySelector("#owner-title").value,
      description:document.querySelector("#owner-description").value,
      location_label:document.querySelector("#owner-location").value,
      category:document.querySelector("#owner-category").value
    };
    try{
      const result=await action("PATCH",url,data);
      if(!result.unchanged&&managementKey)
        window.VTORGuestSubmissions?.save(incidentId,managementKey,data.title);
      status.textContent=result.message||(result.unchanged?
        "No changes were needed.":"Changes saved.");
      if(result.pending_review){
        access.textContent="Your updated case is hidden until an administrator reviews the edit.";
      }
    }catch(error){status.textContent=error.message;}
    finally{busy=false;button.disabled=false;}
  });
  removeButton.addEventListener("click",async()=>{
    if(busy||!window.confirm(
      "Remove this incident from public view? This does not permanently erase private moderation records."))return;
    busy=true;removeButton.disabled=true;
    try{
      const result=await action("DELETE",url);
      status.textContent=result.message;
      form.hidden=true;
    }catch(error){status.textContent=error.message;removeButton.disabled=false;}
    finally{busy=false;}
  });
  claimButton.addEventListener("click",async()=>{
    if(busy||!managementKey)return;
    if(!window.confirm("Attach this guest incident to your signed-in account? Your old private guest link will stop working."))return;
    busy=true;claimButton.disabled=true;
    try{
      const result=await action("POST",url+"/claim",{},true);
      status.textContent=result.message;
      // Invalidate the old capability fragment locally as well as in D1.
      managementKey="";
      history.replaceState(history.state,"",location.pathname+location.search);
      await load();
    }catch(error){status.textContent=error.message;claimButton.disabled=false;}
    finally{busy=false;}
  });
  load();
})();
