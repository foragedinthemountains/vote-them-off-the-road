"use strict";
(() => {
  const nav = document.querySelector(".board-jump-nav");
  if (!nav) return;
  const links = [...nav.querySelectorAll("[data-jump]")];
  const sections = links.map(link => ({
    link,
    section: document.getElementById(link.dataset.jump)
  })).filter(item => item.section);
  if (!sections.length) return;
  let queued = false;
  function update() {
    queued = false;
    const ordered = [...sections].sort((a,b) =>
      a.section.getBoundingClientRect().top - b.section.getBoundingClientRect().top);
    let current = ordered[0];
    for (const item of ordered) {
      if (item.section.getBoundingClientRect().top <= 145) current = item;
    }
    for (const item of sections) {
      if (item === current) item.link.setAttribute("aria-current", "location");
      else item.link.removeAttribute("aria-current");
    }
  }
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  }
  window.addEventListener("scroll", schedule, { passive:true });
  window.addEventListener("resize", schedule);
  window.addEventListener("hashchange", schedule);
  update();
})();
