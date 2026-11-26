// Faz 2 — TrackingEngine birim testleri (node:test). Kaynak dosyalara dokunulmaz.
// Saf fonksiyonlar; ağ yok; `stepAnimations` için zaman `nowMs` ile sabitlenir.
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { TrackingEngine } from "../../src/engines/trackingEngine.js";

const B = { minLat: 40.99, minLon: 28.99, maxLat: 41.01, maxLon: 29.01 };
const vehicles = () => [
  { id: 1, lat: 41.0, lon: 29.0 },
  { id: 2, lat: 41.005, lon: 29.005 },
  { id: 3, lat: 41.0, lon: 29.006 },
  { id: 4, lat: 41.2, lon: 29.2 }, // dışında
];

describe("TrackingEngine.filterVisibleVehicles", () => {
  test("bounds içindeki araçlar", () => {
    const out = TrackingEngine.filterVisibleVehicles(vehicles(), B);
    assert.ok(out.every((v) => v.lat >= B.minLat && v.lat <= B.maxLat && v.lon >= B.minLon && v.lon <= B.maxLon));
    assert.ok(!out.some((v) => v.id === 4));
    assert.ok(out.length >= 3);
  });

  test("sınır değerleri dahil (>= <=)", () => {
    const edge = [
      { lat: B.minLat, lon: B.minLon },
      { lat: B.maxLat, lon: B.maxLon },
      { lat: B.minLat - 1e-9, lon: B.minLon },
    ];
    const out = TrackingEngine.filterVisibleVehicles(edge, B);
    assert.equal(out.length, 2, "tam sınırda dahil, dışında hariç");
  });

  test("Leaflet-style bounds (getSouth/getWest/getNorth/getEast)", () => {
    const leaflet = { getSouth: () => B.minLat, getWest: () => B.minLon, getNorth: () => B.maxLat, getEast: () => B.maxLon };
    const out = TrackingEngine.filterVisibleVehicles(vehicles(), leaflet);
    assert.equal(out.length, TrackingEngine.filterVisibleVehicles(vehicles(), B).length);
  });

  test("bounds null → aynı dizi döner (filtrelenmez)", () => {
    const v = vehicles();
    assert.equal(TrackingEngine.filterVisibleVehicles(v, null), v, "!b → vehicles aynen");
    assert.equal(TrackingEngine.filterVisibleVehicles(v, undefined), v);
  });

  test("boş/bozuk veri", () => {
    assert.deepEqual(TrackingEngine.filterVisibleVehicles([], B), []);
    assert.deepEqual(TrackingEngine.filterVisibleVehicles(null, B), []);
    assert.deepEqual(TrackingEngine.filterVisibleVehicles(undefined, B), []);
    assert.deepEqual(TrackingEngine.filterVisibleVehicles("x", B), []);
    // geçersiz koordinatlı araçlar atılır (bounds varsa)
    const out = TrackingEngine.filterVisibleVehicles(
      [{ lat: 41.0, lon: 29.0 }, { lat: NaN, lon: 29.0 }, { lat: 41.0 }, null, { lat: "x", lon: "y" }, { lat: 41.0, lon: 29.0, extra: 1 }],
      B
    );
    assert.equal(out.length, 2, "NaN/eksik/null atılır");
  });
});

describe("TrackingEngine.clusterVehicles", () => {
  test("zoom >= 14 → tekil araçlar", () => {
    const out = TrackingEngine.clusterVehicles(vehicles(), 14, B);
    assert.ok(out.every((o) => o.type === "single"));
  });

  test("zoom < 14 → grid kümeleme; ortalama konum + count", () => {
    const out = TrackingEngine.clusterVehicles(vehicles(), 10, B);
    assert.ok(Array.isArray(out));
    const clusters = out.filter((o) => o.type === "cluster");
    // en az bir küme ya da tekiller; her küme count>=2 + ortalama lat/lon
    for (const c of clusters) {
      assert.ok(c.count >= 2);
      assert.ok(Number.isFinite(c.lat) && Number.isFinite(c.lon));
    }
    const total = out.reduce((n, o) => n + (o.type === "cluster" ? o.count : 1), 0);
    assert.ok(total >= 1);
  });

  test("aynı hücredeki iki araç kümelenir (count=2, ortalama)", () => {
    const pair = [{ lat: 41.0000, lon: 29.0000 }, { lat: 41.0001, lon: 29.0001 }];
    const out = TrackingEngine.clusterVehicles(pair, 10);
    const cluster = out.find((o) => o.type === "cluster");
    assert.ok(cluster, "küme oluşmalı");
    assert.equal(cluster.count, 2);
    assert.ok(Math.abs(cluster.lat - 41.00005) < 1e-9);
    assert.ok(Math.abs(cluster.lon - 29.00005) < 1e-9);
  });

  test("küme hücre boyutu zoom ile değişir: cellDeg=0.004*2^max(0,13-zoom)", () => {
    // zoom 12 → cellDeg=0.008; zoom 13 → 0.004; zoom 10 → 0.032
    const pair = [{ lat: 41.0, lon: 29.0 }, { lat: 41.0001, lon: 29.0001 }];
    assert.ok(TrackingEngine.clusterVehicles(pair, 13).some((o) => o.type === "cluster"));
    assert.ok(TrackingEngine.clusterVehicles(pair, 12).some((o) => o.type === "cluster"));
  });

  test("bounds ile viewport kırpma", () => {
    const out = TrackingEngine.clusterVehicles(vehicles(), 14, B);
    assert.ok(!out.some((o) => o.bus && o.bus.id === 4), "bounds dışı hariç");
  });

  test("boş/bozuk veri", () => {
    assert.deepEqual(TrackingEngine.clusterVehicles([], 10), []);
    assert.deepEqual(TrackingEngine.clusterVehicles(null, 10), []);
    assert.deepEqual(TrackingEngine.clusterVehicles(undefined, 10), []);
    const bad = [{ lat: 41.0, lon: 29.0 }, null, { lat: NaN, lon: 1 }, {}, { lat: 41.0001, lon: 29.0001 }];
    const clustered = TrackingEngine.clusterVehicles(bad, 10);
    assert.ok(!clustered.some((o) => o.type === "single" && (o.bus == null || !Number.isFinite(o.bus.lat))));
  });

  test("zoom>=14 + bounds=null → yalnızca geçerli araçlar tekil işaretçi olur", () => {
    const bad = [{ lat: 41.0, lon: 29.0 }, null, { lat: NaN, lon: 1 }];
    const out = TrackingEngine.clusterVehicles(bad, 14, null);
    assert.deepEqual(out, [{ type: "single", bus: bad[0] }]);
  });

  test("varsayılan zoom=14", () => {
    const out = TrackingEngine.clusterVehicles(vehicles());
    assert.ok(out.every((o) => o.type === "single"));
  });
});

describe("TrackingEngine.stepAnimations", () => {
  const item = (over = {}) => ({
    animating: true,
    fromLat: 41.0, fromLon: 29.0, toLat: 41.01, toLon: 29.01,
    startMs: 1000, durationMs: 1000, lat: 41.0, lon: 29.0, marker: null, ...over,
  });

  test("t=0 → başlangıç; aktif sayısı", () => {
    const a = item();
    const active = TrackingEngine.stepAnimations(new Map([["x", a]]), 1000);
    assert.equal(active, 1);
    assert.ok(Math.abs(a.lat - 41.0) < 1e-9 && Math.abs(a.lon - 29.0) < 1e-9);
    assert.equal(a.animating, true);
  });

  test("ease-out cubic t=1-(1-rawT)^3", () => {
    const a = item();
    TrackingEngine.stepAnimations([a], 1500); // rawT=0.5 → t=0.875
    assert.ok(Math.abs(a.lat - (41.0 + 0.01 * 0.875)) < 1e-9, `lat ${a.lat}`);
    assert.ok(Math.abs(a.lon - (29.0 + 0.01 * 0.875)) < 1e-9);
  });

  test("rawT küme [0,1]; rawT>=1 → bitti, from=to", () => {
    const a = item();
    const active = TrackingEngine.stepAnimations([a], 5000); // rawT>1 → 1
    assert.equal(active, 0);
    assert.equal(a.animating, false);
    assert.ok(Math.abs(a.lat - a.toLat) < 1e-12);
    assert.equal(a.fromLat, a.toLat);
    assert.equal(a.fromLon, a.toLon);
    // tam rawT=1
    const b = item();
    assert.equal(TrackingEngine.stepAnimations([b], 2000), 0); // startMs1000+dur1000
    assert.equal(b.animating, false);
    // geçmiş (nowMs < startMs) → rawT=0 küme
    const c = item();
    TrackingEngine.stepAnimations([c], 0);
    assert.ok(Math.abs(c.lat - c.fromLat) < 1e-12);
  });

  test("durationMs varsayılan 800; durationMs=0 → 800", () => {
    const a = item({ durationMs: undefined });
    TrackingEngine.stepAnimations([a], 1000 + 400); // rawT=0.5
    assert.ok(Math.abs(a.lat - (41.0 + 0.01 * 0.875)) < 1e-9);
    const b = item({ durationMs: 0 });
    TrackingEngine.stepAnimations([b], 1000 + 400);
    assert.ok(Math.abs(b.lat - (41.0 + 0.01 * 0.875)) < 1e-9, "durationMs||800");
  });

  test("marker.setLatLng çağrılır", () => {
    const calls = [];
    const a = item({ marker: { setLatLng: (ll) => calls.push(ll) } });
    TrackingEngine.stepAnimations([a], 1500);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].length, 2);
    assert.ok(Math.abs(calls[0][0] - a.lat) < 1e-12);
  });

  test("animating=false olanlar atlanır", () => {
    const a = item({ animating: false });
    const active = TrackingEngine.stepAnimations([a], 1500);
    assert.equal(active, 0);
    assert.ok(Math.abs(a.lat - 41.0) < 1e-12, "değişmez");
  });

  test("boş/bozuk girdi", () => {
    assert.equal(TrackingEngine.stepAnimations(null), 0);
    assert.equal(TrackingEngine.stepAnimations(undefined), 0);
    assert.equal(TrackingEngine.stepAnimations(new Map()), 0);
    assert.equal(TrackingEngine.stepAnimations([null, undefined, {}], 100), 0);
    assert.equal(TrackingEngine.stepAnimations([item({ animating: false })], 100), 0);
  });

  test("Map veya iterable; `.values()` olan nesne", () => {
    const a = item();
    assert.equal(TrackingEngine.stepAnimations(new Map([["k", a]]), 1500), 1);
    const b = item();
    assert.equal(TrackingEngine.stepAnimations([b], 1500), 1);
  });

  test("şimdiki zaman varsayılan (nowMs verilmezse performance.now/Date.now)", () => {
    const a = item({ startMs: 0, durationMs: 1 });
    const active = TrackingEngine.stepAnimations([a]); // çok geç → rawT=1
    assert.equal(active, 0);
    assert.equal(a.animating, false);
  });
});
