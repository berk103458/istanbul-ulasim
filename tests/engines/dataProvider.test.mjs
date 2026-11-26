// Faz 2 — DataProvider birim testleri (node:test). Kaynak dosyalara dokunulmaz.
// Ağ `fetch` stub ile izole; IndexedDB yok; localStorage stub; zaman sabitlenir;
// her test için modül taze (`freshImport`) → singleton state izolasyonu.
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  stubFetch, fakeResponse, stubLocalStorage, freezeTime, freshImport, readJsonFixture, FIXED_MS,
} from "../fixtures/helpers.mjs";

const MOD = "../../src/engines/dataProvider.js";
async function freshProvider() {
  const m = await freshImport(MOD);
  return m.DataProvider;
}

describe("DataProvider.coalesce", () => {
  test("aynı key için eşzamanlı çağrılar tek promise döner (dedup)", async () => {
    const P = await freshProvider();
    let calls = 0;
    const fn = async () => { calls++; await new Promise((r) => setImmediate(r)); return "v" + calls; };
    const [a, b] = await Promise.all([P.coalesce("k", fn), P.coalesce("k", fn)]);
    assert.equal(calls, 1, "fn bir kez çalışır");
    assert.equal(a, b, "aynı sonuç");
    assert.equal(a, "v1");
  });

  test("sıralı çağrılar tekrar çalışır (inflight temizlenir)", async () => {
    const P = await freshProvider();
    let calls = 0;
    const fn = async () => ++calls;
    assert.equal(await P.coalesce("k", fn), 1);
    assert.equal(await P.coalesce("k", fn), 2, "inflight bitince yeni çağrı");
  });

  test("farklı key'ler bağımsız", async () => {
    const P = await freshProvider();
    let calls = 0;
    const fn = async () => ++calls;
    await Promise.all([P.coalesce("a", fn), P.coalesce("b", fn)]);
    assert.equal(calls, 2);
  });

  test("fn rejects → inflight temizlenir, hata iletilir; sonraki çağrı çalışır", async () => {
    const P = await freshProvider();
    let n = 0;
    await assert.rejects(P.coalesce("k", async () => { n++; throw new Error("boom"); }), /boom/);
    assert.equal(n, 1);
    assert.equal(await P.coalesce("k", async () => 42), 42, "finally inflight.delete");
  });
});

describe("DataProvider.swr (stale-while-revalidate cache)", () => {
  test("miss → fn çağrılır, sonuç döner; memCache'e yazar", async (t) => {
    freezeTime(t, FIXED_MS);
    const P = await freshProvider();
    let calls = 0;
    const fn = async () => { calls++; return { v: calls }; };
    const r1 = await P.swr("k1", 1000, fn);
    assert.deepEqual(r1, { v: 1 });
    assert.equal(calls, 1);
    // taze: maxAge içinde tekrar → cache, fn çağrılmaz
    const r2 = await P.swr("k1", 1000, fn);
    assert.deepEqual(r2, { v: 1 });
    assert.equal(calls, 1, "taze memCache");
  });

  test("stale → eski veriyi HEMEN döner + arka planda yeniler + onUpdate", async (t) => {
    freezeTime(t, FIXED_MS);
    const P = await freshProvider();
    let calls = 0;
    let updated = null;
    const fn = async () => { calls++; return "v" + calls; };
    assert.equal(await P.swr("k2", 1000, fn, (f) => { updated = f; }), "v1");
    // zamanı ilerlet → stale
    t.mock.timers.setTime(FIXED_MS + 2000);
    const r = await P.swr("k2", 1000, fn, (f) => { updated = f; });
    assert.equal(r, "v1", "stale eski veri döner");
    // arka plan yenileme tamamlanmasını bekle
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 2, "arka planda fn çağrıldı");
    assert.equal(updated, "v2", "onUpdate(fresh)");
    // sonraki taze çağrı yeni veriyi döner
    assert.equal(await P.swr("k2", 1000, fn), "v2");
  });

  test("stale + arka plan fn rejects → eski veri korunur, hata yutulur", async (t) => {
    freezeTime(t, FIXED_MS);
    const P = await freshProvider();
    let calls = 0;
    const fn = async () => { calls++; if (calls === 1) return "good"; throw new Error("fail"); };
    assert.equal(await P.swr("k3", 1000, fn), "good");
    t.mock.timers.setTime(FIXED_MS + 5000);
    const r = await P.swr("k3", 1000, fn);
    assert.equal(r, "good", "stale döner");
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 2);
    // memCache hâlâ 'good'; sonraki çağrı stale + yeniden deneme, hata yine yutulur
    const r2 = await P.swr("k3", 1000, fn);
    assert.equal(r2, "good");
  });

  test("cache/fallback: KV'den (localStorage) stale okur + arka planda yeniler", async (t) => {
    freezeTime(t, FIXED_MS);
    const ls = stubLocalStorage(t);
    // DataProvider KV.set(key, fresh) localStorage'a yazmaz (PREF_KEYS dışı); elle seed ediyoruz:
    ls.setItem("ulasim.k4", JSON.stringify({ t: FIXED_MS - 99999, d: "persisted" }));
    const P = await freshProvider();
    let calls = 0;
    const fn = async () => { calls++; return "fresh"; };
    const r = await P.swr("k4", 1000, fn);
    assert.equal(r, "persisted", "KV stale anında döner");
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 1, "arka planda revalidate");
    assert.equal(await P.swr("k4", 1_000_000, fn), "fresh", "memCache güncellendi");
  });

  test("BOZUK VERİ: KV'deki bozuk kayıt / KV.get null → miss yolu", async (t) => {
    freezeTime(t, FIXED_MS);
    const ls = stubLocalStorage(t);
    ls.setItem("ulasim.k5", "{ not valid json"); // lsGet JSON.parse throws → null
    const P = await freshProvider();
    const r = await P.swr("k5", 1000, async () => "fresh");
    assert.equal(r, "fresh");
  });

  test("cache/fallback: miss + fn rejects → swr REJECTS (stale yoksa yutulmaz)", async (t) => {
    freezeTime(t, FIXED_MS);
    const P = await freshProvider();
    await assert.rejects(P.swr("k6", 1000, async () => { throw new Error("nope"); }), /nope/);
    // memCache'e yazılmadı → sonraki çağrı tekrar dener
    assert.equal(await P.swr("k6", 1000, async () => "ok"), "ok");
  });

  test("aynı key eşzamanlı miss → coalesce ile tek fn", async (t) => {
    freezeTime(t, FIXED_MS);
    const P = await freshProvider();
    let calls = 0;
    const fn = async () => { calls++; await new Promise((r) => setImmediate(r)); return calls; };
    const [a, b] = await Promise.all([P.swr("k7", 1000, fn), P.swr("k7", 1000, fn)]);
    assert.equal(calls, 1, "swr:k7 coalesce");
    assert.equal(a, b);
  });
});

describe("DataProvider health", () => {
  test("markHealth/getHealth; bilinmeyen provider yok sayılır", async () => {
    const P = await freshProvider();
    const h0 = P.getHealth();
    assert.deepEqual(Object.keys(h0).sort(), ["google", "iett", "ispark", "metro", "sse", "tkm", "transitous", "vapur"].sort());
    assert.equal(h0.iett, "unknown");
    P.markHealth("iett", "ok");
    assert.equal(P.getHealth().iett, "ok");
    P.markHealth("iett", "down");
    assert.equal(P.getHealth().iett, "down");
    P.markHealth("nope", "ok");
    assert.ok(!("nope" in P.getHealth()), "unknown provider eklenmez");
    // snapshot kopya
    const snap = P.getHealth(); snap.iett = "x";
    assert.equal(P.getHealth().iett, "down");
  });
});

describe("DataProvider.hasBackendProxy → fetchFleetBbox", () => {
  const bbox = { minLat: 41.0, minLon: 29.0, maxLat: 41.01, maxLon: 29.01 };

  test("proxy yok (fetch health !ok) → [] ; health sonucu cache'lenir", async (t) => {
    const P = await freshProvider();
    let healthCalls = 0;
    stubFetch(t, async (url) => { healthCalls++; return fakeResponse("no", { status: 404 }); });
    assert.deepEqual(await P.fetchFleetBbox(bbox), []);
    assert.deepEqual(await P.fetchFleetBbox(bbox), [], "proxyAvailable=false cache");
    assert.equal(healthCalls, 1, "proxy probe bir kez");
  });

  test("proxy fetch throws → [] (proxyAvailable=false)", async (t) => {
    const P = await freshProvider();
    stubFetch(t, async () => { throw new Error("network down"); });
    assert.deepEqual(await P.fetchFleetBbox(bbox), []);
  });

  test("proxy var → /api/fleet?bbox=... toFixed(5) sıra + encodeURIComponent", async (t) => {
    const P = await freshProvider();
    const calls = [];
    const fleet = readJsonFixture("fleet.sample.json");
    stubFetch(t, async (url) => {
      calls.push(String(url));
      if (String(url).includes("/api/health")) return fakeResponse("{}", { status: 200 });
      return fakeResponse(fleet, { status: 200 });
    });
    const out = await P.fetchFleetBbox(bbox);
    assert.equal(out.length, 2, "fleet listesi");
    const fleetCall = calls.find((u) => u.includes("/api/fleet"));
    assert.ok(fleetCall, "fleet çağrısı");
    // bbox=minLat,minLon,maxLat,maxLon toFixed(5)
    assert.ok(fleetCall.includes("bbox=" + encodeURIComponent("41.00000,29.00000,41.01000,29.01000")), fleetCall);
    assert.ok(calls.some((u) => u.endsWith("/api/health") || u.includes("api/health")));
  });

  test("Leaflet-style bounds (getSouth/getWest/getNorth/getEast)", async (t) => {
    const P = await freshProvider();
    const calls = [];
    stubFetch(t, async (url) => {
      calls.push(String(url));
      if (String(url).includes("/api/health")) return fakeResponse("{}", { status: 200 });
      return fakeResponse([], { status: 200 });
    });
    await P.fetchFleetBbox({ getSouth: () => bbox.minLat, getWest: () => bbox.minLon, getNorth: () => bbox.maxLat, getEast: () => bbox.maxLon });
    const fleetCall = calls.find((u) => u.includes("/api/fleet"));
    assert.ok(fleetCall.includes(encodeURIComponent("41.00000,29.00000,41.01000,29.01000")));
  });

  test("bounds boş/geçersiz → []", async (t) => {
    const P = await freshProvider();
    let called = false;
    stubFetch(t, async () => { called = true; return fakeResponse({}, { status: 200 }); });
    assert.deepEqual(await P.fetchFleetBbox(null), []);
    assert.deepEqual(await P.fetchFleetBbox(undefined), []);
    assert.deepEqual(await P.fetchFleetBbox({ minLat: NaN, minLon: 1, maxLat: 2, maxLon: 3 }), []);
    assert.deepEqual(await P.fetchFleetBbox({ minLat: 1, minLon: 1, maxLat: 2 }), [], "eksik alan");
    assert.deepEqual(await P.fetchFleetBbox({}), []);
    // NOT: numeric kontrolden ÖNCE hasBackendProxy() çağrılır (fetch probe); null/undefined ise fetch'siz []
    assert.equal(called, true, "hasBackendProxy proxy probe fetch'i çağırır");
  });

  test("null/undefined bounds → hasBackendProxy ÇAĞRILMAZ", async (t) => {
    const P = await freshProvider();
    let called = false;
    stubFetch(t, async () => { called = true; return fakeResponse({}, { status: 200 }); });
    assert.deepEqual(await P.fetchFleetBbox(null), []);
    assert.deepEqual(await P.fetchFleetBbox(undefined), []);
    assert.equal(called, false, "!bounds → erken []");
  });

  test("fleet yanıtı: 404/405 → [] + proxyAvailable=false; !ok→[]; JSON bozuk→[]; vehicles alanı", async (t) => {
    // 404
    let P = await freshProvider();
    stubFetch(t, async (url) => String(url).includes("/api/health") ? fakeResponse("{}", { status: 200 }) : fakeResponse("x", { status: 404 }));
    assert.deepEqual(await P.fetchFleetBbox(bbox), []);
    // 405
    P = await freshProvider();
    stubFetch(t, async (url) => String(url).includes("/api/health") ? fakeResponse("{}", { status: 200 }) : fakeResponse("x", { status: 405 }));
    assert.deepEqual(await P.fetchFleetBbox(bbox), []);
    // 500
    P = await freshProvider();
    stubFetch(t, async (url) => String(url).includes("/api/health") ? fakeResponse("{}", { status: 200 }) : fakeResponse("x", { status: 500 }));
    assert.deepEqual(await P.fetchFleetBbox(bbox), []);
    // JSON bozuk
    P = await freshProvider();
    stubFetch(t, async (url) => String(url).includes("/api/health") ? fakeResponse("{}", { status: 200 }) : fakeResponse("not json", { status: 200 }));
    assert.deepEqual(await P.fetchFleetBbox(bbox), [], "res.json throw → catch []");
    // fleet network throw
    P = await freshProvider();
    stubFetch(t, async (url) => { if (String(url).includes("/api/health")) return fakeResponse("{}", { status: 200 }); throw new Error("x"); });
    assert.deepEqual(await P.fetchFleetBbox(bbox), []);
    // {vehicles: [...]} sarılı
    P = await freshProvider();
    stubFetch(t, async (url) => String(url).includes("/api/health") ? fakeResponse("{}", { status: 200 }) : fakeResponse({ vehicles: [{ id: 1 }] }, { status: 200 }));
    assert.deepEqual(await P.fetchFleetBbox(bbox), [{ id: 1 }]);
    // array olmayan + vehicles yok → []
    P = await freshProvider();
    stubFetch(t, async (url) => String(url).includes("/api/health") ? fakeResponse("{}", { status: 200 }) : fakeResponse({ foo: 1 }, { status: 200 }));
    assert.deepEqual(await P.fetchFleetBbox(bbox), []);
  });

  test("fetchFleetBbox coalesce: aynı bbox eşzamanlı → tek fleet fetch", async (t) => {
    const P = await freshProvider();
    let fleetCalls = 0;
    stubFetch(t, async (url) => {
      if (String(url).includes("/api/health")) return fakeResponse("{}", { status: 200 });
      fleetCalls++; await new Promise((r) => setImmediate(r)); return fakeResponse([], { status: 200 });
    });
    await Promise.all([P.fetchFleetBbox(bbox), P.fetchFleetBbox(bbox)]);
    assert.equal(fleetCalls, 1);
  });
});

describe("DataProvider.connectStream", () => {
  test("EventSource yok (Node) → sse down + noop unsubscribe + hata yok", (t) => {
    assert.equal(typeof EventSource, "undefined");
    return (async () => {
      const P = await freshProvider();
      let events = 0;
      const off = P.connectStream(["500"], true, () => events++);
      assert.equal(typeof off, "function");
      off();
      assert.equal(events, 0);
      assert.equal(P.getHealth().sse, "down");
    })();
  });

  test("fake EventSource: URL params, JSON/raw event dispatch, unsubscribe", async (t) => {
    const P = await freshProvider();
    // proxy probe
    stubFetch(t, async () => fakeResponse("{}", { status: 200 }));
    const created = [];
    class FakeEventSource {
      constructor(url) { this.url = url; this.readyState = 0; this.listeners = {}; created.push(this); }
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
      close() { this.readyState = 2; this.closed = true; }
    }
    FakeEventSource.CLOSED = 2;
    const origES = globalThis.EventSource;
    globalThis.EventSource = FakeEventSource;
    t.after(() => { if (origES === undefined) delete globalThis.EventSource; else globalThis.EventSource = origES; });
    const events = [];
    const off = P.connectStream(["500", "M2"], true, (ev) => events.push(ev));
    // proxy probe async → bekle
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.equal(created.length, 1, "EventSource oluşturuldu");
    const es = created[0];
    assert.ok(es.url.includes("/api/stream"), es.url);
    assert.ok(es.url.includes("lines=500%2CM2") || es.url.includes("lines=500,M2"), es.url);
    assert.ok(es.url.includes("traffic=1"), es.url);
    // onopen → ok
    es.onopen();
    assert.equal(P.getHealth().sse, "ok");
    // typed event JSON
    es.listeners["fleet"][0]({ data: JSON.stringify({ x: 1 }) });
    assert.deepEqual(events.at(-1), { type: "fleet", data: { x: 1 } });
    // bozuk JSON → raw data
    es.listeners["traffic"][0]({ data: "not json" });
    assert.deepEqual(events.at(-1), { type: "traffic", data: "not json" });
    // onmessage
    es.onmessage({ data: JSON.stringify({ m: 1 }) });
    assert.deepEqual(events.at(-1), { type: "message", data: { m: 1 } });
    // onerror: CLOSED → down + close; else degraded
    es.readyState = FakeEventSource.CLOSED;
    es.onerror();
    assert.equal(P.getHealth().sse, "down");
    // unsubscribe
    off();
    assert.equal(es.closed, true);
  });

  test("closed öncesi proxy hazır olunca EventSource açılmaz", async (t) => {
    const P = await freshProvider();
    stubFetch(t, async () => fakeResponse("{}", { status: 200 }));
    let created = 0;
    class FakeES { constructor() { created++; } addEventListener() {} close() {} }
    const origES = globalThis.EventSource;
    globalThis.EventSource = FakeES;
    t.after(() => { if (origES === undefined) delete globalThis.EventSource; else globalThis.EventSource = origES; });
    const off = P.connectStream([], false, () => {});
    off(); // hemen kapat
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.equal(created, 0, "closed=true → açılmaz");
  });
});
