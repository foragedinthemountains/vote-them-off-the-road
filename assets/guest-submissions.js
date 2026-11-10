"use strict";
// Private guest management capabilities retained on this browser only.
// This is not an identity system: anyone who can use this browser profile
// can manage saved posts. Never send capabilities to third parties.
(() => {
  const STORAGE_KEY = "vtor_guest_submissions_v1";
  const idPattern = /^[A-Za-z0-9_-]{6,80}$/;
  const keyPattern = /^[A-Za-z0-9_-]{43}$/;
  const MAX_SAVED = 75;

  function valid(item) {
    return item && typeof item === "object" &&
      idPattern.test(item.id || "") && keyPattern.test(item.key || "");
  }
  function list() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      const seen = new Set();
      return parsed.filter(item => {
        if (!valid(item) || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      }).slice(0, MAX_SAVED).map(item => ({
        id: item.id, key: item.key,
        title: typeof item.title === "string" ? item.title.slice(0, 160) : "",
        savedAt: Number.isFinite(item.savedAt) ? item.savedAt : 0
      }));
    } catch {
      return [];
    }
  }
  function save(id, key, title) {
    if (!valid({id, key})) return false;
    const existing = list();
    const previous = existing.find(item => item.id === id);
    const label = typeof title === "string" && title.trim()
      ? title.trim().slice(0, 160) : previous?.title || "";
    const next = [
      {id, key, title: label, savedAt: previous?.savedAt || Date.now()},
      ...existing.filter(item => item.id !== id)
    ].slice(0, MAX_SAVED);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return true;
    } catch {
      return false;
    }
  }
  function forget(id) {
    if (!idPattern.test(id || "")) return false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(
        list().filter(item => item.id !== id)
      ));
      return true;
    } catch {
      return false;
    }
  }
  function get(id) {
    return list().find(item => item.id === id) || null;
  }
  function manageUrl(item) {
    if (!valid(item)) return null;
    // Secret stays in a fragment, never in the query or a server request URL.
    return "/nh/manage/?id=" + encodeURIComponent(item.id) +
      "#key=" + encodeURIComponent(item.key);
  }
  function fromPrivateLink(raw) {
    if (typeof raw !== "string" || raw.length > 2048) return null;
    try {
      const url = new URL(raw.trim(), location.origin);
      if (url.origin !== location.origin ||
          !["/nh/manage/", "/nh/manage"].includes(url.pathname))
        return null;
      const id = url.searchParams.get("id");
      const key = new URLSearchParams(url.hash.slice(1)).get("key");
      return valid({id, key}) ? {id, key} : null;
    } catch {
      return null;
    }
  }
  window.VTORGuestSubmissions = {list, save, forget, get, manageUrl, fromPrivateLink};
})();
