import { sharedCache } from "./cacheLayer.js";
import { gateway } from "./apiGateway.js";

// Shared SSRF-safe allowlisted CORS proxy + 2-tier cache + request coalescing + circuit breaker
const ALLOWED_HOSTS = new Set([
  "api.ibb.gov.tr",
  "sehirhatlari.istanbul",
  "www.sehirhatlari.istanbul",
  "tkmservices.ibb.gov.tr",
  "api.transitous.org",
]);

const DEFAULT_UA = "Mozilla/5.0 (Linux; Android 14; Mobile) IstanbulUlasim/5.0";

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
  if (lower.includes("gethatotokonum") || bodyStr.includes("GetHatOtoKonum")) return 5;
  if (lower.includes("getfiloarackonum") || bodyStr.includes("GetFiloAracKonum")) return 6;
  if (lower.includes("segmentdata") || lower.includes("trafficindex") || lower.includes("currentannouncement")) return 30;
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

  const provider = gateway.detectProvider(url);
  const cacheKey = `${upperMethod}:${url}:${body ? String(body) : ""}`;
  const ttlSec = getCacheTtlSeconds(url, body);

  const hit = ttlSec > 0 ? await sharedCache.getWithRedisFallback(cacheKey, { allowStale: true }) : null;
  if (hit && !hit.stale) {
    gateway.recordRequestLatency(0.1, false);
    return {
      status: hit.value.status,
      headers: {
        "Content-Type": hit.value.contentType,
        "Cache-Control": `public, max-age=${ttlSec}, s-maxage=${ttlSec}`,
        "X-Proxy-Cache": "HIT",
      },
      text: hit.value.text,
    };
  }

  if (gateway.isCircuitOpen(provider)) {
    if (hit) {
      return {
        status: hit.value.status,
        headers: { "Content-Type": hit.value.contentType, "X-Proxy-Cache": "STALE-FAILOVER" },
        text: hit.value.text,
      };
    }
    return {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      text: JSON.stringify({ error: `Provider ${provider} circuit open` }),
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

  return gateway.coalesce(cacheKey, async () => {
    const t0 = performance.now();
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
      const ms = performance.now() - t0;

      if (res.status >= 200 && res.status < 400) {
        gateway.recordSuccess(provider, ms);
        if (ttlSec > 0) {
          sharedCache.set(cacheKey, { status: res.status, contentType, text }, ttlSec);
        }
      } else {
        gateway.recordFailure(provider, ms);
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
      gateway.recordFailure(provider, performance.now() - t0);
      if (hit) {
        return {
          status: hit.value.status,
          headers: { "Content-Type": hit.value.contentType, "X-Proxy-Cache": "STALE-FAILOVER" },
          text: hit.value.text,
        };
      }
      return {
        status: 502,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        text: JSON.stringify({ error: String(err?.message || err) }),
      };
    } finally {
      clearTimeout(timer);
    }
  });
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, SOAPAction",
};

export async function handleProxyHttpRequest(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  let payload;
  if (request.method === "GET") {
    const url = new URL(request.url).searchParams.get("url") || "";
    payload = { url, method: "GET" };
  } else if (request.method === "POST") {
    payload = await request.json().catch(() => ({}));
  } else {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const result = await handleProxyRequest(payload);
  return new Response(result.text, {
    status: result.status,
    headers: { ...CORS_HEADERS, ...result.headers },
  });
}
