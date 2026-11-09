"use strict";
(() => {
  const form = document.querySelector("#community-form");
  const status = document.querySelector("#form-status");
  const mode = document.body.dataset.formMode;
  if (!form || !status || !["submit", "report"].includes(mode)) return;
  const incidentId = new URLSearchParams(location.search).get("id");
  let widgetId;
  let saving = false;
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
      if (!config.submissions_enabled || !config.turnstile_site_key) {
        message("This form is being prepared. It opens once our spam protection is configured.");
        return;
      }
      window.vtorTurnstileReady = () => {
        try {
          widgetId = window.turnstile.render("#turnstile-challenge", {
            sitekey: config.turnstile_site_key,
            action: mode === "report" ? "report" : "submit",
            theme: "light"
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
    const payload = mode === "submit" ? {
      title: values.get("title"), location_label: values.get("location_label"),
      description: values.get("description"), turnstile_token: token
    } : {
      reason: values.get("reason"), details: values.get("details"),
      contact_email: values.get("contact_email"), turnstile_token: token
    };
    const endpoint = mode === "submit" ? "/api/incidents" :
      "/api/incidents/" + encodeURIComponent(incidentId) + "/reports";
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload), cache: "no-store"
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
