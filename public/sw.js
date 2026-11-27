const CACHE_VERSION = "v5.0.0";
const CACHE_PREFIX = "istanbul-ulasim-";
const APP_CACHE = `${CACHE_PREFIX}shell-${CACHE_VERSION}`;
const DATA_CACHE = `${CACHE_PREFIX}data-${CACHE_VERSION}`;
const TILE_CACHE = `${CACHE_PREFIX}tiles-v1`;
const VALID_CACHES = new Set([APP_CACHE, DATA_CACHE, TILE_CACHE]);

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/favicon.png",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

const LIVE_API_HOSTS = [
  "ibb.gov.tr",
  "transitous.org",
  "sehirhatlari.istanbul",
];

const TILE_HOSTS = [
  "basemaps.cartocdn.com",
  "tile.openstreetmap.org",
  "arcgisonline.com",
];

function isApiRequest(url) {
  return (
    url.pathname.startsWith("/api/") ||
    LIVE_API_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
  );
}

function isStaticDataRequest(url) {
  return (
    url.origin === self.location.origin &&
    /\/data\/[^/]+\.json$/i.test(url.pathname)
  );
}

function isTileRequest(url) {
  return TILE_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

function isHashedAssetRequest(url) {
  return url.origin === self.location.origin && /\/assets\//.test(url.pathname);
}

function offlineJsonResponse() {
  return new Response(
    JSON.stringify({ ok: false, offline: true, error: "Çevrimdışı modda canlı veriye ulaşılamıyor." }),
    {
      status: 503,
      statusText: "Service Unavailable",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }
  );
}

function offlineHtmlResponse() {
  const html = `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#0f62fe">
  <title>İstanbul Ulaşım — Çevrimdışı</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0c1017;color:#f3f6fc}
    main{max-width:360px;width:100%;padding:24px;border-radius:18px;background:#151b24;border:1px solid rgba(255,255,255,.1);text-align:center}
    h1{margin:0 0 8px;font-size:20px}
    p{margin:0 0 18px;color:#9aa6ba;font-size:14px;line-height:1.5}
    button{min-height:44px;padding:10px 18px;border:0;border-radius:12px;background:#5c9aff;color:#0b111c;font-weight:700;font-size:14px;cursor:pointer}
  </style>
</head>
<body>
  <main>
    <h1>Çevrimdışı Mod</h1>
    <p>İnternet bağlantısı bulunamadı. Bağlantınız geri geldiğinde sayfayı yenileyebilirsiniz.</p>
    <button type="button" onclick="location.reload()">Tekrar Dene</button>
  </main>
</body>
</html>`;
  return new Response(html, {
    status: 503,
    statusText: "Offline",
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function extractShellBundleAssets(htmlText) {
  const found = new Set();
  const re = /(?:src|href)=["'](\.?\/assets\/[^"']+)["']/gi;
  let match;
  while ((match = re.exec(htmlText)) !== null) {
    found.add(match[1]);
  }
  return [...found];
}

async function precacheShell() {
  const cache = await caches.open(APP_CACHE);
  const discovered = [];

  try {
    const indexRes = await fetch("./index.html", { cache: "reload" });
    if (indexRes && indexRes.ok) {
      const htmlText = await indexRes.clone().text();
      await Promise.all([
        cache.put("./index.html", indexRes.clone()),
        cache.put("./", indexRes),
      ]);
      discovered.push(...extractShellBundleAssets(htmlText));
    }
  } catch {
    // Fallback to regular cache loop below
  }

  const assetsToCache = [...new Set([...SHELL_ASSETS, ...discovered])];
  await Promise.allSettled(
    assetsToCache.map(async (asset) => {
      if (asset === "./" || asset === "./index.html") {
        const existing = await cache.match(asset);
        if (existing) return;
      }
      const res = await fetch(asset);
      if (res && res.ok) {
        await cache.put(asset, res);
      }
    })
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !VALID_CACHES.has(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1) Live API / proxy requests: strictly network-only (never cached by SW)
  if (isApiRequest(url)) {
    const accept = request.headers.get("accept") || "";
    if (request.method !== "GET" || accept.includes("text/event-stream")) {
      return;
    }
    event.respondWith(fetch(request).catch(() => offlineJsonResponse()));
    return;
  }

  if (request.method !== "GET") return;

  // 2) Bundled static datasets (public/data/*.json): stale-while-revalidate
  if (isStaticDataRequest(url)) {
    event.respondWith(
      caches.open(DATA_CACHE).then(async (cache) => {
        const cached = await cache.match(request, { ignoreVary: true });
        const networkPromise = fetch(request)
          .then((res) => {
            if (res && res.ok) {
              cache.put(request, res.clone());
            }
            return res;
          })
          .catch(() => null);

        if (cached) {
          event.waitUntil(networkPromise);
          return cached;
        }
        const networkRes = await networkPromise;
        return networkRes || offlineJsonResponse();
      })
    );
    return;
  }

  // 3) Map tiles: cache-first with offline fallback
  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(request, { ignoreVary: true });
        if (cached) return cached;
        try {
          const res = await fetch(request);
          if (res && res.ok) {
            cache.put(request, res.clone());
          }
          return res;
        } catch {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // 4) Document navigations: network-first, fallback to cached app shell or offline page
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(APP_CACHE).then((cache) => {
              cache.put("./index.html", copy.clone());
              cache.put("./", copy);
            });
          }
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(APP_CACHE);
          return (
            (await cache.match(request, { ignoreSearch: true, ignoreVary: true })) ||
            (await cache.match("./index.html", { ignoreVary: true })) ||
            (await cache.match("./", { ignoreVary: true })) ||
            offlineHtmlResponse()
          );
        })
    );
    return;
  }

  // 5) Versioned/hashed build assets (/assets/*): cache-first for instant offline startup
  if (isHashedAssetRequest(url)) {
    event.respondWith(
      caches.open(APP_CACHE).then(async (cache) => {
        const cached = await cache.match(request, { ignoreVary: true });
        if (cached) return cached;
        try {
          const res = await fetch(request);
          if (res && res.ok) {
            cache.put(request, res.clone());
          }
          return res;
        } catch {
          return Response.error();
        }
      })
    );
    return;
  }

  // 6) Other same-origin static files (manifest, icons): network-first with cache fallback
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(APP_CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true, ignoreVary: true });
        return cached || Response.error();
      })
  );
});
