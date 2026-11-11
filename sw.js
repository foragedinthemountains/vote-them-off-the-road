"use strict";
// Network-first public navigation. Cache ONLY a generic offline notice.
// Never cache API responses, authenticated pages, votes, reports, media,
// account screens, or moderation responses.
const CACHE="vtor-offline-shell-v1";
const FALLBACK="/offline.html";
const OFFLINE_ALLOWED=new Set(["/","/nh/","/guidelines/","/privacy/","/install/"]);
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.add(FALLBACK))
    .then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil(Promise.all([
    caches.keys().then(keys=>Promise.all(keys
      .filter(key=>key.startsWith("vtor-offline-shell-")&&key!==CACHE)
      .map(key=>caches.delete(key)))),
    self.clients.claim()
  ]));
});
self.addEventListener("fetch",event=>{
  const req=event.request;
  if(req.method!=="GET" || req.mode!=="navigate")return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin || !OFFLINE_ALLOWED.has(url.pathname))return;
  event.respondWith(fetch(req).catch(async()=>{
    const cache=await caches.open(CACHE);
    return await cache.match(FALLBACK) ||
      new Response("You are offline. Reconnect to vote.",{
        status:503,headers:{"Content-Type":"text/plain; charset=utf-8",
        "Cache-Control":"no-store"}
      });
  }));
});
