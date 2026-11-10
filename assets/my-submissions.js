"use strict";
(() => {
  const store = window.VTORGuestSubmissions;
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
  function render() {
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
        if (incident.status === "removed") {
          detail.textContent = "Removed from public view.";
          manage.textContent = "View removed incident";
        } else if (incident.status === "hidden") {
          detail.textContent = "Hidden or pending moderation review.";
        } else {
          detail.textContent = "Published. You can edit or remove this post.";
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
