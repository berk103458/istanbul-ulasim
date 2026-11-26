// Shared SSRF-safe allowlisted CORS proxy + in-memory TTL cache
const ALLOWED_HOSTS = new Set([
  "api.ibb.gov.tr",
  "sehirhatlari.istanbul",
  "www.sehirhatlari.istanbul",
  "tkmservices.ibb.gov.tr",
  "api.transitous.org",
]);

const DEFAULT_UA = "Mozilla/5.0 (Linux; Android 14; Mobile) IstanbulUlasim/4.0";
const memCache = new Map();
const MAX_CACHE_ITEMS = 250;

export function isAllowedUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return ALLOWED_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function getCacheTtlSeconds(url, body = "") {
  const lower = String(url).toLowerCase();
  const bodyStr = String(body || "");
  if (lower.includes("gethatotokonum") || bodyStr.includes("GetHatOtoKonum")) return 4;
  if (lower.includes("segmentdata") || lower.includes("trafficindex")) return 30;
  if (lower.includes("getduyurular") || bodyStr.includes("GetDuyurular")) return 180;
  if (lower.includes("ispark/park")) return 120;
  if (lower.includes("sehirhatlari.istanbul")) return 600;
  if (
    lower.includes("gethat_json") ||
    bodyStr.includes("GetHat_json") ||
    lower.includes("durakdetay") ||
    bodyStr.includes("DurakDetay_GYY") ||
    lower.includes("planlanansefersaati") ||
    bodyStr.includes("GetPlanlananSeferSaati") ||
    lower.includes("metroistanbul")
  ) {
    return 600;
  }
  return 0;
}

function getCached(key) {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memCache.delete(key);
    return null;
  }
  return entry;
}

function setCached(key, data, ttlSec) {
  if (ttlSec <= 0) return;
  if (memCache.size >= MAX_CACHE_ITEMS) {
    const firstKey = memCache.keys().next().value;
    if (firstKey !== undefined) memCache.delete(firstKey);
  }
  memCache.set(key, {
    ...data,
    expiresAt: Date.now() + ttlSec * 1000,
  });
}

export async function handleProxyRequest({ url, method = "GET", headers = {}, body = null }) {
  if (!url || !isAllowedUrl(url)) {
    return {
      status: 403,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      text: JSON.stringify({ error: "Forbidden target host" }),
    };
  }

  const upperMethod = String(method || "GET").toUpperCase();
  if (upperMethod !== "GET" && upperMethod !== "POST") {
    return {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      text: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  const cacheKey = `${upperMethod}:${url}:${body ? String(body) : ""}`;
  const ttlSec = getCacheTtlSeconds(url, body);
  const hit = ttlSec > 0 ? getCached(cacheKey) : null;
  if (hit) {
    return {
      status: hit.status,
      headers: {
        "Content-Type": hit.contentType,
        "Cache-Control": `public, max-age=${ttlSec}, s-maxage=${ttlSec}`,
        "X-Proxy-Cache": "HIT",
      },
      text: hit.text,
    };
  }

  const safeHeaders = { "User-Agent": DEFAULT_UA };
  if (headers && typeof headers === "object") {
    for (const [k, v] of Object.entries(headers)) {
      const lk = k.toLowerCase();
      if (["content-type", "soapaction", "accept"].includes(lk) && typeof v === "string") {
        safeHeaders[k] = v;
      }
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      method: upperMethod,
      headers: safeHeaders,
      body: upperMethod === "POST" && body != null ? String(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    const contentType = res.headers.get("content-type") || "text/plain; charset=utf-8";
    if (res.status >= 200 && res.status < 400 && ttlSec > 0) {
      setCached(cacheKey, { status: res.status, contentType, text }, ttlSec);
    }
    return {
      status: res.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": ttlSec > 0 ? `public, max-age=${ttlSec}, s-maxage=${ttlSec}` : "no-store",
        "X-Proxy-Cache": "MISS",
      },
      text,
    };
  } catch (err) {
    return {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      text: JSON.stringify({ error: String(err?.message || err) }),
    };
  } finally {
    clearTimeout(timer);
  }
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, SOAPAction",
};
