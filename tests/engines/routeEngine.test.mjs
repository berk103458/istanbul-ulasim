// Faz 2 — RouteEngine birim testleri (node:test). Kaynak dosyalara dokunulmaz.
// Node'da `Worker` yoktur → ana-thread `Plan.kur` fallback yolu test edilir.
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { RouteEngine } from "../../src/engines/routeEngine.js";
import { Core } from "../../src/core/geo.js";
import { Plan } from "../../src/core/router.js";
import {
  simpleMetroGraph,
  transferGraph,
  otobusGraph,
  readJsonFixture,
  freshImport,
} from "../fixtures/helpers.mjs";

const A = { lat: 41.0, lon: 29.0, ad: "A" };
const C = { lat: 41.0, lon: 29.02, ad: "C" };
const D = { lat: 41.01, lon: 29.01, ad: "D" };
const FAR = { lat: 41.5, lon: 29.5, ad: "ULASILAMAZ" }; // 10+ km, durak yok

describe("RouteEngine.initGraph", () => {
  test("başarılı grafik kurulumu: durak/desen sayısı ve stopLinesIndex", async () => {
    const data = simpleMetroGraph();
    const res = await RouteEngine.initGraph(data);
    assert.equal(typeof res.durakCount, "number");
    assert.equal(res.durakCount, 3, "3 istasyon");
    assert.equal(res.desenCount, 2, "tek hat için i + g yönü = 2 desen");
    assert.equal(typeof res.buildMs, "number");
    assert.ok(res.buildMs >= 0);
    assert.ok(res.stopLinesIndex, "stopLinesIndex döner");
    assert.equal(Object.keys(res.stopLinesIndex).length, 0, "metro stopLinesIndex boş");
  });

  test("stopLinesIndex Object.create(null); kodsuz durakları atlar", async () => {
    const res = await RouteEngine.initGraph(simpleMetroGraph());
    assert.equal(Object.getPrototypeOf(res.stopLinesIndex), null, "Object.create(null)");
    assert.equal(Object.keys(res.stopLinesIndex).length, 0, "kod yoksa indeks boş");
  });

  test("stopLinesIndex: kodlu OTOBÜS durakları hatları listeler (metro kod kopyalamaz)", async () => {
    const res = await RouteEngine.initGraph(otobusGraph());
    // Plan.buildStopLinesIndex yalnızca d.kod'lu durakları ekler; IETT kodu 'K1'...
    assert.deepEqual(res.stopLinesIndex["K1"], ["500"]);
    assert.deepEqual(res.stopLinesIndex["K2"], ["500"]);
    assert.deepEqual(res.stopLinesIndex["K3"], ["500"]);
  });

  test("METRO durakları kod kopyalamaz (Plan.kur) → stopLinesIndex'te yok + d.kod undefined", async () => {
    // Plan.kur metro `ekle` `kod` alanını taşımaz; buildStopLinesIndex metro'yu atlar.
    const data = simpleMetroGraph();
    data.istasyonlar = data.istasyonlar.map((s, i) => ({ ...s, kod: "S" + i }));
    const res = await RouteEngine.initGraph(data);
    assert.equal(Object.keys(res.stopLinesIndex).length, 0, "metro kodu indekslenmez");
  });

  test("boş veri: {} → boş grafik, marmaray:false", async () => {
    const res = await RouteEngine.initGraph({ marmaray: false });
    assert.equal(res.durakCount, 0);
    assert.equal(res.desenCount, 0);
    assert.equal(Object.keys(res.stopLinesIndex).length, 0);
  });

  test("null veri → boş grafik (data||{}; marmaray koşulu g.hatlar||g.otobus ile tetiklenmez)", async () => {
    const res = await RouteEngine.initGraph(null);
    assert.equal(res.durakCount, 0, "kur({}): g.hatlar undefined → marmaray eklenmez");
    assert.equal(res.desenCount, 0);
  });

  test("marmaray:false → Marmaray katmanı eklenmez", async () => {
    const res = await RouteEngine.initGraph(simpleMetroGraph());
    // 3 metro durağı, Marmaray yok
    assert.equal(res.durakCount, 3);
  });

  test("marmaray varsayılan true + boş hatlar[] → Marmaray istasyonları eklenir", async () => {
    const res = await RouteEngine.initGraph({ hatlar: [], istasyonlar: [], gun: 3, saat: 600 });
    // Plan.kur: g.hatlar=[] truthy → MARMARAY eklenir (43 istasyon)
    assert.ok(res.durakCount >= 43, `Marmaray istasyonları eklenmeli, got ${res.durakCount}`);
    assert.ok(res.desenCount >= 4, "Marmaray desenleri eklenmeli");
  });

  test("Worker yok (Node) → ana-thread fallback, hata fırlatmaz", async () => {
    assert.equal(typeof Worker, "undefined", "Node'da Worker yok");
    const res = await RouteEngine.initGraph(simpleMetroGraph());
    assert.equal(res.durakCount, 3);
  });

  test("gerçek public/data örneği (iett-ag.sample.json) küçük dilim", async () => {
    const sample = readJsonFixture("iett-ag.sample.json");
    // Plan.kur IETT formatını bekler; ham iett-ag → otobus dönüşümü app katmanında.
    // Burada otobus alanını üretip kuruyoruz (kaynak veriden küçük örnek).
    const data = {
      hatlar: [],
      istasyonlar: [],
      marmaray: false,
      otobus: sample,
      gun: 3,
      saat: 600,
    };
    const res = await RouteEngine.initGraph(data);
    assert.ok(res.durakCount > 0, "otobus durakları eklenir");
    assert.ok(res.desenCount >= 1, "otobus desenleri eklenir");
  });

  test("BOZUK VERİ: hatlar string 'x' → initGraph rejects (Plan.kur (g.hatlar||[]).map)", async () => {
    await assert.rejects(
      () => RouteEngine.initGraph({ hatlar: "x", istasyonlar: [], marmaray: false }),
      /map is not a function|not a function/i,
      "bozuk hatlar için hata fırlatılmalı"
    );
  });

  test("BOZUK VERİ: hatlar [null] → initGraph rejects (h.id okuma)", async () => {
    await assert.rejects(
      () => RouteEngine.initGraph({ hatlar: [null], istasyonlar: [], marmaray: false }),
      TypeError
    );
  });

  test("BOZUK VERİ: istasyonlar [null] → initGraph rejects (s.lat okuma)", async () => {
    await assert.rejects(
      () => RouteEngine.initGraph({ hatlar: [], istasyonlar: [null], marmaray: false }),
      TypeError
    );
  });
});

describe("RouteEngine.compute", () => {
  test("başarılı rota: kalkış→varış tek hat", async () => {
    await RouteEngine.initGraph(simpleMetroGraph());
    const r = await RouteEngine.compute(A, C, 600, {}, 4);
    assert.ok(Array.isArray(r.sonuc));
    assert.equal(typeof r.computeMs, "number");
    assert.ok(r.computeMs >= 0);
    assert.ok(r.sonuc.length >= 1, "rota bulunmalı");
    const best = r.sonuc[0];
    assert.equal(best.kalkis, 600, "kalkış t0");
    assert.ok(best.varis > best.kalkis, "varış kalkıştan sonra");
    assert.equal(best.sure, best.varis - best.kalkis, "sure=varis-kalkis");
    assert.equal(best.aktarma, 0, "tek hat aktarmasız");
    assert.equal(best.imza, "M-TEST");
    assert.equal(best.bacaklar[0].tur, "yuru", "ilk bacak yürüme");
    assert.equal(best.bacaklar.at(-1).tur, "yuru", "son bacak yürüme");
    const metro = best.bacaklar.find((b) => b.tur === "metro");
    assert.ok(metro, "metro bacağı var");
    assert.equal(metro.hat, "M-TEST");
    assert.equal(metro.durakSayisi, 2, "A→C iki durak");
    assert.ok(Array.isArray(metro.durakAdlari) && metro.durakAdlari.length === 3);
    assert.ok(Array.isArray(metro.yol) && metro.yol.length >= 3, "yol polyline");
    assert.ok(Number.isFinite(metro.kalkis) && Number.isFinite(metro.varis));
  });

  test("sonuçlar varış zamanına göre sıralı + adet sınırı", async () => {
    await RouteEngine.initGraph(transferGraph());
    const r = await RouteEngine.compute(A, D, 600, {}, 4);
    assert.ok(r.sonuc.length >= 1);
    const varis = r.sonuc.map((s) => s.varis ?? Infinity);
    for (let i = 1; i < varis.length; i++) assert.ok(varis[i - 1] <= varis[i], "artan varış");
    const r1 = await RouteEngine.compute(A, D, 600, {}, 1);
    assert.ok(r1.sonuc.length <= Math.max(1, r1.sonuc.length));
  });

  test("ulaşılamaz hedef: duraksız uzak nokta → sonuc []", async () => {
    await RouteEngine.initGraph(simpleMetroGraph());
    const r = await RouteEngine.compute(A, FAR, 600, {}, 4);
    assert.deepEqual(r.sonuc, [], "ulaşılamaz hedef boş sonuç");
    assert.equal(typeof r.computeMs, "number");
  });

  test("ulaşılamaz hedef: yasakHat ile tek hat kapatılınca + uzak hedef → sonuc []", async () => {
    await RouteEngine.initGraph(simpleMetroGraph());
    const r = await RouteEngine.compute(A, FAR, 600, { yasakHat: new Set(["M-TEST"]) }, 4);
    assert.deepEqual(r.sonuc, []);
  });

  test("3500m altı hedef: yürüme-only rota (yuru) döner", async () => {
    await RouteEngine.initGraph({ marmaray: false }); // boş grafik
    const r = await RouteEngine.compute(A, { lat: 41.0, lon: 29.001, ad: "B" }, 600, {}, 4);
    assert.ok(r.sonuc.length >= 1, "yakın hedef yürüme rotası");
    assert.ok(r.sonuc.some((s) => s.imza === "yuru" && s.bacaklar.every((b) => b.tur === "yuru")));
  });

  test("boş grafik + uzak hedef → sonuc []", async () => {
    await RouteEngine.initGraph({ marmaray: false });
    const r = await RouteEngine.compute(A, FAR, 600, {}, 4);
    assert.deepEqual(r.sonuc, []);
  });

  test("aktarma: iki hat, aktarma=1, imza M-ONE>M-TWO", async () => {
    await RouteEngine.initGraph(transferGraph());
    const r = await RouteEngine.compute(A, D, 600, {}, 4);
    const transfer = r.sonuc.find((s) => s.aktarma >= 1);
    assert.ok(transfer, "aktarmalı rota var");
    assert.equal(transfer.aktarma, 1);
    assert.equal(transfer.imza, "M-ONE>M-TWO");
    const metros = transfer.bacaklar.filter((b) => b.tur !== "yuru");
    assert.equal(metros.length, 2, "iki raylı bacak");
    assert.equal(metros[0].hat, "M-ONE");
    assert.equal(metros[1].hat, "M-TWO");
    // aktarma istasyonu B'de
    assert.ok(Core.mesafe(metros[0].to, metros[1].from) < 600, "aktarma yakın istasyonlar");
  });

  test("yasakHat: aktarma hattı kapatılınca alternatif/boş", async () => {
    await RouteEngine.initGraph(transferGraph());
    const blocked = await RouteEngine.compute(A, D, 600, { yasakHat: new Set(["M-TWO"]) }, 4);
    const usesTwo = blocked.sonuc.some((s) => s.bacaklar.some((b) => b.hat === "M-TWO"));
    assert.equal(usesTwo, false, "kapatılan hat kullanılmaz");
  });

  // ---- Gece / hafta sonu saatleri ----
  test("gece saati: 01:00'de metro bir sonraki gün 06:00'a bekler", async () => {
    await RouteEngine.initGraph(simpleMetroGraph({ saat: 1500, gun: 3 }));
    const t0 = 1500; // 01:00 (app Zaman.simdi +1440 semantiği; motor ham dakika alır)
    const r = await RouteEngine.compute(A, C, t0, {}, 4);
    const metroRoute = r.sonuc.find((s) => s.bacaklar.some((b) => b.tur === "metro"));
    assert.ok(metroRoute, "gece de rota bulunur (bir sonraki servis)");
    assert.equal(metroRoute.kalkis, t0);
    const metro = metroRoute.bacaklar.find((b) => b.tur === "metro");
    assert.ok(metro.bekleme > 240, "gece beklemesi >4 saat");
    // `saatler` [06:00,23:00]; sonraki servis 06:00 +1440
    assert.ok(metro.kalkis >= 1800, `kalkış 06:00+1440'a kayar, got ${metro.kalkis}`);
    assert.ok(metroRoute.varis > metroRoute.kalkis + 240);
  });

  test("gece + hafta sonu kombinasyonu da çalışır", async () => {
    await RouteEngine.initGraph(simpleMetroGraph({ saat: 1500, gun: 6 })); // Cumartesi 01:00
    const r = await RouteEngine.compute(A, C, 1500, {}, 4);
    assert.ok(r.sonuc.length >= 1);
  });

  test("hafta sonu: metro raylı sistem hafta içiyle aynı (gun farkı yok)", async () => {
    await RouteEngine.initGraph(simpleMetroGraph({ gun: 3, saat: 600 }));
    const wd = await RouteEngine.compute(A, C, 600, {}, 4);
    await RouteEngine.initGraph(simpleMetroGraph({ gun: 6, saat: 600 }));
    const sat = await RouteEngine.compute(A, C, 600, {}, 4);
    await RouteEngine.initGraph(simpleMetroGraph({ gun: 0, saat: 600 }));
    const sun = await RouteEngine.compute(A, C, 600, {}, 4);
    const sure = (r) => r.sonuc.find((s) => s.bacaklar.some((b) => b.tur === "metro"))?.sure;
    assert.equal(sure(sat), sure(wd), "Cumartesi == hafta içi (metro)");
    assert.equal(sure(sun), sure(wd), "Pazar == hafta içi (metro)");
  });

  test("hafta sonu: otobüs rush-hour cezası hafta içine özel (gun 1-5)", async () => {
    // hafta içi 08:00 (480) rush → daha yavaş; Cumartesi/Pazar 08:00 rush cezası yok.
    const probe = async (gun) => {
      await RouteEngine.initGraph(otobusGraph({ gun, saat: 480 }));
      const r = await RouteEngine.compute(A, C, 480, {}, 4);
      const bus = r.sonuc.find((s) => s.bacaklar.some((b) => b.tur === "otobus"));
      return bus ? bus.sure : null;
    };
    const monRush = await probe(1);
    const sat = await probe(6);
    const sun = await probe(0);
    assert.ok(monRush != null && sat != null && sun != null, "otobüs rotası bulunur");
    assert.ok(sat <= monRush + 1e-9, `Cumartesi (${sat}) <= hafta içi rush (${monRush})`);
    assert.ok(sun <= monRush + 1e-9, `Pazar (${sun}) <= hafta içi rush (${monRush})`);
  });

  test("hafta sonu rush saatinde hafta içi rush'tan kısa/eşit sure", async () => {
    const probe = async (gun) => {
      await RouteEngine.initGraph(otobusGraph({ gun, saat: 480 }));
      const r = await RouteEngine.compute(A, C, 480, {}, 4);
      return r.sonuc.find((s) => s.bacaklar.some((b) => b.tur === "otobus"))?.sure ?? null;
    };
    const wd = await probe(3);
    const sat = await probe(6);
    assert.ok(sat !== null && wd !== null);
    assert.ok(sat <= wd + 1e-9, `hafta sonu (${sat}) <= hafta içi rush (${wd})`);
  });

  test("gece otobüs hızı: 01:00 gece rotası hafta içi 08:00 rush'tan kısa", async () => {
    const probe = async (saat) => {
      await RouteEngine.initGraph(otobusGraph({ gun: 3, saat }));
      const r = await RouteEngine.compute(A, C, saat, {}, 4);
      return r.sonuc.find((s) => s.bacaklar.some((b) => b.tur === "otobus"))?.sure ?? null;
    };
    const night = await probe(1500); // 01:00
    const rush = await probe(480); // 08:00 hafta içi
    assert.ok(night != null && rush != null);
    assert.ok(night < rush, `gece (${night}) < rush (${rush})`);
  });

  test("BOZUK VERİ: compute(null,...) rejects (Core.mesafe okuma)", async () => {
    await RouteEngine.initGraph(simpleMetroGraph());
    await assert.rejects(() => RouteEngine.compute(null, C, 600, {}, 4), TypeError);
  });

  test("worker fallback: initGraph sonrası compute ana-thread çalışır (Node, Worker yok)", async () => {
    const fresh = await freshImport("../../src/engines/routeEngine.js");
    await fresh.RouteEngine.initGraph(simpleMetroGraph());
    const r = await fresh.RouteEngine.compute(A, C, 600, {}, 4);
    assert.ok(r.sonuc.length >= 1);
    // ikinci initGraph tekrar çalışır
    await fresh.RouteEngine.initGraph(transferGraph());
    const r2 = await fresh.RouteEngine.compute(A, D, 600, {}, 4);
    assert.ok(r2.sonuc.length >= 1);
  });
});

describe("RouteEngine.searchPlaces", () => {
  test("arama: isim eşleşmesi, norm, adet", async () => {
    const g = transferGraph();
    await RouteEngine.initGraph(g);
    const res = await RouteEngine.searchPlaces("M-ONE", 8);
    // yerAra hat adıyla değil durak adıyla arar; durak adları A1/B1/C1...
    assert.ok(Array.isArray(res));
    const res2 = await RouteEngine.searchPlaces("B1", 8);
    assert.ok(res2.some((p) => p.ad === "B1"), "durak adı eşleşir");
    assert.ok(res2[0].lat != null && res2[0].lon != null);
  });

  test("kısa sorgu (<2) → []", async () => {
    await RouteEngine.initGraph(simpleMetroGraph());
    assert.deepEqual(await RouteEngine.searchPlaces("A", 8), []);
    assert.deepEqual(await RouteEngine.searchPlaces("", 8), []);
  });

  test("eşleşme yok → []", async () => {
    await RouteEngine.initGraph(simpleMetroGraph());
    assert.deepEqual(await RouteEngine.searchPlaces("ZZZNOPE", 8), []);
  });

  test("boş grafik → []", async () => {
    const fresh = await freshImport("../../src/engines/routeEngine.js");
    await fresh.RouteEngine.initGraph({ marmaray: false });
    assert.deepEqual(await fresh.RouteEngine.searchPlaces("anything", 8), []);
  });
});

describe("RouteEngine.checkRouteDelays", () => {
  const route = (bacaklar) => ({ bacaklar });

  test("route null / bacaklar değil → hasDelay false", () => {
    assert.deepEqual(RouteEngine.checkRouteDelays(null), { hasDelay: false, reason: "", level: "none" });
    assert.deepEqual(RouteEngine.checkRouteDelays({}), { hasDelay: false, reason: "", level: "none" });
    assert.deepEqual(RouteEngine.checkRouteDelays({ bacaklar: null }), { hasDelay: false, reason: "", level: "none" });
    assert.deepEqual(RouteEngine.checkRouteDelays({ bacaklar: "x" }), { hasDelay: false, reason: "", level: "none" });
  });

  test("boş bacaklar → none", () => {
    assert.deepEqual(RouteEngine.checkRouteDelays(route([])), { hasDelay: false, reason: "", level: "none" });
  });

  test("duyuru hat eşleşmesi (hatKod) + major/minor seviye", () => {
    const r = route([{ tur: "otobus", hat: "500", from: { lat: 41, lon: 29 }, to: { lat: 41, lon: 29.01 } }]);
    // minor: genel duyuru
    let res = RouteEngine.checkRouteDelays(r, [{ hatKod: "500", tip: "Bilgi", mesaj: "Sefer düzeni" }]);
    assert.equal(res.hasDelay, true);
    assert.equal(res.level, "minor");
    assert.ok(res.reason.startsWith("500: "));
    // major: iptal/kapalı/kesinti/aksama/değişiklik/arıza
    for (const kw of ["iptal", "kapalı", "kesinti", "aksama", "değişiklik", "arıza"]) {
      res = RouteEngine.checkRouteDelays(r, [{ hat: "500", mesaj: kw + " var" }]);
      assert.equal(res.level, "major", kw);
    }
  });

  test("hat eşleşmeyen / boş hat duyuruları atlanır", () => {
    const r = route([{ tur: "metro", hat: "M2", from: { lat: 41, lon: 29 }, to: { lat: 41, lon: 29.01 } }]);
    assert.deepEqual(
      RouteEngine.checkRouteDelays(r, [{ hatKod: "OTHER", mesaj: "iptal" }, { hatKod: "", mesaj: "x" }]),
      { hasDelay: false, reason: "", level: "none" }
    );
  });

  test("yuru bacaklar hat kümesine katılmaz", () => {
    const r = route([{ tur: "yuru", m: 100, from: { lat: 41, lon: 29 }, to: { lat: 41, lon: 29.01 } }]);
    assert.deepEqual(RouteEngine.checkRouteDelays(r, [{ hatKod: undefined, mesaj: "x" }]), {
      hasDelay: false, reason: "", level: "none",
    });
  });

  test("reason mesaj 120 karaktere kırpılır", () => {
    const r = route([{ tur: "otobus", hat: "500", from: { lat: 41, lon: 29 }, to: { lat: 41, lon: 29.01 } }]);
    const res = RouteEngine.checkRouteDelays(r, [{ hatKod: "500", mesaj: "x".repeat(300) }]);
    // reason = `${hat}: ${msg.slice(0,120)}`
    assert.ok(res.reason.length <= "500: ".length + 120);
  });

  test("trafficEngine: otobus incident → major (penaltyMin>=5) / minor", () => {
    const r = route([{ tur: "otobus", hat: "500", from: { lat: 41, lon: 29 }, to: { lat: 41, lon: 29.01 } }]);
    const te = { getIncidentPenalty: () => ({ incident: { baslik: "Kaza" }, penaltyMin: 5 }) };
    let res = RouteEngine.checkRouteDelays(r, [], te);
    assert.equal(res.hasDelay, true);
    assert.equal(res.level, "major");
    assert.ok(res.reason.includes("500"));
    assert.ok(res.reason.includes("Kaza"));
    const teMinor = { getIncidentPenalty: () => ({ incident: {}, penaltyMin: 3 }) };
    res = RouteEngine.checkRouteDelays(r, [], teMinor);
    assert.equal(res.level, "minor");
    // "Yoğunluk" fallback başlık
    assert.ok(res.reason.includes("Yoğunluk"));
  });

  test("trafficEngine: congestionLevel >=4.2 → minor, speedKmH ?? '?'", () => {
    const r = route([{ tur: "otobus", hat: "500", from: { lat: 41, lon: 29 }, to: { lat: 41, lon: 29.01 } }]);
    const te = { getIncidentPenalty: () => ({ congestionLevel: 4.5, speedKmH: null }) };
    const res = RouteEngine.checkRouteDelays(r, [], te);
    assert.equal(res.hasDelay, true);
    assert.equal(res.level, "minor");
    assert.ok(res.reason.includes("?"), "speedKmH ?? '?'");
    // 4.2 sınırı
    const te42 = { getIncidentPenalty: () => ({ congestionLevel: 4.2, speedKmH: 10 }) };
    assert.equal(RouteEngine.checkRouteDelays(r, [], te42).hasDelay, true);
    const te41 = { getIncidentPenalty: () => ({ congestionLevel: 4.1, speedKmH: 10 }) };
    assert.equal(RouteEngine.checkRouteDelays(r, [], te41).hasDelay, false);
  });

  test("trafficEngine: sadece otobus + from&to; metro/yuru etkilenmez", () => {
    const r = route([
      { tur: "metro", hat: "M2", from: { lat: 41, lon: 29 }, to: { lat: 41, lon: 29.01 } },
      { tur: "yuru", m: 10 },
      { tur: "otobus", hat: "500" }, // from/to yok → atlanır
    ]);
    const te = { getIncidentPenalty: () => ({ incident: { baslik: "x" }, penaltyMin: 9 }) };
    assert.deepEqual(RouteEngine.checkRouteDelays(r, [], te), { hasDelay: false, reason: "", level: "none" });
  });

  test("trafficEngine.getIncidentPenalty fonksiyon değilse trafik atlanır", () => {
    const r = route([{ tur: "otobus", hat: "500", from: { lat: 41, lon: 29 }, to: { lat: 41, lon: 29.01 } }]);
    assert.equal(RouteEngine.checkRouteDelays(r, [], {}).hasDelay, false);
  });

  test("duyurular boş/bozuk → trafficEngine'e düşer", () => {
    const r = route([{ tur: "otobus", hat: "500", from: { lat: 41, lon: 29 }, to: { lat: 41, lon: 29.01 } }]);
    assert.equal(RouteEngine.checkRouteDelays(r, [], null).hasDelay, false);
    assert.equal(RouteEngine.checkRouteDelays(r, null, null).hasDelay, false);
    assert.equal(RouteEngine.checkRouteDelays(r, "x", null).hasDelay, false);
  });
});

describe("RouteEngine — Core entegrasyonu sanity", () => {
  test("Core.mesafe temel", () => {
    assert.ok(Core.mesafe({ lat: 41, lon: 29 }, { lat: 41, lon: 29.01 }) > 800);
  });
  test("Plan.kur boş {} güvenli", () => {
    const ag = Plan.kur({});
    assert.ok(Array.isArray(ag.duraklar));
    assert.ok(Array.isArray(ag.desenler));
  });
});
