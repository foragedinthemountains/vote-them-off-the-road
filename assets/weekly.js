"use strict";
(() => {
  const weeklyGrid = document.querySelector("#weekly-grid");
  const weeklyStatus = document.querySelector("#weekly-status");
  const tallies = document.querySelector("#category-tallies");
  const juryProgress = document.querySelector("#jury-progress");
  if (!weeklyGrid || !weeklyStatus) return;
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  };
  async function loadProgress() {
    if (!juryProgress) return;
    try {
      const response = await fetch("/api/my-stats", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Unavailable");
      const data = await response.json();
      const votes = Number(data.votes || 0);
      const next = data.next_badge_at === null ? "Top badge unlocked" :
        Math.max(0, Number(data.next_badge_at) - votes) + " to next badge";
      juryProgress.replaceChildren(el("strong", "", "⚖ " + data.badge),
        el("span", "", votes + " incidents voted on · " + next));
    } catch {
      juryProgress.replaceChildren(el("span", "", "Jury progress will appear after your first vote."));
    }
  }
  async function loadWeekly() {
    try {
      const response = await fetch("/api/weekly-board", { cache: "no-store" });
      if (!response.ok) throw new Error("Unavailable");
      const data = await response.json();
      if (!data.ready) {
        weeklyStatus.textContent = "Weekly category rankings open after the database upgrade.";
        return;
      }
      const labels = data.categories || {};
      const select = document.querySelector("#feed-category");
      if (select) {
        select.replaceChildren(new Option("All categories", ""));
        for (const [value, label] of Object.entries(labels)) {
          select.append(new Option(label, value));
        }
        select.disabled = false;
      }
      const weekLabel = new Date(Number(data.week_start) * 1000).toLocaleDateString(
        undefined, { month: "short", day: "numeric", timeZone: "UTC" });
      weeklyStatus.textContent = "Week of " + weekLabel +
        " (UTC). Only currently published stories posted this week qualify.";
      weeklyGrid.replaceChildren();
      for (const row of data.leaders || []) {
        const card = el("a", "weekly-card");
        card.href = "/nh/?incident=" + encodeURIComponent(row.id) + "#incidents";
        card.append(el("span", "weekly-category", labels[row.category] || "Other"),
          el("strong", "", row.title),
          el("span", "weekly-votes", "🚫 " + row.off_votes +
            " Vote Them Off · ✓ " + row.pass_votes + " Give a Pass"));
        weeklyGrid.append(card);
      }
      if (!(data.leaders || []).length) {
        weeklyGrid.append(el("div", "feed-empty",
          "No weekly votes yet. Pick your first case below to start the board."));
      }
      if (tallies) {
        tallies.replaceChildren();
        for (const row of data.category_counts || []) {
          tallies.append(el("span", "", (labels[row.category] || "Other") +
            ": " + Number(row.incidents || 0)));
        }
      }
    } catch {
      weeklyStatus.textContent = "Weekly results are temporarily unavailable.";
    }
  }
  window.addEventListener("vtor:vote", () => {
    loadProgress();
    loadWeekly();
  });
  loadProgress();
  loadWeekly();
})();
