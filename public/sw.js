const APP_CACHE = "istanbul-ulasim-v4.0";
const TILE_CACHE = "istanbul-ulasim-tiles-v1";
const SHELL_ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== APP_CACHE && k !== TILE_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Never cache live API / proxy requests in SW (handled by IndexedDB KV with TTL)
  if (
    url.pathname.startsWith("/api/") ||
    url.hostname.includes("ibb.gov.tr") ||
    url.hostname.includes("transitous.org") ||
    url.hostname.includes("sehirhatlari.istanbul")
  ) {
    return;
  }

  // Map tiles: cache-first with background refresh
  if (url.hostname.includes("basemaps.cartocdn.com") || url.hostname.includes("tile.openstreetmap.org") || url.hostname.includes("arcgisonline.com")) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const res = await fetch(request);
          if (res.ok) cache.put(request, res.clone());
          return res;
        } catch {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // App shell & static assets: network-first, fallback to cache
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(APP_CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
  }
});
