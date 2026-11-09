"use strict";
(() => {
  const feed = document.querySelector("#incident-feed");
  const status = document.querySelector("#feed-status");
  const buttons = [...document.querySelectorAll("[data-feed-sort]")];
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
      meta.textContent = date ? `${location} · ${date}` : location;

      card.append(meta, element("h3", "", item.title), element("p", "feed-description", item.description || ""));
      const votes = element("div", "feed-vote-counts");
      votes.append(
        element("span", "", `🚫 Vote off: ${Number(item.off_votes) || 0}`),
        element("span", "", `✓ Give a pass: ${Number(item.pass_votes) || 0}`)
      );
      card.append(votes);
      const reportLink = element("a", "feed-report", "Report / request removal");
      reportLink.href = "/nh/report/?id=" + encodeURIComponent(item.id);
      card.append(reportLink);
      feed.append(card);
    }
  }

  async function load(sort) {
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.feedSort === sort));
    }
    status.textContent = "Loading incidents…";
    try {
      const response = await fetch(`/api/incidents?state=NH&sort=${encodeURIComponent(sort)}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Feed request failed");
      const data = await response.json();
      if (!Array.isArray(data.incidents)) throw new Error("Unexpected feed response");
      render(data.incidents);
    } catch (error) {
      feed.replaceChildren();
      status.textContent = "The incident feed couldn't load right now. Try refreshing this page.";
    }
  }

  for (const button of buttons) {
    button.addEventListener("click", () => load(button.dataset.feedSort));
  }
  load("newest");
})();
