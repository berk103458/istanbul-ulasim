import { handleProxyRequest } from "./proxyCore.js";
import { sharedCache } from "./cacheLayer.js";
import { gateway } from "./apiGateway.js";

const IETT_FILO_URL = "https://api.ibb.gov.tr/iett/FiloDurum/SeferGerceklesme.asmx";
const IETT_FILO_BODY =
  '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetFiloAracKonum_json xmlns="http://tempuri.org/"/></soap:Body></soap:Envelope>';

const clients = new Set();
let loopStarted = false;

/**
 * Fetch and cache the full Istanbul İETT fleet (~6,940 live buses with instantaneous speed Hiz).
 * Cached globally for 6 seconds & coalesced across all concurrent callers.
 */
export async function getLiveFleet() {
  const cacheKey = "iett:filo:all";
  const hit = sharedCache.get(cacheKey, { allowStale: true });
  if (hit && !hit.stale) return hit.value;

  return gateway.coalesce(cacheKey, async () => {
    const t0 = performance.now();
    try {
      const res = await handleProxyRequest({
        url: IETT_FILO_URL,
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: '"http://tempuri.org/GetFiloAracKonum_json"',
        },
        body: IETT_FILO_BODY,
      });
      const m = /<GetFiloAracKonum_jsonResult[^>]*>([\s\S]*?)<\/GetFiloAracKonum_jsonResult>/i.exec(res.text || "");
      const arr = m ? JSON.parse(m[1]) : [];
      const normalized = arr
        .map((b) => ({
          k: b.KapiNo,
          p: b.Plaka,
          lat: +b.Enlem,
          lon: +b.Boylam,
          v: +b.Hiz || 0,
          s: b.Saat,
          op: b.Operator,
        }))
        .filter((b) => isFinite(b.lat) && isFinite(b.lon) && b.lat > 40 && b.lon > 27);
      sharedCache.set(cacheKey, normalized, 6, 60);
      gateway.recordSuccess("iett", performance.now() - t0);
      return normalized;
    } catch (err) {
      gateway.recordFailure("iett", performance.now() - t0);
      if (hit) return hit.value;
      return [];
    }
  });
}

export async function getFleetInBbox(bboxStr) {
  const all = await getLiveFleet();
  if (!bboxStr) return all.slice(0, 350);
  const [minLat, minLon, maxLat, maxLon] = String(bboxStr).split(",").map(Number);
  if (![minLat, minLon, maxLat, maxLon].every(isFinite)) return all.slice(0, 350);
  const out = [];
  for (const b of all) {
    if (b.lat >= minLat && b.lat <= maxLat && b.lon >= minLon && b.lon <= maxLon) {
      out.push(b);
      if (out.length >= 1200) break;
    }
  }
  return out;
}

async function fetchLineVehicles(hat) {
  const body =
    '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<soap:Body><GetHatOtoKonum_json xmlns="http://tempuri.org/"><HatKodu>${String(hat).replace(/[<>&]/g, "")}</HatKodu></GetHatOtoKonum_json></soap:Body></soap:Envelope>`;
  const res = await handleProxyRequest({
    url: IETT_FILO_URL,
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: '"http://tempuri.org/GetHatOtoKonum_json"',
    },
    body,
  });
  const m = /<GetHatOtoKonum_jsonResult[^>]*>([\s\S]*?)<\/GetHatOtoKonum_jsonResult>/i.exec(res.text || "");
  return m ? JSON.parse(m[1]) : [];
}

function sendSse(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    clients.delete(res);
  }
}

function startSseLoop() {
  if (loopStarted) return;
  loopStarted = true;

  // Heartbeat every 15s
  setInterval(() => {
    for (const c of clients) {
      try {
        c.res.write(": ping\n\n");
      } catch {
        clients.delete(c);
      }
    }
  }, 15000);

  // Push live line vehicles every 6s to active subscribers
  setInterval(async () => {
    if (!clients.size) return;
    const neededLines = new Set();
    for (const c of clients) for (const l of c.lines) neededLines.add(l);
    if (!neededLines.size) return;

    const lineMap = new Map();
    await Promise.all(
      [...neededLines].slice(0, 8).map(async (hat) => {
        try {
          const list = await fetchLineVehicles(hat);
          lineMap.set(hat, list);
        } catch {}
      })
    );

    for (const c of clients) {
      const payload = {};
      for (const l of c.lines) {
        if (lineMap.has(l)) payload[l] = lineMap.get(l);
      }
      if (Object.keys(payload).length) {
        sendSse(c.res, "vehicles", { ts: Date.now(), lines: payload });
      }
    }
  }, 6000);

  // Push traffic index + incident summary every 30s
  setInterval(async () => {
    const subs = [...clients].filter((c) => c.traffic);
    if (!subs.length) return;
    try {
      const [idxRes, annRes] = await Promise.all([
        handleProxyRequest({ url: "https://tkmservices.ibb.gov.tr/web/api/TrafficData/v1/TrafficIndex_Sc1_Cont", method: "GET" }),
        handleProxyRequest({ url: "https://tkmservices.ibb.gov.tr/web/api/IntensityMap/v1/CurrentAnnouncement", method: "GET" }),
      ]);
      const index = JSON.parse(idxRes.text || "null");
      const incidents = JSON.parse(annRes.text || "[]");
      for (const c of subs) {
        sendSse(c.res, "traffic", { ts: Date.now(), index, incidentCount: Array.isArray(incidents) ? incidents.length : 0 });
      }
    } catch {}
  }, 30000);
}

export function handleSseConnection(req, res, reqUrl) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  const linesParam = reqUrl.searchParams.get("lines") || "";
  const lines = linesParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
  const traffic = reqUrl.searchParams.get("traffic") === "1";

  const client = { res, lines, traffic };
  clients.add(client);
  startSseLoop();

  sendSse(res, "ready", { ok: true, ts: Date.now(), lines });

  req.on("close", () => {
    clients.delete(client);
  });
}
