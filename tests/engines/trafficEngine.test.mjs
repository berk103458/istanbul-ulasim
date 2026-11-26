// Faz 2 — TrafficEngine birim testleri (node:test, opsiyonel motor). Kaynak dosyalara dokunulmaz.
// Canlı TKM çağrısı `API.http`→`Bridge`→`fetch` stub ile izole; zaman sabitlenir;
// her test için modül taze (freshImport) → singleton state izolasyonu.
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { stubFetch, fakeResponse, freezeTime, freshImport, readJsonFixture, FIXED_MS } from "../fixtures/helpers.mjs";

const MOD = "../../src/engines/trafficEngine.js";
async function freshTraffic() {
  const m = await freshImport(MOD);
  return m.TrafficEngine;
}

describe("TrafficEngine.buildSpatialIndex + getCorridorSpeed", () => {
  test("0.02° grid; speed/congestion ortalaması; seg.length<6 atlanır; bozuk geo", async () => {
    const TE = await freshTraffic();
    TE.buildSpatialIndex([
      [101, [41.0, 29.0, 41.0, 29.01], 40.99, 28.99, 41.001, 29.011],
      [null],
      [102, [41.01, 29.0, 41.01, 29.01], 40.999, 28.99, 41.011, 29.011, "extra"], // len>=6 ok
      "garbage",
      [103], // len<6 atlanır
    ]);
    TE.setTrafficData(new Map([[101, [3, 20.0]], [102, [5, 8.0]]]));
    const r = TE.getCorridorSpeed({ lat: 41.0, lon: 29.0005 }, { lat: 41.0, lon: 29.005 });
    assert.ok(Number.isFinite(r.speedKmH));
    assert.ok(r.speedKmH >= 8 && r.speedKmH <= 20, `ortalama ${r.speedKmH}`);
    assert.ok(r.congestionLevel >= 3 && r.congestionLevel <= 5);
    assert.equal(r.incident, null);
  });

  test("tek segment → tam değerler; speed>0 şartı; eksik veri → null", async () => {
    const TE = await freshTraffic();
    TE.buildSpatialIndex([[101, [41.0, 29.0, 41.0, 29.01], 40.99, 28.99, 41.001, 29.011]]);
    TE.setTrafficData(new Map([[101, [3, 20.0]]]));
    const r = TE.getCorridorSpeed({ lat: 41.0, lon: 29.0 }, { lat: 41.0, lon: 29.005 });
    assert.equal(r.speedKmH, 20);
    assert.equal(r.congestionLevel, 3);
    // speed=0 / NaN / eksik id → sayılmaz
    TE.setTrafficData(new Map([[101, [3, 0]]]));
    assert.deepEqual(TE.getCorridorSpeed({ lat: 41.0, lon: 29.0 }, { lat: 41.0, lon: 29.005 }).speedKmH, null);
    TE.setTrafficData(new Map([[101, [3, NaN]]]));
    assert.equal(TE.getCorridorSpeed({ lat: 41.0, lon: 29.0 }, { lat: 41.0, lon: 29.005 }).speedKmH, null);
    TE.setTrafficData(new Map([[999, [3, 20]]]));
    assert.equal(TE.getCorridorSpeed({ lat: 41.0, lon: 29.0 }, { lat: 41.0, lon: 29.005 }).speedKmH, null);
  });

  test("no veri / no grid / a,b null → {speedKmH:null,congestionLevel:null,incident}", async () => {
    const TE = await freshTraffic();
    assert.deepEqual(TE.getCorridorSpeed({ lat: 41, lon: 29 }, { lat: 41, lon: 29.01 }), { speedKmH: null, congestionLevel: null, incident: null });
    TE.buildSpatialIndex([[101, [41.0, 29.0, 41.0, 29.01], 40.99, 28.99, 41.001, 29.011]]);
    assert.equal(TE.getCorridorSpeed({ lat: 41, lon: 29 }, { lat: 41, lon: 29.01 }).speedKmH, null, "no cachedVeri");
    TE.setTrafficData(new Map([[101, [3, 20]]]));
    assert.equal(TE.getCorridorSpeed(null, { lat: 41, lon: 29 }).speedKmH, null);
    assert.equal(TE.getCorridorSpeed({ lat: 41, lon: 29 }, null).speedKmH, null);
  });

  test("boş/bozuk veri: buildSpatialIndex(null) / [] / non-array", async () => {
    const TE = await freshTraffic();
    TE.buildSpatialIndex(null);
    assert.equal(TE.getCorridorSpeed({ lat: 41, lon: 29 }, { lat: 41, lon: 29.01 }).speedKmH, null);
    TE.buildSpatialIndex([]);
    TE.setTrafficData(new Map([[1, [1, 10]]]));
    assert.equal(TE.getCorridorSpeed({ lat: 41, lon: 29 }, { lat: 41, lon: 29.01 }).speedKmH, null);
  });
});

describe("TrafficEngine.getVisibleBatchedPolylines", () => {
  const setup = async () => {
    const TE = await freshTraffic();
    TE.buildSpatialIndex(readJsonFixture("traffic.sample.json").geo);
    TE.setTrafficData(new Map(readJsonFixture("traffic.sample.json").veri));
    return TE;
  };
  const bounds = { minLat: 40.98, minLon: 28.98, maxLat: 41.03, maxLon: 29.03 };

  test("5 kova {1..5}; level küme round [1,5]; veri yoksa atlanır", async () => {
    const TE = await setup();
    const out = TE.getVisibleBatchedPolylines(bounds, 12);
    assert.deepEqual(Object.keys(out).sort(), ["1", "2", "3", "4", "5"]);
    const total = [1, 2, 3, 4, 5].reduce((n, k) => n + out[k].length, 0);
    assert.equal(total, 2, "iki segment iki kovaya");
    // 101 level3 → bucket3; 102 level5 → bucket5
    assert.equal(out[3].length, 1);
    assert.equal(out[5].length, 1);
    // level küme: sahte veri
    TE.setTrafficData(new Map([[101, [99, 20]], [102, [0, 8]]]));
    const clamped = TE.getVisibleBatchedPolylines(bounds, 12);
    assert.equal(clamped[5].length, 1, "99→5");
    assert.equal(clamped[1].length, 1, "0→1");
  });

  test("veri boş / grid boş / bounds yok → boş kovalar", async () => {
    const TE = await setup();
    assert.deepEqual(TE.getVisibleBatchedPolylines(bounds, 12, new Map()), { 1: [], 2: [], 3: [], 4: [], 5: [] });
    assert.deepEqual(TE.getVisibleBatchedPolylines(null, 12), { 1: [], 2: [], 3: [], 4: [], 5: [] });
    const empty = await freshTraffic();
    assert.deepEqual(empty.getVisibleBatchedPolylines(bounds, 12, new Map([[1, [1, 1]]])), { 1: [], 2: [], 3: [], 4: [], 5: [] });
  });

  test("bounds dışı segment hariç; zoom<12 + ana filtresi", async () => {
    const TE = await setup();
    const far = { minLat: 10, minLon: 10, maxLat: 11, maxLon: 11 };
    const out = TE.getVisibleBatchedPolylines(far, 12);
    assert.equal([1, 2, 3, 4, 5].reduce((n, k) => n + out[k].length, 0), 0);
    // zoom<12 + ana set → sadece ana yollar
    TE.setTrafficData(new Map(readJsonFixture("traffic.sample.json").veri), new Set([101]));
    const anaOut = TE.getVisibleBatchedPolylines(bounds, 10);
    assert.equal([1, 2, 3, 4, 5].reduce((n, k) => n + anaOut[k].length, 0), 1, "sadece ana id101");
  });
});

describe("TrafficEngine.fetchIncidents (TKM canlı, fetch stub, cache/fallback)", () => {
  const TKM = "https://tkmservices.ibb.gov.tr/web/api/IntensityMap/v1/CurrentAnnouncement";

  test("TKM JSON parse + alan normalizasyonu + non-finite lat/lon filtre", async (t) => {
    freezeTime(t, FIXED_MS);
    const TE = await freshTraffic();
    let calledUrl = null;
    stubFetch(t, async (url) => {
      calledUrl = String(url);
      return fakeResponse([
        { ID: 7, BASLIK: " Kaza ", METIN: "m", LAT: "41.0", LON: "29.0", TUR: "Kaza", ONCELIK: 3, GIRIS_TARIHI: "g", BITIS_TARIHI: "b" },
        { id: 8, Title: "x", Latitude: 41.1, Longitude: 29.1 },
        { id: 9, LAT: "not", LON: "num" }, // filtrelenir
        { id: 10, lat: 41.2, lon: 29.2, Baslik: "alt" },
      ], { status: 200 });
    });
    const inc = await TE.fetchIncidents();
    assert.equal(calledUrl, TKM);
    assert.ok(inc.length >= 2, `finite lat/lon filter, got ${inc.length}`);
    const kaza = inc.find((x) => x.id === 7);
    assert.ok(kaza);
    assert.equal(kaza.baslik, "Kaza", "trim + String");
    assert.equal(kaza.lat, 41.0, "Number(string)");
    assert.equal(kaza.oncelik, 3);
    assert.equal(kaza.tur, "Kaza");
    // alan adı alternatifleri
    assert.ok(inc.some((x) => x.id === 8 && x.baslik === "x"));
  });

  test("`parsed?.Data` sarılı; array değilse []; boş raw → []", async (t) => {
    const TE = await freshTraffic();
    stubFetch(t, async () => fakeResponse({ Data: [{ ID: 1, LAT: 41, LON: 29 }] }, { status: 200 }));
    assert.equal((await TE.fetchIncidents()).length, 1);
    const TE2 = await freshTraffic();
    stubFetch(t, async () => fakeResponse("not json", { status: 200 })); // JSON.parse throw → catch → cached []
    assert.deepEqual(await TE2.fetchIncidents(), []);
    const TE3 = await freshTraffic();
    stubFetch(t, async () => fakeResponse("", { status: 200 })); // raw||"[]"
    assert.deepEqual(await TE3.fetchIncidents(), []);
  });

  test("60s cache; sonraki 60s içinde fetch tekrarlanmaz", async (t) => {
    freezeTime(t, FIXED_MS);
    const TE = await freshTraffic();
    let calls = 0;
    stubFetch(t, async () => { calls++; return fakeResponse([{ ID: 1, LAT: 41, LON: 29 }], { status: 200 }); });
    await TE.fetchIncidents();
    await TE.fetchIncidents();
    assert.equal(calls, 1, "60s içinde cache");
    t.mock.timers.setTime(FIXED_MS + 61_000);
    await TE.fetchIncidents();
    assert.equal(calls, 2, "60s sonra yenileme");
  });

  test("cache/fallback: hata → cachedIncidents döner; boş cache → []", async (t) => {
    freezeTime(t, FIXED_MS);
    const TE = await freshTraffic();
    stubFetch(t, async () => fakeResponse([{ ID: 1, LAT: 41, LON: 29, BASLIK: "x" }], { status: 200 }));
    assert.equal((await TE.fetchIncidents()).length, 1);
    // sonraki çağrı hata verir ama 60s içinde cache... zamanı ilerlet
    t.mock.timers.setTime(FIXED_MS + 61_000);
    stubFetch(t, async () => { throw new Error("network down"); });
    const out = await TE.fetchIncidents();
    assert.equal(out.length, 1, "hata → cached korunur");
    // boş cache + hata → []
    const TE2 = await freshTraffic();
    stubFetch(t, async () => fakeResponse("x", { status: 500 })); // API.http throw → catch
    assert.deepEqual(await TE2.fetchIncidents(), []);
  });
});

describe("TrafficEngine.getIncidentPenalty", () => {
  test("penaltyMin: incident yok→0; oncelik 1→3, 2→5, >=3→8", async (t) => {
    freezeTime(t, FIXED_MS);
    const TE = await freshTraffic();
    // incident cache'i doldur
    stubFetch(t, async () => fakeResponse([{ ID: 1, LAT: 41.0, LON: 29.005, ONCELIK: 1, BASLIK: "i" }], { status: 200 }));
    // baseline: incident olmadan penalty 0
    let p = TE.getIncidentPenalty({ lat: 41, lon: 29 }, { lat: 41, lon: 29.01 });
    assert.equal(p.penaltyMin, 0);
    // incident'i cachedIncidents'a al
    await TE.fetchIncidents();
    p = TE.getIncidentPenalty({ lat: 41, lon: 29 }, { lat: 41, lon: 29.01 });
    assert.ok(p.incident, "yakın incident bulundu");
    assert.equal(p.penaltyMin, 3, "oncelik 1 → 3");
  });

  test("getIncidentPenalty base alanları + penaltyMin türleri", async (t) => {
    freezeTime(t, FIXED_MS);
    const TE = await freshTraffic();
    // incident cache boş
    const p = TE.getIncidentPenalty({ lat: 41, lon: 29 }, { lat: 41, lon: 29.01 });
    assert.deepEqual(Object.keys(p).sort(), ["congestionLevel", "incident", "penaltyMin", "speedKmH"].sort());
    assert.equal(p.penaltyMin, 0);
  });
});

describe("TrafficEngine.analyzeCorridors", () => {
  test("8 koridor; veri yok → 'Veri Yok'; segment eşleşmesi; ortHiz/seviye/tahminiDk/durum", async () => {
    const TE = await freshTraffic();
    // boş
    let out = TE.analyzeCorridors(new Map(), []);
    assert.equal(out.length, 8);
    assert.ok(out.every((c) => c.durum === "Veri Yok" && c.ortHiz === null && c.seviye === 0 && c.tahminiDk === null));
    // FSM Köprüsü koridoru (41.084-41.099, 29.042-29.076)
    const seg = [9, [41.09, 29.05, 41.09, 29.055], 41.09, 29.05, 41.091, 29.056];
    out = TE.analyzeCorridors(new Map([[9, [4, 12]]]), [seg]);
    const fsm = out.find((c) => c.ad === "FSM Köprüsü");
    assert.ok(fsm);
    assert.equal(fsm.ortHiz, 12);
    assert.equal(fsm.seviye, 4);
    assert.equal(fsm.durum, "Yoğun");
    assert.equal(fsm.tahminiDk, Math.max(1, Math.round((3.6 / 12) * 60)), "km/ortHiz*60");
    // seviye eşikleri
    const seviye = (lvl) => TE.analyzeCorridors(new Map([[9, [lvl, 12]]]), [seg]).find((c) => c.ad === "FSM Köprüsü").durum;
    assert.equal(seviye(1), "Akıcı");
    assert.equal(seviye(2), "Hafif Yoğun");
    assert.equal(seviye(3), "Orta Yoğun");
    assert.equal(seviye(4), "Yoğun");
    assert.equal(seviye(5), "Çok Yoğun");
  });
});
