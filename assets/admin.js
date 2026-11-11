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
  const growthNode=document.createElement("section");
  growthNode.className="admin-growth";
  growthNode.setAttribute("aria-labelledby","growth-title");
  statsNode.after(growthNode);
  let growthDays=30;
  let growthReq=0;
  function growthStat(label,value,detail){
    const card=el("div","growth-stat");
    card.append(el("strong","",value),el("span","growth-stat-label",label));
    if(detail)card.append(el("span","growth-stat-detail",detail));
    return card;
  }
  function renderGrowth(data,error){
    growthNode.replaceChildren();
    const head=el("div","growth-head");
    const titleWrap=el("div");
    titleWrap.append(el("span","section-kicker","Launch performance"),
      el("h2","","Growth & engagement"));
    const period=el("select","growth-period");
    period.setAttribute("aria-label","Growth reporting period");
    for(const days of [7,30,90]){
      period.append(new Option("Last "+days+" days",String(days)));
    }
    period.value=String(growthDays);
    period.addEventListener("change",()=>{
      growthDays=Number(period.value);
      loadGrowth();
    });
    head.append(titleWrap,period);
    growthNode.append(head);
    if(error){
      growthNode.append(el("p","growth-note",
        "Growth stats could not load. Moderation is still available."));
      return;
    }
    if(!data){
      growthNode.append(el("p","growth-note","Loading growth metrics…"));
      return;
    }
    const p=data.period||{},total=data.totals||{};
    const num=value=>Number(value||0).toLocaleString();
    const cards=el("div","growth-stats");
    const items=[
      ["New submissions",num(p.submissions),"In selected period"],
      ["With photos",num(p.photo_submissions),"Submitted incidents with images"],
      ["Reactions",num(p.reactions),"Recorded incident votes"],
      ["Active jurors",num(p.active_voter_identities),"Browser/account voting identities"],
      ["Repeat jurors",num(p.repeat_voter_identities)+
        " ("+Number(p.repeat_voter_percent||0)+"%)",
        "Voted on at least two different days"]
    ];
    if(p.new_accounts!==null && p.new_accounts!==undefined){
      items.push(["New accounts",num(p.new_accounts),"Registered member records"]);
    }
    for(const entry of items)cards.append(growthStat(...entry));
    growthNode.append(cards);
    growthNode.append(el("p","growth-note",
      "All time: "+num(total.submissions)+" submitted incidents · "+
      num(total.published)+" currently published · "+
      num(total.reactions)+" current recorded votes. "+
      "Daily dates use UTC."));
    const daily=Array.isArray(data.daily)?data.daily:[];
    const recent=daily.slice(-14);
    const maximum=Math.max(1,...recent.flatMap(row=>
      [Number(row.submissions)||0,Number(row.reactions)||0]));
    const bars=el("div","growth-chart");
    bars.setAttribute("aria-label","Last "+recent.length+
      " days of submissions and incident votes");
    bars.append(el("h3","","Daily participation"),
      el("p","growth-legend","Yellow: submissions · Green: reactions"));
    const plot=el("div","growth-plot");
    for(const row of recent){
      const day=el("div","growth-day");
      const pair=el("div","growth-bar-pair");
      for(const [value,cls] of [
        [Number(row.submissions)||0,"growth-bar-submission"],
        [Number(row.reactions)||0,"growth-bar-reaction"]]){
        const bar=el("div","growth-bar "+cls);
        bar.style.height=Math.max(value>0?6:0,value/maximum*100)+"%";
        bar.title=value+" "+(cls==="growth-bar-submission"?
          "submissions":"reactions")+" on "+row.day;
        pair.append(bar);
      }
      const stamp=el("span","growth-day-label",
        typeof row.day==="string"?row.day.slice(5):"");
      day.append(pair,stamp);plot.append(day);
    }
    bars.append(plot);
    growthNode.append(bars);
    const details=el("details","growth-details");
    details.append(el("summary","","View the daily data table"));
    const table=el("table","growth-table");
    const thead=el("thead");
    const header=el("tr");
    for(const t of ["Date (UTC)","Submissions","Reactions"]){
      header.append(el("th","",t));
    }
    thead.append(header);table.append(thead);
    const body=el("tbody");
    for(const row of [...daily].reverse()){
      const tr=el("tr");
      for(const value of [row.day,num(row.submissions),num(row.reactions)]){
        tr.append(el("td","",value));
      }
      body.append(tr);
    }
    table.append(body);
    details.append(table);
    growthNode.append(details);
    const traffic=el("div","growth-traffic");
    traffic.append(el("h3","","Where visitors come from"),
      el("p","growth-note",
        "Use Cloudflare Web Analytics for page views, referring sites, "+
        "devices and countries. These are separate from the jury "+
        "activity counts above. A visitor-to-submission conversion "+
        "rate cannot be calculated reliably from these two sources."));
    const link=el("a","btn btn-secondary","Open Cloudflare analytics");
    link.href="https://dash.cloudflare.com/";
    link.target="_blank";
    link.rel="noopener noreferrer";
    traffic.append(link);
    growthNode.append(traffic);
  }
  async function loadGrowth(){
    const seq=++growthReq;
    renderGrowth(null,false);
    try{
      const data=await getJson("/admin/api/growth?days="+growthDays);
      if(seq===growthReq)renderGrowth(data,false);
    }catch(error){
      if(seq===growthReq)renderGrowth(null,true);
    }
  }
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
  function renderPhotoGallery(item, photos, context) {
    if (!Array.isArray(photos) || !photos.length) return;
    const gallery=el("div","admin-photo-gallery");
    gallery.setAttribute("aria-label",context+" photos");
    for (let i=0;i<photos.length;i++) {
      const photo=photos[i];
      // These admin-only URLs are authenticated by Cloudflare Access.
      if (typeof photo?.url!=="string" ||
          !/^\/admin\/media\/[A-Za-z0-9_-]{6,80}$/.test(photo.url)) continue;
      const link=el("a","admin-photo-link");
      link.href=photo.url;
      link.target="_blank";
      link.rel="noopener noreferrer";
      link.title="Open full photo "+(i+1);
      const image=el("img");
      image.src=photo.url;
      image.alt=context+" photo "+(i+1)+" of "+photos.length;
      image.loading="lazy";
      link.append(image);
      gallery.append(link);
    }
    if (gallery.childElementCount) item.append(gallery);
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
      renderPhotoGallery(item,report.photos,"Reported incident");
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
      renderPhotoGallery(item,incident.photos,"Incident");
      if (incident.auto_hidden_at && incident.status === "hidden") {
        item.classList.add("admin-priority");
        item.append(el("p", "admin-priority-label", "⚠ AUTO-HIDDEN · REVIEW FIRST"));
      }
      const categoryEditor=el("div","admin-category-editor");
      const categoryLabel=el("label","","Change category");
      const categorySelect=el("select");
      const categories={
        bad_parking:"Parking fails",cutting_off:"Cut-offs & close calls",
        tailgating:"Tailgating",distracted:"Distracted driving",
        signal:"Signals & intersections",speeding:"Speeding",
        road_rage:"Road rage",roadside:"Other roadside oddities",
        funny_unexpected:"😂 Funny / Unexpected",other:"Other"
      };
      const selectId="category-"+incident.id;
      categorySelect.id=selectId;
      categoryLabel.htmlFor=selectId;
      categorySelect.setAttribute("aria-label","Change category for "+incident.title);
      for(const [key,name] of Object.entries(categories)){
        categorySelect.append(new Option(name,key));
      }
      categorySelect.value=Object.hasOwn(categories,incident.category)
        ? incident.category : "other";
      const currentCategory=el("p","admin-category-current",
        "Current: "+(categories[incident.category]||"Other"));
      categoryEditor.append(categoryLabel,currentCategory,categorySelect);
      categoryEditor.append(actionButton("Save category","action-strong",()=>
        mutate("/admin/api/incidents/"+encodeURIComponent(incident.id),
          {category:categorySelect.value},"Incident category updated.")));
      item.append(categoryEditor);
      if(Number(incident.author_edits||0)>0){
        const total=Number(incident.author_edits);
        const notice=el("p","admin-priority-label",
          "✎ AUTHOR CHANGES RECORDED · "+total+
          " previous version"+(total===1?"":"s"));
        const history=el("div","admin-edit-history");
        history.hidden=true;
        const show=actionButton("Review author edit history","action-strong",async()=>{
          if(!history.hidden){history.hidden=true;return;}
          show.disabled=true;
          history.replaceChildren(el("p","","Loading past versions…"));
          try{
            const data=await getJson("/admin/api/incidents/"+
              encodeURIComponent(incident.id)+"/edits");
            history.replaceChildren();
            if(!data.edits?.length){
              history.append(el("p","","No author edit history available."));
            }
            for(const old of data.edits||[]){
              const version=el("section","admin-edit-version");
              version.append(el("strong","",formatDate(old.created_at)+
                " · Previous "+(old.previous_status||"")+" version"));
              version.append(el("p","",
                "Title: "+(old.previous_title||"")+" · Category: "+
                (old.previous_category||"other")));
              version.append(el("p","",old.previous_description||""));
              history.append(version);
            }
          }catch(error){
            history.replaceChildren(el("p","",error.message||"Could not load edits."));
          }finally{
            show.disabled=false;
            history.hidden=false;
          }
        });
        item.append(notice,show,history);
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
      await loadGrowth();
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
