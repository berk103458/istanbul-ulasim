const ALLOWED_HOSTS = new Set([
  "api.ibb.gov.tr",
  "sehirhatlari.istanbul",
  "www.sehirhatlari.istanbul",
  "tkmservices.ibb.gov.tr",
  "api.transitous.org",
]);

const DEFAULT_UA = "Mozilla/5.0 (Linux; Android 14; Mobile) IstanbulUlasim/4.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, SOAPAction",
};

function isAllowedUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return ALLOWED_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function getCacheTtlSeconds(url, body = "") {
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

async function handleProxyRequest({ url, method = "GET", headers = {}, body = null }) {
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

  const safeHeaders = { "User-Agent": DEFAULT_UA };
  if (headers && typeof headers === "object") {
    for (const [k, v] of Object.entries(headers)) {
      const lk = k.toLowerCase();
      if (["content-type", "soapaction", "accept"].includes(lk) && typeof v === "string") {
        safeHeaders[k] = v;
      }
    }
  }

  const ttlSec = getCacheTtlSeconds(url, body);
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
    return {
      status: res.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": ttlSec > 0 ? `public, max-age=${ttlSec}, s-maxage=${ttlSec}` : "no-store",
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

export default {
  async fetch(request, env) {
    const reqUrl = new URL(request.url);

    if (reqUrl.pathname === "/api/proxy") {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }
      try {
        let payload;
        if (request.method === "GET") {
          payload = { url: reqUrl.searchParams.get("url") || "", method: "GET" };
        } else if (request.method === "POST") {
          payload = await request.json().catch(() => ({}));
        } else {
          return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
          });
        }
        const result = await handleProxyRequest(payload);
        return new Response(result.text, {
          status: result.status,
          headers: { ...CORS_HEADERS, ...result.headers },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e?.message || e) }), {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
        });
      }
    }

    if (reqUrl.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "istanbul-ulasim",
        version: "4.0.0",
        runtime: "cloudflare-workers",
      });
    }

    return env.ASSETS.fetch(request);
  },
};
