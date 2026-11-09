"use strict";
(() => {
  const panel = document.querySelector("#featured-case");
  if (!panel) return;
  let dayKey = null;
  let nextReset = 0;
  const make = (tag, className, value) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (value !== undefined && value !== null) el.textContent = String(value);
    return el;
  };
  async function load() {
    try {
      const response = await fetch("/api/featured-case", {
        cache: "no-store", credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error("Daily case unavailable");
      const data = await response.json();
      dayKey = data.day;
      nextReset = Number(data.next_reset_at || 0);
      panel.replaceChildren();
      const item = data.incident;
      if (!item) {
        const empty = make("div", "featured-empty");
        empty.append(make("strong", "", "TODAY'S JURY PICK"),
          make("p", "", "No published cases available yet. Submit one to start the voting board."));
        const submit = make("a", "featured-vote-link", "＋ Submit a case");
        submit.href = "/nh/submit/";
        empty.append(submit);
        panel.append(empty);
        return;
      }
      const main = make("div", "featured-case-body");
      const label = make("span", "featured-eyebrow", "⚡ TODAY'S JURY PICK");
      const name = make("h3", "", item.title);
      name.id = "featured-title";
      const category = typeof item.category === "string" ? item.category.replace(/_/g, " ") : "Driving story";
      const description = make("p", "featured-description",
        (item.description || "").length > 220 ? item.description.slice(0, 220) + "…" : item.description || "");
      const meta = make("p", "featured-meta",
        (item.location_label || "New Hampshire") + " · " + category);
      const totals = make("p", "featured-votes", 
        "🚫 " + Number(item.off_votes || 0) + " Vote Them Off   ·   ✓ " +
        Number(item.pass_votes || 0) + " Give 'Em a Pass" +
        (Number(item.funny_votes||0)>0?"   ·   😂 "+item.funny_votes+" Funny":""));
      const actions = make("div", "featured-actions");
      const detailUrl = "/nh/?incident=" + encodeURIComponent(item.id) + "#incidents";
      const vote = make("a", "featured-vote-link", item.my_vote ?
        "✓ View your verdict" : "⚖ Vote on today's case");
      vote.href = detailUrl;
      const facebook = make("a", "featured-facebook", "f  Share on Facebook");
      facebook.href = "https://www.facebook.com/sharer/sharer.php?u=" +
        encodeURIComponent(location.origin + "/nh/?incident=" + encodeURIComponent(item.id));
      facebook.target = "_blank";
      facebook.rel = "noopener noreferrer";
      facebook.setAttribute("aria-label", "Share today's case on Facebook (opens in a new tab)");
      actions.append(vote, facebook);
      main.append(label, name, meta, description, totals, actions);
      panel.append(main);
      const photo = Array.isArray(item.photos) ? item.photos[0] : null;
      if (photo && typeof photo.url === "string" && photo.url.startsWith("/media/")) {
        const link = make("a", "featured-photo");
        link.href = detailUrl;
        link.setAttribute("aria-label", "See photos and vote on today's case");
        const image = make("img");
        image.src = photo.url;
        image.alt = "Photo submitted with today's featured driving case";
        image.loading = "lazy";
        link.append(image);
        panel.append(link);
      }
    } catch {
      panel.replaceChildren();
      panel.append(make("p", "featured-loading", 
        "Today's featured case isn't available right now. You can still vote in the board below."));
    }
  }
  // A day change updates the chosen case without the visitor needing to reload.
  setInterval(() => {
    if (nextReset && Date.now() >= nextReset * 1000) {
      nextReset = 0;
      load();
    }
  }, 60000);
  load();
})();