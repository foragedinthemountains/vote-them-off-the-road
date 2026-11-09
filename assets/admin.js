"use strict";
(() => {
  const reportsNode = document.querySelector("#admin-reports");
  const incidentsNode = document.querySelector("#admin-incidents");
  const statsNode = document.querySelector("#admin-stats");
  const statusNode = document.querySelector("#admin-status");
  const signedIn = document.querySelector("#admin-signed-in");
  const refresh = document.querySelector("#refresh-admin");
  if (!reportsNode || !incidentsNode || !statusNode) return;
  let busy = false;

  function el(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined && value !== null) node.textContent = String(value);
    return node;
  }
  function label(status) {
    return (status || "").replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
  }
  function formatDate(seconds) {
    const d = new Date(Number(seconds) * 1000);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
  }
  function showError(error) {
    statusNode.textContent = error.message || String(error) || "Unexpected error";
    statusNode.dataset.state = "error";
  }
  async function getJson(url, options) {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(data?.error || "Unable to load admin data. Your sign-in may have expired.");
    return data;
  }
  function actionButton(text, className, handler) {
    const button = el("button", className, text);
    button.type = "button";
    button.addEventListener("click", handler);
    return button;
  }
  async function mutate(url, body, success, method = "PATCH") {
    if (busy) return;
    busy = true;
    refresh.disabled = true;
    statusNode.textContent = "Saving changes…";
    statusNode.dataset.state = "";
    try {
      await getJson(url, {
        method,
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(body)
      });
      await load();
      statusNode.textContent = success;
      statusNode.dataset.state = "ok";
    } catch (e) {
      showError(e);
    } finally {
      busy = false;
      refresh.disabled = false;
    }
  }
  function renderReports(reports) {
    reportsNode.replaceChildren();
    if (!reports.length) {
      reportsNode.append(el("div", "admin-empty", "No reports have been submitted yet."));
      return;
    }
    for (const report of reports) {
      const item = el("article", "admin-item");
      const heading = el("div", "admin-item-top");
      heading.append(
        el("h3", "", report.incident_title || "Incident no longer present"),
        el("span", "admin-chip state-" + (report.status || "open"), label(report.status))
      );
      const meta = el("p", "admin-meta", label(report.reason) + " · " + formatDate(report.created_at));
      const incident = el("p", "admin-subtext", "Incident status: " + label(report.incident_status || "missing"));
      item.append(heading, meta, incident);
      if (report.details) item.append(el("p", "admin-details", report.details));
      if (report.contact_email) item.append(el("p", "admin-contact", "Reply email: " + report.contact_email));
      const actions = el("div", "admin-actions");
      if (report.incident_status === "published" && ["open", "reviewing"].includes(report.status)) {
        actions.append(actionButton("Hide post & resolve", "action-danger", () =>
          mutate("/admin/api/reports/" + encodeURIComponent(report.id),
            { action: "hide_and_resolve" }, "Post hidden and report resolved.")));
      }
      if (report.status !== "reviewing" && report.status !== "resolved") {
        actions.append(actionButton("Mark reviewing", "action-subtle", () =>
          mutate("/admin/api/reports/" + encodeURIComponent(report.id),
            { action: "reviewing" }, "Report marked as reviewing.")));
      }
      if (report.status !== "resolved") {
        actions.append(actionButton("Resolve", "action-subtle", () =>
          mutate("/admin/api/reports/" + encodeURIComponent(report.id),
            { action: "resolve" }, "Report resolved.")));
      }
      if (report.status !== "dismissed") {
        actions.append(actionButton("Dismiss", "action-subtle", () =>
          mutate("/admin/api/reports/" + encodeURIComponent(report.id),
            { action: "dismiss" }, "Report dismissed.")));
      }
      if (report.status === "resolved" || report.status === "dismissed") {
        actions.append(actionButton("Reopen", "action-subtle", () =>
          mutate("/admin/api/reports/" + encodeURIComponent(report.id),
            { action: "reopen" }, "Report reopened.")));
      }
      item.append(actions);
      reportsNode.append(item);
    }
  }
  function renderIncidents(incidents) {
    incidentsNode.replaceChildren();
    if (!incidents.length) {
      incidentsNode.append(el("div", "admin-empty", "No incidents found."));
      return;
    }
    for (const incident of incidents) {
      const item = el("article", "admin-item");
      const heading = el("div", "admin-item-top");
      heading.append(el("h3", "", incident.title),
        el("span", "admin-chip state-" + incident.status, label(incident.status)));
      const meta = el("p", "admin-meta",
        (incident.location_label || "New Hampshire") + " · " + formatDate(incident.created_at));
      const counts = el("p", "admin-subtext",
        "🚫 " + incident.off_votes + " off · ✓ " + incident.pass_votes +
        " pass · " + incident.pending_reports + " pending reports");
      item.append(heading, meta, counts);
      const actions = el("div", "admin-actions");
      if (incident.status === "published") {
        actions.append(actionButton("Hide from site", "action-danger", () =>
          mutate("/admin/api/incidents/" + encodeURIComponent(incident.id),
            { status: "hidden" }, "Incident hidden from the public site.")));
      } else {
        actions.append(actionButton("Republish", "action-strong", () =>
          mutate("/admin/api/incidents/" + encodeURIComponent(incident.id),
            { status: "published" }, "Incident published.")));
      }
      if (incident.status !== "removed") {
        actions.append(actionButton("Remove from site", "action-subtle", () => {
          if (confirm("Remove this incident from the public site? Its data will remain in D1 and R2 until permanently deleted.")) {
            mutate("/admin/api/incidents/" + encodeURIComponent(incident.id),
              { status: "removed" }, "Incident removed from public pages.");
          }
        }));
      }
      actions.append(actionButton("Permanently delete + photos", "action-delete", () => {
        const typed = prompt("PERMANENT DELETION: This erases the incident, its photos, votes and reports. It cannot be undone. Type DELETE to confirm:");
        if (typed !== "DELETE") return;
        mutate("/admin/api/incidents/" + encodeURIComponent(incident.id),
          { confirm: "DELETE " + incident.id }, "Incident and its stored photos permanently deleted.", "DELETE");
      }));
      item.append(actions);
      incidentsNode.append(item);
    }
  }
  async function load() {
    statusNode.textContent = "Loading dashboard…";
    statusNode.dataset.state = "";
    try {
      const [me, reportsData, incidentsData] = await Promise.all([
        getJson("/admin/api/me"),
        getJson("/admin/api/reports"),
        getJson("/admin/api/incidents")
      ]);
      signedIn.textContent = "Signed in as " + me.email +
        (me.alerts_configured ? " · Email alerts configured" : " · Email alerts awaiting setup");
      const reports = reportsData.reports || [];
      const incidents = incidentsData.incidents || [];
      const open = reports.filter(r => ["open", "reviewing"].includes(r.status)).length;
      const live = incidents.filter(i => i.status === "published").length;
      statsNode.replaceChildren();
      for (const [value, description] of [[open, "Open reports"], [live, "Published incidents"], [incidents.length, "Total incidents"]]) {
        const stat = el("div", "admin-stat");
        stat.append(el("strong", "", value), el("span", "", description));
        statsNode.append(stat);
      }
      renderReports(reports);
      renderIncidents(incidents);
      statusNode.textContent = "Dashboard up to date.";
      statusNode.dataset.state = "ok";
    } catch (error) {
      showError(error);
      reportsNode.replaceChildren();
      incidentsNode.replaceChildren();
      statsNode.replaceChildren();
    }
  }
  refresh.addEventListener("click", () => { if (!busy) load(); });
  load();
})();
