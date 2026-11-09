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
      description: values.get("description"), turnstile_token: token
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
      const response = await fetch(endpoint, {
        method: "POST",
        headers: isMultipart ? undefined : { "Content-Type": "application/json" },
        body: isMultipart ? payload : JSON.stringify(payload), cache: "no-store"
      });
      const result = await response.json();
      if (!response.ok) {
        message(result.error || "Could not send. Please try again.");
        window.turnstile?.reset(widgetId);
      } else {
        message(mode === "submit" ? "Your story is posted!" : "Report received. Thank you.",
          mode === "submit" ? "/nh/#incidents" : null);
        form.hidden = true;
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
