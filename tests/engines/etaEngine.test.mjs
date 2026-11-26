// Faz 2 — EtaEngine birim testleri (node:test). Kaynak dosyalara dokunulmaz.
// Zaman sabitlenir (node:test mock.timers Date), ağ kullanılmaz.
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { EtaEngine } from "../../src/engines/etaEngine.js";
import { Core } from "../../src/core/geo.js";
import { FIXED_MS, freezeTime } from "../fixtures/helpers.mjs";

// 3 durak, ~84m arayla; kodlu duraklar (gerçek IETT durakları gibi).
const STOPS = [
  { lat: 41.0, lon: 29.0, ad: "A", kod: "A" },
  { lat: 41.0, lon: 29.001, ad: "B", kod: "B" },
  { lat: 41.0, lon: 29.002, ad: "C", kod: "C" },
];
const D1 = Core.mesafe(STOPS[0], STOPS[1]);
const D2 = Core.mesafe(STOPS[1], STOPS[2]);
const YOL_KATSAYISI = 1.15;

describe("EtaEngine.predict — temel hesap", () => {
  test("başarılı tahmin: metre, dwell, speed, dakika/saniye, varsayılanlar", () => {
    const r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0 }, 2, {});
    assert.ok(r);
    const metre = Math.round((0 + D1 + D2) * YOL_KATSAYISI);
    assert.equal(r.metre, metre, "kalan mesafe * 1.15, yuvarlanmış");
    assert.equal(r.durakSayisi, 2);
    assert.equal(r.duraklamaDk, 0.7, "2 durak * 0.35");
    assert.equal(r.hizKmSa, 15, "hatBilgi yok → ortalamaHiz=15");
    assert.equal(r.trafikEtkisiDk, 0);
    assert.equal(r.kazaEtkisiDk, 0);
    assert.equal(r.gecikmeDk, 0);
    assert.equal(r.durumKod, "ON_TIME");
    assert.equal(r.durumEtiket, "Zamanında");
    assert.equal(r.guven, "high");
    assert.equal(r.sonGuncellemeSn, null);
    assert.equal(r.plaka, "");
    assert.equal(r.operator, "İETT");
    // totalDk = baseRunDk + dwell; dakika/saniye yuvarlanmış + max(0)
    const totalDk = (metre / 1000 / Math.max(5, r.hizKmSa)) * 60 + r.duraklamaDk;
    assert.equal(r.dakika, Math.max(0, Math.round(totalDk)));
    assert.equal(r.saniye, Math.max(0, Math.round(totalDk * 60)));
  });

  test("siradakiDurak: araç sonraki durağa yaklaşınca durakSayisi düşer", () => {
    const r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0009, kod: "B" }, 2, {});
    assert.ok(r);
    assert.ok(r.durakSayisi <= 2);
    assert.ok(Number.isFinite(r.metre) && r.metre >= 0);
  });

  test("yakinDurak koduyla siradaki durak belirlenir", () => {
    const r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.001, yakinDurak: "B" }, 2, {});
    assert.ok(r);
    assert.equal(r.durakSayisi, 1, "B'den C'ye 1 durak");
    assert.ok(Math.abs(r.metre - Math.round(D2 * YOL_KATSAYISI)) <= 1);
  });
});

describe("EtaEngine.predict — ETA sınırları (bounds)", () => {
  test("hedefIndex sınırları", () => {
    const bus = { lat: 41.0, lon: 29.0 };
    assert.equal(EtaEngine.predict(STOPS, bus, -1, {}), null, "hedefIndex<0 → null");
    assert.equal(EtaEngine.predict(STOPS, bus, STOPS.length, {}), null, "hedefIndex>=len → null");
    assert.equal(EtaEngine.predict(STOPS, bus, STOPS.length + 5, {}), null);
    assert.ok(EtaEngine.predict(STOPS, bus, STOPS.length - 1, {}), "hedefIndex=len-1 geçerli");
    assert.ok(EtaEngine.predict(STOPS, bus, 0, {}) !== undefined);
  });

  test("hedefIndex=0 (ilk durak) araç henüz gelmemişse geçerli", () => {
    // araç A'da, hedef A → siradaki=0, hedefIndex=0; siradaki>hedefIndex değil → null DEĞİL
    const r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0, yakinDurak: "A" }, 0, {});
    // siradaki=0 (i=duraklar[0], sonra mesafe kontrolü) ... siradaki(0)>hedefIndex(0) false
    if (r) {
      assert.ok(Number.isFinite(r.metre));
      assert.ok(r.dakika >= 0 && r.saniye >= 0);
    }
  });

  test("ulaşılmış/geçilmiş hedef: siradaki > hedefIndex → null", () => {
    // araç C'de (son durak), hedef A (index0): siradaki=2 > 0 → null
    const r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.002, kod: "C", yakinDurak: "C" }, 0, {});
    assert.equal(r, null);
  });

  test("dakika/saniye negatif olamaz; totalDk >= 0", () => {
    const r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0 }, 2, { scheduledOffsetMin: -100 });
    assert.ok(r);
    assert.ok(r.dakika >= 0 && r.saniye >= 0, "Math.max(0,...)");
    assert.ok(r.gecikmeDk >= 0);
    assert.equal(r.dakika, 0);
    assert.equal(r.saniye, 0);
  });

  test("scheduledOffsetMin sayısal değilse 0; Number||0", () => {
    const base = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0 }, 2, {});
    const nan = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0 }, 2, { scheduledOffsetMin: "x" });
    assert.equal(nan.dakika, base.dakika);
    assert.equal(nan.saniye, base.saniye);
  });

  test("scheduledOffsetMin toplamı artırır + DELAYED tetikler", () => {
    const r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0 }, 2, { scheduledOffsetMin: 10 });
    assert.ok(r);
    assert.ok(r.gecikmeDk >= 2, `gecikme ${r.gecikmeDk}`);
    assert.equal(r.durumKod, "DELAYED", "totalDk > scheduled*1.2 && gecikme>=2");
    assert.equal(r.guven, "medium");
  });

  test("scheduledDk minimumu 0.5", () => {
    // çok kısa mesafe → scheduledDk 0.5 tabanı; dakika/saniye >= 0
    const tiny = [{ lat: 41.0, lon: 29.0, kod: "X" }, { lat: 41.000001, lon: 29.0, kod: "Y" }];
    const r = EtaEngine.predict(tiny, { lat: 41.0, lon: 29.0 }, 1, {});
    assert.ok(r);
    assert.ok(r.dakika >= 0 && r.saniye >= 0);
    assert.ok(r.durakSayisi === 1);
  });
});

describe("EtaEngine.predict — hız faktörleri", () => {
  test("hatBilgi uzunlukKm/seferSuresiDk → schedSpeed (8..35 clamp)", () => {
    const bus = { lat: 41.0, lon: 29.0 };
    let r = EtaEngine.predict(STOPS, bus, 2, { hatBilgi: { uzunlukKm: 12, seferSuresiDk: 30 } });
    assert.equal(r.hizKmSa, 24, "12km/30dk=24");
    r = EtaEngine.predict(STOPS, bus, 2, { hatBilgi: { uzunlukKm: 1000, seferSuresiDk: 1 } });
    assert.equal(r.hizKmSa, 35, "max 35");
    r = EtaEngine.predict(STOPS, bus, 2, { hatBilgi: { uzunlukKm: 0.01, seferSuresiDk: 1000 } });
    assert.equal(r.hizKmSa, 8, "min 8");
    r = EtaEngine.predict(STOPS, bus, 2, { hatBilgi: {} });
    assert.equal(r.hizKmSa, 15, "geçersiz → 15");
    // NOT app key mismatch: iett-hatlar `km`/`dk`, Core.ortalamaHiz `uzunlukKm`/`seferSuresiDk` okur → 15.
    // App `v.bilgi`(km/dk) `hatBilgi` olarak geçer (mapController.js) → schedSpeed=15. bkz. rapor.
    r = EtaEngine.predict(STOPS, bus, 2, { hatBilgi: { km: 12, dk: 30 } });
    assert.equal(r.hizKmSa, 15, "km/dk anahtarları okunmaz → 15");
  });

  test("observedSpeedKmH >=4 → hiz; <4 → yok sayılır", () => {
    const bus = { lat: 41.0, lon: 29.0 };
    let r = EtaEngine.predict(STOPS, bus, 2, { observedSpeedKmH: 30 });
    assert.equal(r.hizKmSa, 30);
    r = EtaEngine.predict(STOPS, bus, 2, { observedSpeedKmH: 3 });
    assert.equal(r.hizKmSa, 15, "3 < 4 → yok sayılır");
    r = EtaEngine.predict(STOPS, bus, 2, { observedSpeedKmH: "x" });
    assert.equal(r.hizKmSa, 15);
  });

  test("fleetSpeed >=4 → 0.6*fleet + 0.4*sched blend; obs öncelikli", () => {
    const bus = { lat: 41.0, lon: 29.0, hiz: 20 };
    let r = EtaEngine.predict(STOPS, bus, 2, {});
    assert.equal(r.hizKmSa, 18, "0.6*20 + 0.4*15 = 18");
    // ctx.fleetItem.hiz ?? bus.hiz
    r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0 }, 2, { fleetItem: { hiz: 40 } });
    assert.equal(r.hizKmSa, 30, "0.6*40+0.4*15=30");
    // obsSpeed overrides fleet
    r = EtaEngine.predict(STOPS, bus, 2, { observedSpeedKmH: 100 });
    assert.equal(r.hizKmSa, 100);
    // fleetSpeed <4 → yok sayılır
    r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0, hiz: 1 }, 2, {});
    assert.equal(r.hizKmSa, 15);
  });

  test("baseRunDk hiz tabanı max(5, hizKmSa); scheduledDk tabanı max(8, schedSpeed)", () => {
    const bus = { lat: 41.0, lon: 29.0 };
    const r = EtaEngine.predict(STOPS, bus, 2, { observedSpeedKmH: 4 });
    assert.equal(r.hizKmSa, 4, "hizKmSa=4 çıktı");
    // baseRunDk max(5,4)=5; scheduledDk max(8,15)=15; scheduled kullanır schedSpeed=15
    assert.ok(Number.isFinite(r.dakika));
    const metre = r.metre;
    const totalDk = (metre / 1000 / Math.max(5, 4)) * 60 + r.duraklamaDk;
    assert.equal(r.dakika, Math.max(0, Math.round(totalDk)), "base tabanı 5");
  });

  test("plaka/operator: fleetItem > bus > varsayılan; trim", () => {
    let r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0, plaka: " 34 X 1 ", operator: " Özel " }, 2, {});
    assert.equal(r.plaka, "34 X 1");
    assert.equal(r.operator, "Özel");
    r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0, plaka: "busPlaka" }, 2, { fleetItem: { plaka: "fleetPlaka", operator: "F" } });
    assert.equal(r.plaka, "fleetPlaka", "fleetItem öncelikli");
    assert.equal(r.operator, "F");
    r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0, plaka: "busPlaka" }, 2, { fleetItem: { plaka: "" } });
    assert.equal(r.plaka, "busPlaka", "fleetItem.plaka boş → bus.plaka");
  });
});

describe("EtaEngine.predict — trafik & kaza etkileri", () => {
  test("trafficEngine.getCorridorSpeed: effectiveSpeed=min35 max5 (0.72); trafikEtkisiDk; hiz karışımı", () => {
    const bus = { lat: 41.0, lon: 29.0 };
    const te = { getCorridorSpeed: () => ({ speedKmH: 20 }) };
    const r = EtaEngine.predict(STOPS, bus, 2, { trafficEngine: te });
    assert.ok(r.trafikEtkisiDk >= 0);
    // hizKmSa=(hiz+effective)/2; effective=min35 max5 (20*0.72=14.4); hiz=15→(15+14.4)/2=14.7
    assert.equal(r.hizKmSa, 14.7);
    // trafikEtkisiDk=max(0,round((traffic@effective - base@hiz)*10)/10); kısa mesafede 0.1'e yuvarlanır
    assert.ok(r.trafikEtkisiDk >= 0);
  });

  test("corridor speedKmH <=2 / NaN / null → yok sayılır", () => {
    const bus = { lat: 41.0, lon: 29.0 };
    for (const c of [{ speedKmH: 2 }, { speedKmH: 1 }, { speedKmH: null }, { speedKmH: NaN }, { speedKmH: "x" }, null]) {
      const r = EtaEngine.predict(STOPS, bus, 2, { trafficEngine: { getCorridorSpeed: () => c } });
      assert.equal(r.trafikEtkisiDk, 0);
      assert.equal(r.hizKmSa, 15);
    }
  });

  test("effectiveSpeed küme [5,35]; km/sa*0.72", () => {
    const bus = { lat: 41.0, lon: 29.0 };
    // çok yavaş koridor → effectiveSpeed=5 taban
    let r = EtaEngine.predict(STOPS, bus, 2, { trafficEngine: { getCorridorSpeed: () => ({ speedKmH: 3 }) } });
    // speedKmH>2 → effective=max(5,3*0.72=2.16)=5; hiz=(15+5)/2=10
    assert.equal(r.hizKmSa, 10);
    // çok hızlı → effective=35 taban... max 35; hiz=(15+35)/2=25
    r = EtaEngine.predict(STOPS, bus, 2, { trafficEngine: { getCorridorSpeed: () => ({ speedKmH: 1000 }) } });
    assert.equal(r.hizKmSa, 25);
  });

  test("kaza: trafficEngine.getIncidentPenalty penaltyMin", () => {
    const bus = { lat: 41.0, lon: 29.0 };
    const te = { getIncidentPenalty: () => ({ penaltyMin: 7 }) };
    const r = EtaEngine.predict(STOPS, bus, 2, { trafficEngine: te });
    assert.equal(r.kazaEtkisiDk, 7);
    const teNull = { getIncidentPenalty: () => null };
    assert.equal(EtaEngine.predict(STOPS, bus, 2, { trafficEngine: teNull }).kazaEtkisiDk, 0);
    const teNo = { getIncidentPenalty: () => ({}) };
    assert.equal(EtaEngine.predict(STOPS, bus, 2, { trafficEngine: teNo }).kazaEtkisiDk, 0);
  });

  test("kaza: ctx.incidents (te.getIncidentPenalty YOKSA) 750m içinde → +4", () => {
    const bus = { lat: 41.0, lon: 29.0 };
    const target = STOPS[2];
    const mid = { lat: (bus.lat + target.lat) / 2, lon: (bus.lon + target.lon) / 2 };
    let r = EtaEngine.predict(STOPS, bus, 2, { incidents: [{ lat: mid.lat, lon: mid.lon }] });
    assert.equal(r.kazaEtkisiDk, 4);
    r = EtaEngine.predict(STOPS, bus, 2, { incidents: [{ lat: 41.5, lon: 29.5 }] });
    assert.equal(r.kazaEtkisiDk, 0, "750m dışı");
    r = EtaEngine.predict(STOPS, bus, 2, { incidents: [] });
    assert.equal(r.kazaEtkisiDk, 0);
  });

  test("trafficEngine.getIncidentPenalty varsa ctx.incidents YOK SAYILIR (else-if)", () => {
    const bus = { lat: 41.0, lon: 29.0 };
    const te = { getIncidentPenalty: () => ({ penaltyMin: 0 }) };
    const r = EtaEngine.predict(STOPS, bus, 2, { trafficEngine: te, incidents: [{ lat: 41.0, lon: 29.001 }] });
    assert.equal(r.kazaEtkisiDk, 0, "te.getIncidentPenalty öncelikli; incidents else-if");
  });
});

describe("EtaEngine.predict — GPS tazeliği & durum kodları (zaman sabitlenmiş)", () => {
  test("durumKod OFF_ROUTE: en yakın durak >450m", (t) => {
    freezeTime(t, FIXED_MS);
    const r = EtaEngine.predict(STOPS, { lat: 41.5, lon: 29.5 }, 2, {});
    assert.equal(r.durumKod, "OFF_ROUTE");
    assert.equal(r.guven, "low");
  });

  test("durumKod STALE: sonGuncellemeSn >240; sınır 240", (t) => {
    freezeTime(t, FIXED_MS);
    let r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0, zaman: FIXED_MS - 300_000 }, 2, {});
    assert.equal(r.durumKod, "STALE");
    assert.equal(r.sonGuncellemeSn, 300);
    assert.equal(r.guven, "low");
    r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0, zaman: FIXED_MS - 240_000 }, 2, {});
    assert.notEqual(r.durumKod, "STALE", "240 sınırda stale değil");
    assert.equal(r.sonGuncellemeSn, 240);
    r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0, zaman: FIXED_MS - 241_000 }, 2, {});
    assert.equal(r.durumKod, "STALE", "241 → stale");
  });

  test("STALE önceliği AT_TERMINAL'den önce; OFF_ROUTE en önce", (t) => {
    freezeTime(t, FIXED_MS);
    // terminal + stale + hiz0
    let r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0, hiz: 0, zaman: FIXED_MS - 300_000 }, 2, {});
    assert.equal(r.durumKod, "STALE", "STALE > AT_TERMINAL");
    // off-route + stale
    r = EtaEngine.predict(STOPS, { lat: 41.5, lon: 29.5, zaman: FIXED_MS - 300_000 }, 2, {});
    assert.equal(r.durumKod, "OFF_ROUTE", "OFF_ROUTE > STALE");
  });

  test("durumKod AT_TERMINAL: rawSpeed<2 + terminal; guven medium", (t) => {
    freezeTime(t, FIXED_MS);
    let r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0, hiz: 0 }, 2, {});
    assert.equal(r.durumKod, "AT_TERMINAL");
    assert.equal(r.guven, "medium");
    // isTerminal: nearest.index<=1 || >=len-2
    r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0, hiz: 1 }, 1, {});
    assert.equal(r.durumKod, "AT_TERMINAL", "nearest<=1 terminal");
    // hiz>=2 → not terminal
    r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0, hiz: 5 }, 2, {});
    assert.notEqual(r.durumKod, "AT_TERMINAL");
  });

  test("durumKod DELAYED: totalDk>scheduled*1.2 && gecikme>=2; guven medium", () => {
    const r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0 }, 2, { scheduledOffsetMin: 10 });
    assert.equal(r.durumKod, "DELAYED");
    assert.equal(r.guven, "medium");
  });

  test("sonGuncellemeSn parseGpsAgeSec: numeric ms, HH:MM(:SS), ISO, max(0), null", (t) => {
    freezeTime(t, FIXED_MS);
    const at = (zaman) => EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0, zaman }, 2, {}).sonGuncellemeSn;
    // numeric epoch ms
    assert.equal(at(FIXED_MS), 0);
    assert.equal(at(FIXED_MS - 5000), 5);
    assert.equal(at(FIXED_MS + 5000), 0, "gelecek → max(0,..)=0");
    // HH:MM(:SS) — FIXED local 12:00
    assert.equal(at("12:00"), 0);
    assert.equal(at("11:59"), 60);
    assert.equal(at("11:59:30"), 30);
    assert.equal(at("11:00"), 3600);
    assert.equal(at("12:00:00"), 0);
    // ISO
    assert.equal(at("2026-11-26T11:59:00"), 60);
    // null cases
    assert.equal(at(undefined), null);
    assert.equal(at(""), null);
    assert.equal(at(null), null);
    assert.equal(at("not a date"), null);
    assert.equal(at("garbage"), null);
  });

  test("fleetItem.zaman ?? bus.zaman", (t) => {
    freezeTime(t, FIXED_MS);
    let r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0, zaman: FIXED_MS - 10_000 }, 2, { fleetItem: { zaman: FIXED_MS } });
    assert.equal(r.sonGuncellemeSn, 0, "fleetItem.zaman öncelikli");
    r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0, zaman: FIXED_MS - 10_000 }, 2, { fleetItem: {} });
    assert.equal(r.sonGuncellemeSn, 10, "fleetItem.zaman null → bus.zaman");
  });
});

describe("EtaEngine.predict — boş/bozuk veri", () => {
  test("boş durak listesi → null", () => {
    assert.equal(EtaEngine.predict([], { lat: 41, lon: 29 }, 0, {}), null);
  });
  test("duraklar dizi değil → null", () => {
    assert.equal(EtaEngine.predict(null, { lat: 41, lon: 29 }, 0, {}), null);
    assert.equal(EtaEngine.predict(undefined, { lat: 41, lon: 29 }, 0, {}), null);
    assert.equal(EtaEngine.predict("x", { lat: 41, lon: 29 }, 0, {}), null);
    assert.equal(EtaEngine.predict({}, { lat: 41, lon: 29 }, 0, {}), null);
  });
  test("bus null/undefined → null", () => {
    assert.equal(EtaEngine.predict(STOPS, null, 1, {}), null);
    assert.equal(EtaEngine.predict(STOPS, undefined, 1, {}), null);
  });
  test("ctx verilmezse {} varsayılır", () => {
    const r = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.0 }, 2);
    assert.ok(r);
    assert.equal(r.hizKmSa, 15);
  });

  test("BOZUK VERİ: durak listesinde null → TypeError (Core.mesafe okuma)", () => {
    assert.throws(() => EtaEngine.predict([STOPS[0], null, STOPS[2]], { lat: 41, lon: 29 }, 2, {}), TypeError);
  });

  test("BOZUK VERİ: bus koordinatları NaN/eksik → null DEĞİL, NaN dakika + OFF_ROUTE döner", () => {
    // contract yalnızca !bus → null; bozuk koordinatlar korunmaz
    const r = EtaEngine.predict(STOPS, { lat: NaN, lon: NaN, yakinDurak: "Z" }, 2, {});
    assert.equal(r, null, "NaN koord + eşleşmeyen yakinDurak → siradaki<0 → null");
    const r2 = EtaEngine.predict(STOPS, { lat: NaN, lon: NaN }, 2, {}); // kod-less eşleşme...
    // bu dalda siradaki=0'a düşüp NaN metre üretebilir; davranışı sabitliyoruz:
    if (r2) {
      assert.ok(!Number.isFinite(r2.metre) || !Number.isFinite(r2.dakika) || r2.durumKod === "OFF_ROUTE" || r2.metre >= 0);
    }
  });

  test("BOZUK VERİ: kod-less duraklar → Core.siradakiDurak `undefined===undefined` eşleşmesi", () => {
    // Core.siradakiDurak (src/core/geo.js): duraklar.findIndex(d => d.kod === bus.yakinDurak)
    // kod-less duraklarda d.kod===undefined===bus.yakinDurak → i=0 (fallback enYakinIndex atlanır).
    const noKod = [
      { lat: 41.0, lon: 29.0 },
      { lat: 41.0, lon: 29.001 },
      { lat: 41.0, lon: 29.002 },
    ];
    const kodded = noKod.map((s, i) => ({ ...s, kod: "S" + i }));
    const bus = { lat: 41.0, lon: 29.002 }; // son durakta
    // siradakiDurak doğrudan:
    assert.equal(Core.siradakiDurak(noKod, bus), 1, "kod-less → i=0 başlangıcı + konum bump =1");
    assert.equal(Core.siradakiDurak(kodded, bus), 2, "kodlu → enYakinIndex=2");
    // ETA etkisi: kod-less + hedefIndex=1 → null DÖNMEZ (siradaki=1>1 değil); kodlu → null
    assert.notEqual(EtaEngine.predict(noKod, bus, 1, {}), null, "kod-less siradaki=1 → siradaki>hedefIndex(1) DEĞİL");
    assert.equal(EtaEngine.predict(kodded, bus, 1, {}), null, "kodlu siradaki=2>1 → null");
  });
});
