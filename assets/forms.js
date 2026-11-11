"use strict";
(() => {
  const form = document.querySelector("#community-form");
  const status = document.querySelector("#form-status");
  const mode = document.body.dataset.formMode;
  if (!form || !status || !["submit", "report"].includes(mode)) return;
  const incidentId = new URLSearchParams(location.search).get("id");
  let widgetId;
  let saving = false;
  let photosEnabled = false;
  let selectedPhotos = [];
  const photoInput = document.querySelector("#photos");
  const photoUpload = document.querySelector("#photo-upload");
  const photoPreview = document.querySelector("#photo-preview");
  const photoHelp = document.querySelector("#photo-help");
  const postingMode=document.querySelector("#posting-mode");
  const postingStatus=document.querySelector("#posting-mode-status");
  const postAsGuest=document.querySelector("#post-as-guest");
  const postingGuestOption=document.querySelector("#posting-guest-option");
  const postingCreditOption=document.querySelector("#posting-credit-option");
  const postShowAuthor=document.querySelector("#post-show-author");
  async function updatePostingMode(){
    if(mode!=="submit" || !postingMode || !postingStatus)return;
    postingMode.hidden=false;
    postingStatus.textContent="Checking how your story will be saved…";
    try{
      await window.VTORAccounts?.ready;
      const account=window.VTORAccounts;
      const user=account?.state.enabled && account.getUser();
      if(user){
        postingGuestOption.hidden=false;
        const label=user.email||"your account";
        let eligibleForCredit=false;
        try{
          const profile=await account.fetchAuthenticated("/api/account/profile");
          eligibleForCredit=profile.ready===true && !!profile.profile?.handle;
        }catch{ /* Profiles may not have been enabled in D1 yet. */ }
        const refresh=()=>{
          const guest=postAsGuest.checked;
          postingStatus.textContent=guest?
            "Posting as a guest. Save the private management link afterward.":
            "Posting to your account ("+label+").";
          if(postingCreditOption)postingCreditOption.hidden=guest||!eligibleForCredit;
          if(guest&&postShowAuthor)postShowAuthor.checked=false;
        };
        postAsGuest.addEventListener("change",refresh);
        refresh();
      }else{
        if(postingGuestOption)postingGuestOption.hidden=true;
        postingStatus.textContent=
          "Posting as a guest. Save the private management link afterward.";
      }
    }catch{
      if(postingGuestOption)postingGuestOption.hidden=true;
      postingStatus.textContent=
        "Posting as a guest. Save the private management link afterward.";
    }
  }
  const maxPhotos = 5;
  const maxImageBytes = 5 * 1024 * 1024;
  function showPhotos() {
    if (!photoPreview) return;
    photoPreview.replaceChildren();
    for (let i = 0; i < selectedPhotos.length; i++) {
      const file = selectedPhotos[i];
      const card = document.createElement("div");
      card.className = "photo-preview-item";
      const img = document.createElement("img");
      img.alt = "Selected photo " + (i + 1);
      const objectUrl = URL.createObjectURL(file);
      img.src = objectUrl;
      img.onload = () => URL.revokeObjectURL(objectUrl);
      img.onerror = () => URL.revokeObjectURL(objectUrl);
      const label = document.createElement("span");
      label.textContent = i === 0 ? "Cover photo" : "Photo " + (i + 1);
      const up = document.createElement("button");
      up.type = "button";
      up.textContent = "↑";
      up.setAttribute("aria-label", "Move photo earlier");
      up.disabled = i === 0;
      up.onclick = () => { [selectedPhotos[i-1], selectedPhotos[i]] = [selectedPhotos[i], selectedPhotos[i-1]]; showPhotos(); };
      const down = document.createElement("button");
      down.type = "button";
      down.textContent = "↓";
      down.setAttribute("aria-label", "Move photo later");
      down.disabled = i === selectedPhotos.length - 1;
      down.onclick = () => { [selectedPhotos[i+1], selectedPhotos[i]] = [selectedPhotos[i], selectedPhotos[i+1]]; showPhotos(); };
      card.append(img, label, up, down);
      photoPreview.append(card);
    }
  }
  if (photoInput) photoInput.addEventListener("change", () => {
    const files = Array.from(photoInput.files || []);
    if (files.length > maxPhotos) {
      photoInput.value = "";
      selectedPhotos = [];
      showPhotos();
      message("Choose up to five photos per story.");
      return;
    }
    if (files.some(f => !["image/jpeg", "image/png", "image/webp"].includes(f.type) || f.size > 12 * 1024 * 1024)) {
      photoInput.value = "";
      selectedPhotos = [];
      showPhotos();
      message("Choose JPG, PNG, or WebP photos under 12 MB before optimization.");
      return;
    }
    selectedPhotos = files;
    showPhotos();
    message("Ready when you are.");
  });
  async function optimizePhoto(file, index) {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Image conversion unavailable");
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.82));
      if (!blob || blob.type !== "image/webp") throw new Error("WebP conversion unavailable");
      if (blob.size > maxImageBytes) throw new Error("A photo is still over 5 MB after resizing.");
      return new File([blob], "photo-" + (index + 1) + ".webp", { type: "image/webp" });
    } finally { bitmap.close(); }
  }
  function message(text, link) {
    status.textContent = text;
    if (link) {
      const a = document.createElement("a");
      a.href = link;
      a.textContent = " View the New Hampshire feed.";
      status.append(a);
    }
  }
  async function initialize() {
    if (mode === "report" && !/^[a-zA-Z0-9_-]{6,80}$/.test(incidentId || "")) {
      message("No incident was selected. Use the report link from a story on the New Hampshire feed.");
      return;
    }
    try {
      const response = await fetch("/api/config", { cache: "no-store" });
      if (!response.ok) throw new Error("Configuration unavailable");
      const config = await response.json();
      const categoryField = document.querySelector("#behavior-category-field");
      if (categoryField) categoryField.hidden = config.community_features_enabled !== true;
      if (mode === "report") {
        const note = document.querySelector("#report-moderation-note");
        if (note) note.textContent = config.community_features_enabled ?
          "Only one report per browser per incident. " + config.auto_hide_report_threshold +
          " independent reporting browsers across at least 3 networks in 7 days automatically hide a post pending review." :
          "Reports are queued for review. Automated hiding activates after the database upgrade.";
      }
      if (mode === "submit" && photoUpload) {
        photosEnabled = config.photos_enabled === true;
        photoUpload.hidden = !photosEnabled;
        if (photoHelp) photoHelp.textContent = photosEnabled
          ? "Up to five photos. The first photo is the cover. Use the arrows to reorder."
          : "Photo uploads are being connected. Text stories are available now.";
      }
      if (!config.submissions_enabled || !config.turnstile_site_key) {
        message("This form is being prepared. It opens once our spam protection is configured.");
        return;
      }
      window.vtorTurnstileReady = () => {
        try {
          widgetId = window.turnstile.render("#turnstile-challenge", {
            sitekey: config.turnstile_site_key,
            action: mode === "report" ? "report" : "submit",
            theme: "light",
            "error-callback": (code) => {
              console.warn("Turnstile failed with code:", code);
              message("Verification could not connect (Cloudflare code: " + String(code) + "). Try a private window or another network, then share this code.");
            },
            "unsupported-callback": () => {
              message("Turnstile reports that this browser is not supported. Try Chrome, Firefox, or Edge.");
            }
          });
          form.hidden = false;
          if(mode==="submit")updatePostingMode();
          message("Ready when you are.");
        } catch {
          message("Verification could not load. Refresh and try again.");
        }
      };
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=vtorTurnstileReady";
      script.async = true;
      script.onerror = () => message("Verification could not load. Refresh and try again.");
      document.head.append(script);
    } catch {
      message("The form could not connect. Refresh and try again.");
    }
  }
  function showIncidentManagement(result){
    if(mode!=="submit")return;
    const old=document.querySelector("#incident-management-confirmation");
    if(old)old.remove();
    const panel=document.createElement("div");
    panel.id="incident-management-confirmation";
    panel.className="owner-confirmation";
    const heading=document.createElement("h3");
    heading.textContent="Your incident is posted!";
    panel.append(heading);
    if(result.owner_type==="guest"&&result.management_token){
      const saved=window.VTORGuestSubmissions?.save(result.id,result.management_token,
        form.querySelector("#title")?.value || "");
      const origin=location.origin;
      const privateLink=origin+"/nh/manage/?id="+encodeURIComponent(result.id)+
        "#key="+encodeURIComponent(result.management_token);
      const description=document.createElement("p");
      description.textContent="Save this private link now. It is the key to editing or removing your post later, without creating an account. Anyone with the link could manage the post. Do not publish it.";
      const input=document.createElement("input");
      input.type="text";input.value=privateLink;input.readOnly=true;
      input.setAttribute("aria-label","Your private incident management link");
      const copy=document.createElement("button");
      copy.type="button";copy.className="btn btn-secondary";
      copy.textContent="Copy private management link";
      copy.addEventListener("click",async()=>{
        try{
          await navigator.clipboard.writeText(privateLink);
          copy.textContent="✓ Private link copied";
        }catch{
          input.focus();input.select();
          copy.textContent="Select and copy the link above";
        }
      });
      const open=document.createElement("a");
      open.href=privateLink;open.className="owner-private-link";
      open.rel="noreferrer";open.textContent="Manage this incident ↗";
      panel.append(description,input,copy,open);
      const note=document.createElement("p");
      note.textContent=saved?
        "Also saved in this browser under My Submissions. Keep a backup of your private link in case browser data is cleared.":
        "This browser could not save the link. Copy it now to avoid losing access.";
      const savedPage=document.createElement("a");
      savedPage.href="/nh/my-submissions/";
      savedPage.textContent="Go to My Submissions";
      panel.append(note,savedPage);
    }else if(result.owner_type==="account"){
      const p=document.createElement("p");
      p.textContent="This incident belongs to your account. You can edit or remove it from My Incidents.";
      const link=document.createElement("a");
      link.href="/nh/account/";link.className="btn btn-secondary";
      link.textContent="Open My Incidents";
      panel.append(p,link);
    }else{
      const p=document.createElement("p");
      p.textContent="Guest management links are not yet enabled. Save the incident link and contact the site administrator if you need changes.";
      panel.append(p);
    }
    form.insertAdjacentElement("afterend",panel);
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving || !form.reportValidity()) return;
    const token = window.turnstile?.getResponse(widgetId);
    if (!token) return message("Complete the verification before posting.");
    saving = true;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    message("Sending…");
    const values = new FormData(form);
    let payload = mode === "submit" ? {
      title: values.get("title"), location_label: values.get("location_label"),
      category: values.get("category") || "other",
      description: values.get("description"), turnstile_token: token,
      show_author:postAsGuest?.checked!==true && postShowAuthor?.checked===true
    } : {
      reason: values.get("reason"), details: values.get("details"),
      contact_email: values.get("contact_email"), turnstile_token: token
    };
    let isMultipart = false;
    try {
      if (mode === "submit" && selectedPhotos.length) {
        if (!photosEnabled) throw new Error("Photo uploads are not available yet.");
        const data = new FormData();
        for (const [key, value] of Object.entries(payload)) data.append(key, value);
        message("Preparing photos for upload…");
        for (let i = 0; i < selectedPhotos.length; i++) {
          data.append("photos", await optimizePhoto(selectedPhotos[i], i));
        }
        payload = data;
        isMultipart = true;
      }
    } catch (error) {
      saving = false;
      button.disabled = false;
      message(error.message || "Could not prepare photos. Try smaller pictures.");
      window.turnstile?.reset(widgetId);
      return;
    }
    const endpoint = mode === "submit" ? "/api/incidents" :
      "/api/incidents/" + encodeURIComponent(incidentId) + "/reports";
    try {
      const postHeaders=new Headers();
      if(!isMultipart)postHeaders.set("Content-Type","application/json");
      // Public accounts are OPTIONAL; without a signed-in WorkOS session this
      // remains the existing anonymous Turnstile-protected submission flow.
      const isGuestPost=mode!=="submit" || postAsGuest?.checked===true;
      const accountToken=isGuestPost?null:await window.VTORAccounts?.getToken();
      if(accountToken)postHeaders.set("Authorization","Bearer "+accountToken);
      const response = await fetch(endpoint, {
        method: "POST",credentials:"same-origin",
        headers:postHeaders,
        body: isMultipart ? payload : JSON.stringify(payload), cache: "no-store"
      });
      const result = await response.json();
      if (!response.ok) {
        message(result.error || "Could not send. Please try again.");
        window.turnstile?.reset(widgetId);
      } else {
        message(mode === "submit" ? "Your story is posted!" :
          result.auto_hidden ? "Report received. This post was temporarily hidden for review." :
          result.duplicate ? "You already reported this incident. Thank you." :
          "Report received. Thank you.",
          mode === "submit" ? "/nh/#incidents" : null);
        form.hidden = true;
        if(mode==="submit")showIncidentManagement(result);
      }
    } catch {
      message("Could not connect. Please try again.");
      window.turnstile?.reset(widgetId);
    } finally {
      saving = false;
      button.disabled = false;
    }
  });
  initialize();
})();
