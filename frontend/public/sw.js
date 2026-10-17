const CACHE = "gsb31-shell-v2";
const SHELL = ["/offline.html", "/icons/icon-192.png", "/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Only page navigations are handled: always network first, offline page as fallback. API data is never cached.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && SHELL.includes(url.pathname) && req.mode !== "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match(url.pathname)));
    return;
  }
  if (req.mode !== "navigate") return;
  e.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
});
