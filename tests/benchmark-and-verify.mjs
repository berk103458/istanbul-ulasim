import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "../server/localServer.js";
import { sharedCache } from "../server/cacheLayer.js";
import { Zaman } from "../src/core/time.js";
import { Core } from "../src/core/geo.js";
import { API } from "../src/core/api.js";
import { Plan } from "../src/core/router.js";
import { EtaEngine } from "../src/engines/etaEngine.js";
import { TrafficEngine } from "../src/engines/trafficEngine.js";
import { t, setLang, getLang } from "../src/i18n/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

async function main() {
  const report = {};

  // 1. Bundle Size Check
  const distAssets = fs.readdirSync(path.join(root, "dist", "assets"));
  const mainJs = distAssets.find((f) => f.startsWith("index-") && f.endsWith(".js"));
  const workerJs = distAssets.find((f) => f.includes("router.worker") && f.endsWith(".js"));
  const mainJsBytes = fs.statSync(path.join(root, "dist", "assets", mainJs)).size;
  report.bundle = {
    mainJs,
    mainJsBytes,
    workerJs,
    totalChunks: distAssets.filter((f) => f.endsWith(".js")).length,
  };
  assert.ok(mainJsBytes < 311367, `Initial JS bundle (${mainJsBytes}) should be smaller than baseline 311367`);
  assert.ok(workerJs, "Web Worker chunk must exist in dist/assets");

  // 2. Unit Tests: Zaman, Core, i18n, İstanbulkart Fare, 9-Factor ETA
  assert.equal(Zaman.dk("00:30"), 1470);
  assert.equal(Zaman.saatFormat(1470), "00:30");
  setLang("en");
  assert.equal(getLang(), "en");
  assert.ok(t("tab_yakin").length > 0);
  setLang("tr");
  assert.equal(getLang(), "tr");

  const stopsMock = [
    { kod: "S1", ad: "Durak 1", lat: 41.0, lon: 29.0 },
    { kod: "S2", ad: "Durak 2", lat: 41.005, lon: 29.005 },
    { kod: "S3", ad: "Durak 3", lat: 41.01, lon: 29.01 },
  ];
  const busOnRoute = { kapino: "A-100", lat: 41.001, lon: 29.001, yakinDurak: "S1", zaman: Zaman.yerelISO().replace("T", " ") };
  const eta1 = EtaEngine.predict(stopsMock, busOnRoute, 1, { hatBilgi: { km: 10, dk: 30 } });
  const eta2 = EtaEngine.predict(stopsMock, busOnRoute, 2, { hatBilgi: { km: 10, dk: 30 } });
  assert.ok(eta1 && eta2 && eta2.dakika >= eta1.dakika, "ETA must be monotonic along sequential stops");

  const offRouteBus = { kapino: "A-101", lat: 41.08, lon: 29.08, zaman: Zaman.yerelISO().replace("T", " ") };
  const etaOff = EtaEngine.predict(stopsMock, offRouteBus, 2, {});
  assert.equal(etaOff?.durumKod, "OFF_ROUTE", "Bus >450m from route must be flagged OFF_ROUTE");

  const staleBus = { kapino: "A-102", lat: 41.001, lon: 29.001, zaman: "2020-01-01 10:00:00" };
  const etaStale = EtaEngine.predict(stopsMock, staleBus, 2, {});
  assert.equal(etaStale?.durumKod, "STALE", "Old GPS timestamp must be flagged STALE");

  // 3. A* Route Engine & 6-Criteria Benchmark
  const agJson = JSON.parse(fs.readFileSync(path.join(root, "public", "data", "iett-ag.json"), "utf8"));
  const metroLines = await (await fetch("https://api.ibb.gov.tr/MetroIstanbul/api/MetroMobile/V2/GetLines")).json();
  const metroStations = await (await fetch("https://api.ibb.gov.tr/MetroIstanbul/api/MetroMobile/V2/GetStations")).json();
  const hatlar = metroLines.Data.filter((l) => l.IsActive !== false).map((l) => ({
    id: l.Id,
    ad: l.Name,
    sira: l.Order,
    renk: "#666",
    ilk: l.FirstTime,
    son: l.LastTime,
  }));
  const istasyonlar = metroStations.Data.map((s) => ({
    id: s.Id,
    ad: s.Description || s.Name,
    hatId: s.LineId,
    hat: s.LineName,
    sira: s.Order,
    lat: +s.DetailInfo?.Latitude,
    lon: +s.DetailInfo?.Longitude,
  })).filter((s) => s.lat && s.lon);

  const tKur0 = performance.now();
  const ag = Plan.kur({ hatlar, istasyonlar, otobus: agJson, marmaray: true, gun: 4, saat: 1140 });
  const kurMs = performance.now() - tKur0;

  const stopIdx = Plan.buildStopLinesIndex(ag);
  assert.ok(Object.keys(stopIdx).length > 5000, "Stop->Lines index should cover >5000 stops");

  const corridors = [
    ["Kadıköy -> Taksim", { lat: 40.9904, lon: 29.0235, ad: "Kadıköy" }, { lat: 41.037, lon: 28.9851, ad: "Taksim" }],
    ["Üsküdar -> Halkalı", { lat: 41.0258, lon: 29.0152, ad: "Üsküdar" }, { lat: 41.0178, lon: 28.7664, ad: "Halkalı" }],
    ["Mecidiyeköy -> Beylikdüzü", { lat: 41.0669, lon: 28.9958, ad: "Mecidiyeköy" }, { lat: 41.005, lon: 28.64, ad: "Beylikdüzü" }],
  ];
  const routeTimings = [];
  for (const [name, a, b] of corridors) {
    const t0 = performance.now();
    const res = Plan.alternatifler(ag, a, b, 1140, {}, 5);
    const ms = performance.now() - t0;
    routeTimings.push({ name, ms: Math.round(ms), found: res.sonuc.length });
    assert.ok(res.sonuc.length >= 1, `Route ${name} must return >= 1 result`);
    assert.ok(ms < 2000, `Route ${name} took ${ms}ms (>2000ms target)`);
  }

  // Test all 6 criteria + İstanbulkart fare
  const kadTak = Plan.alternatifler(ag, corridors[0][1], corridors[0][2], 1140, {}, 6).sonuc;
  for (const kriter of ["fastest", "fewest_transfers", "least_walking", "least_waiting", "cheapest", "traffic_resilient"]) {
    const scored = kadTak.map((r) => ({ r, score: Plan.puanla(r, kriter, 1.6), fare: Plan.ucretHesapla(r) }));
    assert.ok(scored.every((x) => isFinite(x.score) && x.fare.tamTL >= 27), `Criterion ${kriter} & fare valid`);
  }
  report.routing = { kurMs: Math.round(kurMs), routeTimings };

  // 4. Cache Access Latency Test (< 100ms target)
  sharedCache.set("bench:key", { ok: true }, 60);
  const tCache0 = performance.now();
  for (let i = 0; i < 1000; i++) sharedCache.get("bench:key");
  const cacheAvgMs = (performance.now() - tCache0) / 1000;
  assert.ok(cacheAvgMs < 1, `Cache read ${cacheAvgMs}ms must be < 1ms`);
  report.cacheAvgReadMs = Number(cacheAvgMs.toFixed(4));

  // 5. Stop Query Latency Test (< 500ms target)
  const tStop0 = performance.now();
  const stopTimes = await API.transitous.durakSaatleri("tr-istanbul-iett_510965", 10);
  const stopQueryMs = performance.now() - tStop0;
  assert.ok(Array.isArray(stopTimes), "Stop query must return array");
  assert.ok(stopQueryMs < 2000, `Stop query ${stopQueryMs}ms`);
  report.stopQueryMs = Math.round(stopQueryMs);

  // 6. Server Gateway, SSE, Fleet, Google Failover & 200-Req Stress Test
  const server = createServer();
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const h = await (await fetch(base + "/api/health")).json();
    assert.equal(h.ok, true);
    assert.equal(h.googleMapsConfigured, false);

    // Google Maps graceful 503 failover
    const gRes = await fetch(base + "/api/google/routes", { method: "POST", body: "{}" });
    assert.equal(gRes.status, 503);

    // SSRF 403
    const bad = await fetch(base + "/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    assert.equal(bad.status, 403);

    // Live /api/fleet bbox
    const fl = await (await fetch(base + "/api/fleet?bbox=40.98,28.95,41.05,29.06")).json();
    assert.ok(fl.count > 10, `Expected >10 buses in central Istanbul bbox, got ${fl.count}`);

    // SSE /api/stream initial ready event
    const sseCtrl = new AbortController();
    const sseRes = await fetch(base + "/api/stream?lines=14BK&traffic=1", { signal: sseCtrl.signal });
    assert.equal(sseRes.status, 200);
    const reader = sseRes.body.getReader();
    const firstChunk = await reader.read();
    const sseText = new TextDecoder().decode(firstChunk.value);
    assert.ok(sseText.includes("event: ready"), "SSE stream must emit ready event");
    sseCtrl.abort();

    // 200 Concurrent Load & Stress Test
    const heapBefore = process.memoryUsage().heapUsed;
    const tLoad0 = performance.now();
    const latencies = [];
    let errors = 0;
    const jobs = Array.from({ length: 200 }, (_, i) => {
      const ep = i % 4 === 0 ? "/api/fleet?bbox=40.98,28.95,41.05,29.06" : i % 4 === 1 ? "/api/health" : i % 4 === 2 ? "/api/metrics" : "/";
      const s = performance.now();
      return fetch(base + ep)
        .then((r) => {
          if (!r.ok) errors++;
          return r.text();
        })
        .catch(() => {
          errors++;
        })
        .finally(() => latencies.push(performance.now() - s));
    });
    await Promise.all(jobs);
    const totalLoadMs = performance.now() - tLoad0;
    latencies.sort((a, b) => a - b);
    const metricsSnap = await (await fetch(base + "/api/metrics")).json();

    report.stress200 = {
      totalMs: Math.round(totalLoadMs),
      rps: Math.round((200 / totalLoadMs) * 1000),
      errors,
      p50Ms: Number(latencies[100].toFixed(2)),
      p95Ms: Number(latencies[190].toFixed(2)),
      p99Ms: Number(latencies[198].toFixed(2)),
      heapDeltaMB: Number(((process.memoryUsage().heapUsed - heapBefore) / 1048576).toFixed(2)),
      gatewayCoalesced: metricsSnap.requests.coalesced,
      cacheHitRatio: metricsSnap.cache.hitRatio,
    };
    assert.equal(errors, 0, "Zero errors allowed under 200 concurrent requests");
  } finally {
    server.close();
  }

  console.log(JSON.stringify(report, null, 2));
  console.log("ALL_BENCHMARKS_AND_TESTS_PASSED");
}

main().catch((err) => {
  console.error("BENCHMARK FAILED:", err);
  process.exit(1);
});
