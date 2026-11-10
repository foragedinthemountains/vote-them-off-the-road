"use strict";
(() => {
  const juryFetch=(path,options)=>
    window.VTORAccounts?.juryFetch?
      window.VTORAccounts.juryFetch(path,options):fetch(path,options);
  const feed = document.querySelector("#incident-feed");
  const status = document.querySelector("#feed-status");
  const buttons = [...document.querySelectorAll("[data-feed-sort]")];
  const pageParams = new URLSearchParams(window.location.search);
  const sharedCaseId = pageParams.get("incident");
  const startingCategory = pageParams.get("category");
  let currentSort = sharedCaseId ? "newest" : "unvoted";
  let nextOffset = 0;
  let hasMore = false;
  let loading = false;
  let requestVersion = 0;
  const moreButton = document.querySelector("#feed-more");
  let currentCategory = "";
  let categoryChosenByVisitor = false;
  let categoryAutoSelected = false;
  let funnyEnabled = false;
  const categorySelect = document.querySelector("#feed-category");
  const categoryLabels = {
    bad_parking: "Parking fails", cutting_off: "Cut-offs & close calls",
    tailgating: "Tailgating", distracted: "Distracted driving",
    signal: "Signals & intersections", speeding: "Speeding",
    road_rage: "Road rage", roadside: "Roadside oddities",
    funny_unexpected: "Funny / Unexpected", other: "Other"
  };
  if (!feed || !status) return;

  function element(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined && text !== null) item.textContent = String(text);
    return item;
  }


  function setCategory(category, reload = false, chosenByVisitor = false) {
    const next = Object.hasOwn(categoryLabels, category) ? category : "";
    const changed = currentCategory !== next;
    currentCategory = next;
    if (chosenByVisitor) categoryChosenByVisitor = true;
    if (categorySelect) categorySelect.value = next;
    if (changed) {
      const url = new URL(window.location.href);
      if (next) url.searchParams.set("category", next);
      else url.searchParams.delete("category");
      // Preserve the incident permalink, hash and browser back history.
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      window.dispatchEvent(new CustomEvent("vtor:category-change", {
        detail: { category: next, label: categoryLabels[next] || "All categories" }
      }));
    }
    if (reload) load(currentSort);
  }
  function installCategoryFilter() {
    if (!categorySelect) return;
    // This list was previously never populated: the select remained disabled.
    categorySelect.replaceChildren(new Option("All categories", ""));
    for (const [category, name] of Object.entries(categoryLabels)) {
      categorySelect.append(new Option(name, category));
    }
    categorySelect.disabled = false;
    categorySelect.addEventListener("change", () => {
      setCategory(categorySelect.value, true, true);
    });
    if (startingCategory && Object.hasOwn(categoryLabels, startingCategory)) {
      setCategory(startingCategory, false, true);
    }
    // Keep the control enabled if the config request fails transiently.
    juryFetch("/api/config", { cache: "no-store", credentials: "same-origin" })
      .then(response => response.ok ? response.json() : null)
      .then(config => {
        if (!config) return;
        categorySelect.disabled = config.community_features_enabled !== true;
        if (config.community_features_enabled !== true)
          categorySelect.title = "Category filtering is temporarily unavailable";
        else categorySelect.removeAttribute("title");
      }).catch(() => {});
  }

  function render(incidents, append = false) {
    if (!append) feed.replaceChildren();

    if (incidents.length === 0 && !append) {
      const empty = element("div", "feed-empty");
      empty.append(
        element("h3", "", currentSort === "unvoted" ? "You're all caught up!" : "Nothing on the board. Yet."),
        element("p", "", currentSort === "unvoted" ?
          "You've voted on every available case. Check out the other jury games or come back for new submissions." :
          "New driving incidents will appear here when they're submitted.")
      );
      feed.append(empty);
      status.textContent = currentSort === "unvoted" ?
        "All caught up! No unjudged published cases remain." :
        "No cases match this view right now.";
      return;
    }

    for (const item of incidents) {
      if (document.getElementById("incident-" + item.id)) continue;
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
      if (item.category === "funny_unexpected") {
        const contest = element("a", "feed-contest-label",
          "😂 Funniest Moment of the Week contender · See standings");
        contest.href = "/nh/#funniest";
        card.append(contest);
      }
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
      const funnyButton = element("button", "vote-funny");
      offButton.type = "button";
      passButton.type = "button";
      funnyButton.type = "button";
      if(funnyEnabled)voteActions.classList.add("has-funny");
      const voteFeedback = element("p", "feed-vote-feedback", "");
      voteFeedback.setAttribute("role", "status");
      voteFeedback.setAttribute("aria-live", "polite");
      const voteHint = element("p", "feed-vote-hint",
        "One reaction per account when signed in, or per browser as a guest. Changing your choice earns no extra XP.");
      let myVerdictButton = null;
      function updateVoteButtons() {
        offButton.textContent = "🚫 Vote Them Off · " + (Number(item.off_votes) || 0);
        passButton.textContent = "✓ Give 'Em a Pass · " + (Number(item.pass_votes) || 0);
        funnyButton.textContent = "😂 That's Just Funny! · " + (Number(item.funny_votes) || 0);
        offButton.setAttribute("aria-pressed", String(item.my_vote === "off"));
        passButton.setAttribute("aria-pressed", String(item.my_vote === "pass"));
        funnyButton.setAttribute("aria-pressed", String(item.my_vote === "funny"));
        if(myVerdictButton)myVerdictButton.hidden=!item.my_vote;
      }
      async function submitVote(choice) {
        if (offButton.disabled || passButton.disabled || funnyButton.disabled) return;
        offButton.disabled = true;
        passButton.disabled = true;
        funnyButton.disabled = true;
        voteFeedback.textContent = "Saving your vote…";
        try {
          const response = await juryFetch("/api/incidents/" + encodeURIComponent(item.id) + "/vote", {
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
          item.funny_votes = result.funny_votes;
          item.my_vote = result.my_vote;
          updateVoteButtons();
          voteFeedback.textContent = currentSort === "unvoted" ?
            "Verdict saved! Keep going with the other unjudged cases." :
            "Vote counted! You can change it any time.";
          window.dispatchEvent(new Event("vtor:vote"));
        } catch (error) {
          voteFeedback.textContent = error.message || "Could not save your vote. Try again.";
        } finally {
          offButton.disabled = false;
          passButton.disabled = false;
          funnyButton.disabled = false;
        }
      }
      offButton.addEventListener("click", () => submitVote("off"));
      passButton.addEventListener("click", () => submitVote("pass"));
      funnyButton.addEventListener("click", () => submitVote("funny"));
      updateVoteButtons();
      voteActions.append(offButton, passButton);
      if(funnyEnabled)voteActions.append(funnyButton);
      card.append(voteActions, voteFeedback, voteHint);
      const reportLink = element("a", "feed-report", "Report / request removal");
      reportLink.href = "/nh/report/?id=" + encodeURIComponent(item.id);
      // A prominent direct Facebook link plus platform choices.
      // Only published incidents are in this feed; hidden incidents return 404 at the linked URL.
      const shareUrl = window.location.origin + "/nh/?incident=" +
        encodeURIComponent(item.id) + "#incidents";
      const socialUrl = new URL(shareUrl);
      socialUrl.hash = "";
      const headline = item.title + " | Vote Them Off the Road";
      const fbLink = element("a", "feed-share-facebook", "f  Share on Facebook");
      fbLink.href = "https://www.facebook.com/sharer/sharer.php?u=" +
        encodeURIComponent(socialUrl.href);
      fbLink.target = "_blank";
      fbLink.rel = "noopener noreferrer";
      fbLink.setAttribute("aria-label", "Share this case on Facebook (opens in a new tab)");
      const shareMenu = element("details", "feed-share-menu");
      const toggle = element("summary", "", "↗ Share this case");
      const options = element("div", "feed-share-options");
      const x = element("a", "", "Post on X");
      x.href = "https://x.com/intent/tweet?url=" +
        encodeURIComponent(socialUrl.href) + "&text=" +
        encodeURIComponent("What would you vote? " + item.title);
      const reddit = element("a", "", "Post on Reddit");
      reddit.href = "https://www.reddit.com/submit?url=" +
        encodeURIComponent(socialUrl.href) + "&title=" + encodeURIComponent(headline);
      const whatsapp = element("a", "", "Send via WhatsApp");
      whatsapp.href = "https://wa.me/?text=" +
        encodeURIComponent("What would you vote? " + item.title + " " + shareUrl);
      for (const link of [x, reddit, whatsapp]) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      const copy = element("button", "", "Copy case link");
      copy.type = "button";
      copy.addEventListener("click", async () => {
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(shareUrl);
          } else {
            const field = document.createElement("textarea");
            field.value = shareUrl;
            field.setAttribute("readonly", "");
            field.style.position = "fixed";
            field.style.opacity = "0";
            document.body.append(field);
            field.select();
            const ok = document.execCommand("copy");
            field.remove();
            if (!ok) throw new Error("Browser denied clipboard access");
          }
          copy.textContent = "✓ Link copied";
        } catch {
          copy.textContent = "Copy the URL in your address bar";
          const text = element("input", "feed-share-link");
          text.type = "text";
          text.readOnly = true;
          text.value = shareUrl;
          options.append(text);
          text.focus();
          text.select();
        }
      });
      options.append(x, reddit, whatsapp, copy);
      if (typeof navigator.share === "function") {
        const more = element("button", "", "More apps / messages");
        more.type = "button";
        more.addEventListener("click", async () => {
          try {
            await navigator.share({ title: headline, url: shareUrl });
          } catch (error) {
            if (error?.name !== "AbortError") more.textContent = "Sharing unavailable";
          }
        });
        options.append(more);
      }
      shareMenu.append(toggle, options);
      const shareRow = element("div", "feed-share-row");
      myVerdictButton=element("button","feed-share-verdict","🎨 Share My Verdict");
      myVerdictButton.type="button";
      myVerdictButton.hidden=!item.my_vote;
      myVerdictButton.addEventListener("click",async()=>{
        if(!item.my_vote){
          voteFeedback.textContent="Cast your vote first, then share your verdict.";
          return;
        }
        if(!window.VTORShareVerdict?.share){
          voteFeedback.textContent="The share-card generator isn't available yet. Refresh the page.";
          return;
        }
        myVerdictButton.disabled=true;
        const text=myVerdictButton.textContent;
        myVerdictButton.textContent="Preparing your verdict card…";
        try{
          const message=await window.VTORShareVerdict.share({
            incident:item,choice:item.my_vote,url:socialUrl.href
          });
          voteFeedback.textContent=message;
        }catch(error){
          voteFeedback.textContent=error?.message||"Could not generate the share card.";
        }finally{
          myVerdictButton.disabled=false;
          myVerdictButton.textContent=text;
        }
      });
      shareRow.append(fbLink, shareMenu, myVerdictButton);
      card.append(shareRow, reportLink);
      feed.append(card);
    }
  }


  async function load(sort, append = false) {
    if (append && (loading || !hasMore)) return;
    if (!append) {
      currentSort = sort;
      nextOffset = 0;
      hasMore = false;
    }
    const version = ++requestVersion;
    loading = true;
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.feedSort === sort));
    }
    if (moreButton) {
      moreButton.disabled = true;
      moreButton.textContent = append ? "Loading more cases…" : "Load more cases ↓";
      if (!append) moreButton.hidden = true;
    }
    if (!append) status.textContent = "Loading " +
      (sort === "unvoted" ? "cases you haven't judged" : "incidents") + "…";
    try {
      const response = await juryFetch(
        `/api/incidents?state=NH&sort=${encodeURIComponent(sort)}&category=${encodeURIComponent(currentCategory)}&offset=${nextOffset}`,
        { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" }
      );
      if (!response.ok) throw new Error("Feed request failed");
      const data = await response.json();
      if (version !== requestVersion) return;
      if (!Array.isArray(data.incidents)) throw new Error("Unexpected feed response");
      funnyEnabled = data.funny_enabled === true;
      const incidents = data.incidents;
      if (!append && sharedCaseId && sort !== "unvoted" && !currentCategory &&
          /^[a-zA-Z0-9_-]{6,80}$/.test(sharedCaseId) &&
          !incidents.some(i => i.id === sharedCaseId)) {
        const single = await juryFetch("/api/incidents/" + encodeURIComponent(sharedCaseId),
          { credentials: "same-origin", cache: "no-store" });
        if (single.ok) {
          const row = await single.json();
          if (row?.incident) incidents.unshift(row.incident);
        }
      }
      if (version !== requestVersion) return;
      // On a direct incident link, or when the board contains only one case,
      // show the actual saved category in the dropdown and match weekly awards.
      // Never override a category the visitor selected explicitly.
      if (!append && !currentCategory && !categoryChosenByVisitor && !categoryAutoSelected) {
        const shown = sharedCaseId
          ? incidents.find(incident => incident.id === sharedCaseId)
          : (incidents.length === 1 && !data.has_more ? incidents[0] : null);
        if (shown && Object.hasOwn(categoryLabels, shown.category)) {
          categoryAutoSelected = true;
          setCategory(shown.category, false);
          if (currentCategory) {
            // Reload with the matching category so the dropdown is a real filter.
            load(sort);
            return;
          }
        }
      }
      render(incidents, append);
      nextOffset = Number(data.next_offset || 0);
      hasMore = data.has_more === true;
      const showing = feed.querySelectorAll(".feed-card").length;
      if (showing) {
        status.textContent = "Showing " + showing +
          (sort === "unvoted" ? " cases you haven't judged yet." : " published cases.") +
          (hasMore ? " More available below." : "");
      }
      if (!append && sharedCaseId) {
        const target = document.getElementById("incident-" + sharedCaseId);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (error) {
      if (version !== requestVersion) return;
      if (!append) feed.replaceChildren();
      status.textContent = append ?
        "Could not load more cases. Try again." :
        "The incident feed couldn't load right now. Try refreshing this page.";
    } finally {
      if (version === requestVersion) {
        loading = false;
        if (moreButton) {
          moreButton.hidden = !hasMore;
          moreButton.disabled = false;
          moreButton.textContent = "Load more cases ↓";
        }
      }
    }
  }

  for (const button of buttons) {
    button.addEventListener("click", () => load(button.dataset.feedSort));
  }
  installCategoryFilter();
  if (moreButton) moreButton.addEventListener("click", () => load(currentSort, true));
  const juryShortcut = document.querySelector("#jury-find-unvoted");
  if (juryShortcut) juryShortcut.addEventListener("click", () => {
    load("unvoted");
  });
  load(currentSort);
})();
