"use strict";
(() => {
  const store = window.VTORGuestSubmissions;
  const accounts = window.VTORAccounts;
  const list = document.querySelector("#guest-submissions-list");
  const status = document.querySelector("#guest-submissions-status");
  const importForm = document.querySelector("#guest-import-form");
  const importInput = document.querySelector("#guest-import-link");
  const importStatus = document.querySelector("#guest-import-status");
  if (!store || !list || !status) return;
  const create = (tag, className, content) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  };
  const photoObjectUrls=new Set();
  let generation=0;
  function clearPhotos(){
    generation++;
    for(const url of photoObjectUrls)URL.revokeObjectURL(url);
    photoObjectUrls.clear();
  }
  window.addEventListener("pagehide",clearPhotos);
  function render() {
    clearPhotos();
    const current=generation;
    list.replaceChildren();
    const records = store.list();
    status.textContent = records.length ?
      records.length + " guest submission" + (records.length === 1 ? "" : "s") +
        " saved in this browser." :
      "No guest submissions saved in this browser yet.";
    if (!records.length) {
      list.append(create("p", "owner-hint",
        "When you post a new story as a guest, it will appear here automatically. " +
        "Older posts can be added if you still have their private management links."));
      return;
    }
    for (const entry of records) {
      const card = create("article", "owner-case");
      const heading = create("strong", "", entry.title || "Guest submission");
      const detail = create("p", "owner-hint", "Checking current post status…");
      const actions = create("div", "owner-case-actions");
      const manage = create("a", "btn btn-primary", "Edit / remove incident");
      manage.href = store.manageUrl(entry);
      manage.rel = "noreferrer";
      const forget = create("button", "btn btn-secondary", "Forget on this browser");
      forget.type = "button";
      forget.addEventListener("click", () => {
        if (!confirm(
          "Forget this private management link on this browser? " +
          "This will NOT remove the incident from the public site. " +
          "Without a separately saved link, you may permanently lose guest access."
        )) return;
        if (!store.forget(entry.id)) {
          status.textContent = "Could not update browser storage. Check your browser settings.";
          return;
        }
        render();
      });
      actions.append(manage, forget);
      card.append(heading, detail, actions);
      list.append(card);
      // Never put private tokens into a URL query or visible post text.
      fetch("/api/owner/incidents/" + encodeURIComponent(entry.id), {
        headers: {"X-Incident-Manage-Key": entry.key, "Accept": "application/json"},
        credentials: "same-origin",
        cache: "no-store"
      }).then(async response => {
        if (!response.ok) {
          detail.textContent = response.status === 403 || response.status === 404 ?
            "This saved link no longer grants access. It may have been claimed or revoked." :
            "Could not check this incident right now. You can still try your saved link.";
          return;
        }
        const data = await response.json();
        const incident = data.incident;
        if (!incident || typeof incident.id !== "string") {
          detail.textContent = "Could not read the incident status.";
          return;
        }
        heading.textContent = incident.title || entry.title || "Guest submission";
        const photo=(incident.photos||[])[0];
        if(typeof photo?.url==="string" &&
           /^\/api\/owner\/media\/[A-Za-z0-9_-]{6,80}$/.test(photo.url)){
          const link=create("a","owner-case-photo");
          link.target="_blank";link.rel="noopener noreferrer";
          link.setAttribute("aria-label","Open full incident photo");
          const image=create("img");
          image.alt="Photo from your guest incident";
          image.loading="lazy";
          link.append(image);
          card.insertBefore(link,actions);
          fetch(photo.url,{
            headers:{"X-Incident-Manage-Key":entry.key},
            credentials:"same-origin",cache:"no-store"
          }).then(async response=>{
            if(!response.ok || !response.headers.get("Content-Type")?.startsWith("image/"))
              throw Error("Cannot load photo");
            const imageUrl=URL.createObjectURL(await response.blob());
            if(current!==generation || !link.isConnected){
              URL.revokeObjectURL(imageUrl);return;
            }
            photoObjectUrls.add(imageUrl);
            image.src=imageUrl;link.href=imageUrl;
          }).catch(()=>link.remove());
        }
        if (incident.status === "removed") {
          detail.textContent = "Removed from public view.";
          manage.textContent = "View removed incident";
        } else if (incident.status === "hidden") {
          detail.textContent = "Hidden or pending moderation review.";
        } else {
          detail.textContent = "Published. You can edit or remove this post.";
        }
        // Claim is offered only after the guest management key has been
        // verified AND the browser is signed in. No silent bulk transfers.
        if(accounts){
          await accounts.ready;
          if(current!==generation || !card.isConnected)return;
          if(accounts.state.enabled && accounts.getUser()){
            const claim=create("button","btn btn-secondary","Add to my account");
            claim.type="button";
            const feedback=create("p","owner-hint");
            feedback.setAttribute("role","status");
            claim.addEventListener("click",async()=>{
              if(claim.disabled)return;
              if(!confirm("Add this guest incident to your signed-in account? "+
                "You'll manage it from My Account, and the old private link will stop working."))return;
              claim.disabled=true;
              claim.textContent="Adding to account…";
              feedback.textContent="";
              try{
                const jwt=await accounts.getToken();
                if(!jwt)throw Error("Please sign in before adding this incident.");
                const response=await fetch(
                  "/api/owner/incidents/"+encodeURIComponent(entry.id)+"/claim",{
                    method:"POST",credentials:"same-origin",cache:"no-store",
                    headers:{
                      "Authorization":"Bearer "+jwt,
                      "X-Incident-Manage-Key":entry.key,
                      "Content-Type":"application/json",
                      "Accept":"application/json"
                    },
                    body:"{}"
                  });
                const result=await response.json().catch(()=>({}));
                if(!response.ok)throw Error(result.error||"Unable to add this incident.");
                // Revoke the now-invalid guest key locally only AFTER the
                // server confirms the atomic ownership transfer succeeded.
                const forgotten=store.forget(entry.id);
                render();
                status.replaceChildren(
                  document.createTextNode(
                    forgotten?"Added to your account. Find it under My Incidents. ":
                    "Added to your account. This browser could not clear the old guest link. "
                  )
                );
                const link=create("a","","Open My Account");
                link.href="/nh/account/";
                status.append(link);
              }catch(error){
                feedback.textContent=error?.message||"Unable to add this incident.";
                claim.textContent="Add to my account";
                claim.disabled=false;
              }
            });
            actions.insertBefore(claim,forget);
            card.append(feedback);
          }
        }
        // A title edited here or in moderation stays updated in the saved list.
        if (incident.title && incident.title !== entry.title)
          store.save(entry.id, entry.key, incident.title);
      }).catch(() => {
        detail.textContent = "Offline or unable to check status. Your link remains saved.";
      });
    }
  }
  importForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const parsed = store.fromPrivateLink(importInput.value);
    if (!parsed) {
      importStatus.textContent =
        "Paste a complete private management link from votethemofftheroad.com.";
      return;
    }
    const button = importForm.querySelector('button[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    importStatus.textContent = "Checking private management permission…";
    try {
      const response = await fetch(
        "/api/owner/incidents/" + encodeURIComponent(parsed.id), {
          headers: {
            "X-Incident-Manage-Key": parsed.key,
            "Accept": "application/json"
          },
          credentials: "same-origin",
          cache: "no-store"
        }
      );
      if (!response.ok) {
        importStatus.textContent = response.status === 403 || response.status === 404 ?
          "This link does not grant guest management access to that incident." :
          "Could not verify this link right now. Try again later.";
        return;
      }
      const data = await response.json();
      if (data.owner_access !== "guest" || data.incident?.id !== parsed.id) {
        importStatus.textContent = "The response did not confirm guest ownership.";
        return;
      }
      if (!store.save(parsed.id, parsed.key, data.incident.title || "")) {
        importStatus.textContent = "Could not save the link in this browser.";
        return;
      }
      importInput.value = "";
      importStatus.textContent = "Verified! Private link saved in this browser.";
      render();
    } catch {
      importStatus.textContent = "Could not verify the link. Check your connection.";
    } finally {
      button.disabled = false;
    }
  });
  render();
})();
