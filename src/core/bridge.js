// ---- Birleşik Platform Köprüsü: Capacitor Android / Web Proxy / iOS Scriptable ----
let seq = 0;
const pending = new Map();
let queue = [];

if (typeof window !== "undefined") {
  window.__bridgeTake = () => JSON.stringify(queue.splice(0));
  window.__bridgeDeliver = (items) => {
    for (const it of items) {
      const p = pending.get(it.id);
      if (!p) continue;
      pending.delete(it.id);
      it.ok ? p.res(it.data) : p.rej(new Error(it.data));
    }
  };
  window.__bridgeCall = (kind, args = {}) =>
    new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, { res, rej });
      queue.push({ id, kind, args });
    });
}

let customProxyBase = "";
let proxyMissing = false;
try {
  const saved = localStorage.getItem("ulasim.proxyUrl");
  if (saved) {
    const parsed = JSON.parse(saved);
    customProxyBase = (parsed && parsed.d) || parsed || "";
  }
} catch {}

function isDirectCorsHost(url) {
  return (
    url.includes("api.ibb.gov.tr/MetroIstanbul") ||
    url.includes("tkmservices.ibb.gov.tr") ||
    url.includes("api.transitous.org")
  );
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: ctrl.signal });
    return { status: r.status, text: await r.text() };
  } finally {
    clearTimeout(id);
  }
}

export const Bridge = {
  get runtime() {
    if (typeof window === "undefined") return "node";
    if (window.__SCRIPTABLE__) return "scriptable";
    if (window.Capacitor?.isNativePlatform?.()) return "capacitor";
    return "web";
  },

  setProxyUrl(url) {
    customProxyBase = String(url || "").trim().replace(/\/+$/, "");
    proxyMissing = false;
  },

  getProxyUrl() {
    return customProxyBase;
  },

  async http({ url, method = "GET", headers = {}, body = null }) {
    const rt = Bridge.runtime;

    if (rt === "scriptable") {
      return window.__bridgeCall("http", { url, method, headers, body });
    }

    if (rt === "capacitor") {
      const capHttp = window.Capacitor?.Plugins?.CapacitorHttp;
      if (capHttp && typeof capHttp.request === "function") {
        try {
          const r = await capHttp.request({
            url,
            method,
            headers: {
              "User-Agent": "Mozilla/5.0 (Linux; Android 14; Mobile) IstanbulUlasim/4.0",
              ...headers,
            },
            data: body != null ? body : undefined,
            responseType: "text",
            connectTimeout: 20000,
            readTimeout: 25000,
          });
          return {
            status: r.status,
            text: typeof r.data === "string" ? r.data : JSON.stringify(r.data),
          };
        } catch (err) {
          if (customProxyBase) {
            return fetchWithTimeout(`${customProxyBase}/api/proxy`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url, method, headers, body }),
            });
          }
          throw err;
        }
      }
    }

    // Web / Node / PWA
    if (rt === "node" || isDirectCorsHost(url)) {
      return fetchWithTimeout(url, { method, headers, body: body != null ? body : undefined });
    }

    if (proxyMissing && !customProxyBase) {
      const e = new Error("Static hosting (proxy yok)");
      e.noProxy = true;
      throw e;
    }

    const proxyEndpoint = customProxyBase ? `${customProxyBase}/api/proxy` : "./api/proxy";
    const res = await fetchWithTimeout(proxyEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, method, headers, body }),
    });
    if ((res.status === 404 || res.status === 405) && !customProxyBase) {
      proxyMissing = true;
      const e = new Error("Static hosting (proxy yok)");
      e.noProxy = true;
      throw e;
    }
    return res;
  },

  async location() {
    const rt = Bridge.runtime;
    if (rt === "scriptable") {
      return window.__bridgeCall("location");
    }
    if (rt === "capacitor") {
      try {
        const { Geolocation } = await import("@capacitor/geolocation");
        await Geolocation.requestPermissions().catch(() => {});
        const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
        return { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
      } catch {
        // fallback to web geolocation below
      }
    }
    return new Promise((res, rej) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        return rej(new Error("Konum servisi desteklenmiyor"));
      }
      navigator.geolocation.getCurrentPosition(
        (p) => res({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
        (e) => rej(new Error(e.message || "Konum alınamadı")),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 }
      );
    });
  },

  async openUrl(url) {
    if (Bridge.runtime === "scriptable") {
      return window.__bridgeCall("open", { url });
    }
    window.open(url, "_blank", "noopener");
    return true;
  },

  async call(kind, args = {}) {
    if (kind === "http") return Bridge.http(args);
    if (kind === "location") return Bridge.location();
    if (kind === "open") return Bridge.openUrl(args.url);
    throw new Error("Bilinmeyen istek: " + kind);
  },
};
