"use strict";
(() => {
  const feed = document.querySelector("#incident-feed");
  const status = document.querySelector("#feed-status");
  const buttons = [...document.querySelectorAll("[data-feed-sort]")];
  let currentSort = "newest";
  let currentCategory = "";
  const categorySelect = document.querySelector("#feed-category");
  const categoryLabels = {
    bad_parking: "Parking fails", cutting_off: "Cut-offs & close calls",
    tailgating: "Tailgating", distracted: "Distracted driving",
    signal: "Signals & intersections", speeding: "Speeding",
    road_rage: "Road rage", roadside: "Roadside oddities", other: "Other"
  };
  if (!feed || !status) return;

  function element(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined && text !== null) item.textContent = String(text);
    return item;
  }

  function render(incidents) {
    feed.replaceChildren();

    if (incidents.length === 0) {
      const empty = element("div", "feed-empty");
      empty.append(
        element("h3", "", "Nothing on the board. Yet."),
        element("p", "", "The first New Hampshire incidents will show up here when submissions open.")
      );
      feed.append(empty);
      status.textContent = "No published incidents yet.";
      return;
    }

    status.textContent = `Showing ${incidents.length} published incident${incidents.length === 1 ? "" : "s"}.`;

    for (const item of incidents) {
      const card = element("article", "feed-card");
      const meta = element("p", "feed-meta");
      const location = item.location_label || "New Hampshire";
      const date = Number.isFinite(Number(item.created_at))
        ? new Date(Number(item.created_at) * 1000).toLocaleDateString()
        : "";
      meta.textContent = (date ? `${location} · ${date}` : location) +
        (item.category ? " · " + (categoryLabels[item.category] || "Other") : "");
      card.id = "incident-" + item.id;

      card.append(meta, element("h3", "", item.title), element("p", "feed-description", item.description || ""));
      if (Array.isArray(item.photos) && item.photos.length) {
        const gallery = element("div", "feed-gallery");
        gallery.setAttribute("aria-label", "Incident photos, swipe to see more");
        for (let i = 0; i < item.photos.length; i++) {
          const photo = item.photos[i];
          if (typeof photo.url !== "string" || !photo.url.startsWith("/media/")) continue;
          const link = element("a", "feed-photo");
          link.href = photo.url;
          link.target = "_blank";
          link.rel = "noopener";
          const img = element("img");
          img.src = photo.url;
          img.alt = "Incident photo " + (i + 1) + " of " + item.photos.length;
          img.loading = "lazy";
          link.append(img);
          gallery.append(link);
        }
        card.append(gallery);
        if (item.photos.length > 1) card.append(element("p", "gallery-hint", "Swipe to view all " + item.photos.length + " photos"));
      }
      const voteActions = element("div", "feed-vote-actions");
      voteActions.setAttribute("role", "group");
      voteActions.setAttribute("aria-label", "Vote on this driving incident");
      const offButton = element("button", "vote-off");
      const passButton = element("button", "vote-pass");
      offButton.type = "button";
      passButton.type = "button";
      const voteFeedback = element("p", "feed-vote-feedback", "");
      voteFeedback.setAttribute("role", "status");
      voteFeedback.setAttribute("aria-live", "polite");
      const voteHint = element("p", "feed-vote-hint", "One vote per person. You can change your choice.");
      function updateVoteButtons() {
        offButton.textContent = "🚫 Vote Them Off · " + (Number(item.off_votes) || 0);
        passButton.textContent = "✓ Give 'Em a Pass · " + (Number(item.pass_votes) || 0);
        offButton.setAttribute("aria-pressed", String(item.my_vote === "off"));
        passButton.setAttribute("aria-pressed", String(item.my_vote === "pass"));
      }
      async function submitVote(choice) {
        if (offButton.disabled || passButton.disabled) return;
        offButton.disabled = true;
        passButton.disabled = true;
        voteFeedback.textContent = "Saving your vote…";
        try {
          const response = await fetch("/api/incidents/" + encodeURIComponent(item.id) + "/vote", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ choice }),
            cache: "no-store"
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Vote could not be saved");
          item.off_votes = result.off_votes;
          item.pass_votes = result.pass_votes;
          item.my_vote = result.my_vote;
          updateVoteButtons();
          voteFeedback.textContent = "Vote counted! You can change it any time.";
          window.dispatchEvent(new Event("vtor:vote"));
        } catch (error) {
          voteFeedback.textContent = error.message || "Could not save your vote. Try again.";
        } finally {
          offButton.disabled = false;
          passButton.disabled = false;
        }
      }
      offButton.addEventListener("click", () => submitVote("off"));
      passButton.addEventListener("click", () => submitVote("pass"));
      updateVoteButtons();
      voteActions.append(offButton, passButton);
      card.append(voteActions, voteFeedback, voteHint);
      const reportLink = element("a", "feed-report", "Report / request removal");
      reportLink.href = "/nh/report/?id=" + encodeURIComponent(item.id);
      const share = element("button", "feed-share", "↗ Share this moment");
      share.type = "button";
      share.addEventListener("click", async () => {
        const shareUrl = location.origin + "/nh/?incident=" + encodeURIComponent(item.id) + "#incidents";
        try {
          if (navigator.share) {
            await navigator.share({ title: item.title, url: shareUrl });
          } else {
            await navigator.clipboard.writeText(shareUrl);
            share.textContent = "✓ Link copied";
          }
        } catch (error) {
          if (error?.name !== "AbortError") {
            share.textContent = "Share link: " + shareUrl;
          }
        }
      });
      card.append(share, reportLink);
      feed.append(card);
    }
  }

  async function load(sort) {
    currentSort = sort;
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.feedSort === sort));
    }
    status.textContent = "Loading incidents…";
    try {
      const response = await fetch(`/api/incidents?state=NH&sort=${encodeURIComponent(sort)}&category=${encodeURIComponent(currentCategory)}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Feed request failed");
      const data = await response.json();
      if (!Array.isArray(data.incidents)) throw new Error("Unexpected feed response");
      const incidents = data.incidents;
      const sharedId = new URLSearchParams(location.search).get("incident");
      if (sharedId && !currentCategory && /^[a-zA-Z0-9_-]{6,80}$/.test(sharedId) &&
          !incidents.some(i => i.id === sharedId)) {
        const single = await fetch("/api/incidents/" + encodeURIComponent(sharedId),
          { credentials: "same-origin", cache: "no-store" });
        if (single.ok) {
          const row = await single.json();
          if (row?.incident) incidents.unshift(row.incident);
        }
      }
      render(incidents);
      if (sharedId) {
        const target = document.getElementById("incident-" + sharedId);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (error) {
      feed.replaceChildren();
      status.textContent = "The incident feed couldn't load right now. Try refreshing this page.";
    }
  }

  for (const button of buttons) {
    button.addEventListener("click", () => load(button.dataset.feedSort));
  }
  if (categorySelect) categorySelect.addEventListener("change", () => {
    currentCategory = categorySelect.value;
    load(currentSort);
  });
  load("newest");
})();
