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
  let allReports = [];
  const reportFilters = document.createElement("div");
  reportFilters.className = "admin-report-filters";
  const reasonFilter = document.createElement("select");
  reasonFilter.setAttribute("aria-label", "Filter by report reason");
  const statusFilter = document.createElement("select");
  statusFilter.setAttribute("aria-label", "Filter by report status");
  for (const [value, text] of [
    ["", "Every report type"], ["removal_request", "Removal requests"],
    ["harassment", "Harassment or threats"], ["private_info", "Private information"],
    ["false_claim", "False claims"], ["copyright", "Copyright"],
    ["other", "Other"]
  ]) reasonFilter.add(new Option(text, value));
  for (const [value, text] of [
    ["", "Every status"], ["priority", "Automatically hidden · urgent"],
    ["open", "Open"], ["reviewing", "Reviewing"],
    ["resolved", "Resolved"], ["dismissed", "Dismissed"]
  ]) statusFilter.add(new Option(text, value));
  reportFilters.append(reasonFilter, statusFilter);
  reportsNode.before(reportFilters);
  const analytics = document.createElement("div");
  analytics.className = "admin-analytics";
  analytics.setAttribute("aria-label", "Incident and report analytics");
  statsNode.after(analytics);
  function refreshReportFilters() {
    renderReports(allReports.filter(report =>
      (!reasonFilter.value || report.reason === reasonFilter.value) &&
      (!statusFilter.value || (statusFilter.value === "priority" ?
        Boolean(report.auto_hidden_at && report.incident_status === "hidden" &&
          ["open", "reviewing"].includes(report.status)) :
        report.status === statusFilter.value))));
  }
  reasonFilter.addEventListener("change", refreshReportFilters);
  statusFilter.addEventListener("change", refreshReportFilters);

  function renderAnalytics(data) {
    analytics.replaceChildren();
    if (!data) return;
    const title = document.createElement("h3");
    title.textContent = "What's getting reported";
    analytics.append(title);
    const columns = document.createElement("div");
    columns.className = "admin-analytics-columns";
    for (const [heading, rows, key] of [
      ["Report reasons", data.reasons || [], "reason"],
      ["Driving moment categories", data.categories || [], "category"]
    ]) {
      const section = document.createElement("section");
      section.className = "admin-analytics-column";
      section.append(el("h4", "", heading));
      for (const row of rows) {
        section.append(el("p", "", 
          ((key === "category" ? data.category_labels?.[row[key]] :
            label(row[key])) || "Other") + ": " + row.count));
      }
      if (!rows.length) section.append(el("p", "", "No data yet."));
      columns.append(section);
    }
    analytics.append(columns);
  }

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
      const incident = el("p", "admin-subtext", "Incident status: " + label(report.incident_status || "missing") +
        (report.incident_category ? " · " + label(report.incident_category) : "") +
        (report.unique_reporters ? " · " + report.unique_reporters + " distinct reporting browsers in 7 days" : ""));
      if (report.auto_hidden_at && report.incident_status === "hidden" &&
          ["open", "reviewing"].includes(report.status)) {
        item.classList.add("admin-priority");
        item.prepend(el("p", "admin-priority-label",
          "⚠ AUTO-HIDDEN · PRIORITY REVIEW"));
      }
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
        " pass · 😂 " + (incident.funny_votes || 0) + " funny · " +
        incident.pending_reports + " pending reports");
      item.append(heading, meta, counts);
      if (incident.auto_hidden_at && incident.status === "hidden") {
        item.classList.add("admin-priority");
        item.append(el("p", "admin-priority-label", "⚠ AUTO-HIDDEN · REVIEW FIRST"));
      }
      if (incident.category) {
        const categoryEditor=el("div","admin-category-editor");
        const categoryLabel=el("label","","Category");
        const categorySelect=el("select");
        categorySelect.setAttribute("aria-label","Change category for "+incident.title);
        const categories={
          bad_parking:"Parking fails",cutting_off:"Cut-offs & close calls",
          tailgating:"Tailgating",distracted:"Distracted driving",
          signal:"Signals & intersections",speeding:"Speeding",
          road_rage:"Road rage",roadside:"Other roadside oddities",
          funny_unexpected:"😂 Funny / Unexpected",other:"Other"
        };
        for(const [key,name] of Object.entries(categories)){
          categorySelect.append(new Option(name,key));
        }
        categorySelect.value=incident.category;
        categoryEditor.append(categoryLabel,categorySelect);
        categoryEditor.append(actionButton("Save category","action-strong",()=>
          mutate("/admin/api/incidents/"+encodeURIComponent(incident.id),
            {category:categorySelect.value},"Incident category updated.")));
        item.append(categoryEditor);
      }
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
      allReports = reports;
      signedIn.textContent += me.enhanced ?
        " · Auto-hide after " + me.auto_hide_threshold + " independent reports across 3 networks" :
        " · Moderation upgrade awaiting database migration";
      const open = reports.filter(r => ["open", "reviewing"].includes(r.status)).length;
      const live = incidents.filter(i => i.status === "published").length;
      statsNode.replaceChildren();
      for (const [value, description] of [[open, "Open reports"], [live, "Published incidents"], [incidents.length, "Total incidents"]]) {
        const stat = el("div", "admin-stat");
        stat.append(el("strong", "", value), el("span", "", description));
        statsNode.append(stat);
      }
      refreshReportFilters();
      renderIncidents(incidents);
      const analyticsData = await getJson("/admin/api/analytics").catch(() => null);
      renderAnalytics(analyticsData);
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
