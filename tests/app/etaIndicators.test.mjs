// Faz 6A — ETA güven göstergeleri, GPS yaşı ve görünüm sözleşme testleri (node:test).
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { EtaEngine } from "../../src/engines/etaEngine.js";
import { Core } from "../../src/core/geo.js";
import { getLang, setLang } from "../../src/i18n/index.js";
import {
  STALE_GPS_SEC,
  parseGpsTimestampMs,
  parseGpsAgeSec,
  formatGpsAge,
  describeEtaTrust,
  renderTrustBadgesHTML,
  renderGpsAgeHTML,
  renderEtaPillHTML,
  summarizeVehiclesFreshness,
} from "../../src/ui/etaIndicators.js";
import { FIXED_MS, freezeTime } from "../fixtures/helpers.mjs";

const STOPS = [
  { lat: 41.0, lon: 29.0, ad: "KADIKÖY", kod: "D1" },
  { lat: 41.0, lon: 29.004, ad: "SÖĞÜTLÜÇEŞME", kod: "D2" },
  { lat: 41.0, lon: 29.008, ad: "ACIBADEM", kod: "D3" },
  { lat: 41.0, lon: 29.012, ad: "ALTUNİZADE", kod: "D4" },
];

// Minimal globals so Leaflet-importing view modules can load cleanly in Node tests.
function ensureBrowserStubs() {
  if (typeof globalThis.window === "undefined") {
    globalThis.window = {
      screen: { deviceXDPI: 96, logicalXDPI: 96 },
      devicePixelRatio: 1,
      matchMedia: () => ({ matches: false }),
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }
  if (typeof globalThis.navigator === "undefined") {
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "node-test", platform: "win32", language: "tr-TR", maxTouchPoints: 0 },
      configurable: true,
    });
  }
  if (typeof globalThis.document === "undefined") {
    const fakeEl = () => ({
      style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      setAttribute() {},
      removeAttribute() {},
      hasAttribute: () => true,
      getElementsByTagName: () => [],
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      appendChild() {},
    });
    globalThis.document = {
      documentElement: { style: {}, dataset: {}, lang: "tr" },
      createElement: fakeEl,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      hidden: false,
    };
  }
}

describe("etaIndicators — GPS zamanı & yaş hesaplama", () => {
  test("parseGpsTimestampMs ve parseGpsAgeSec geçerli/eksik girdileri dürüstçe işler", () => {
    const now = Date.parse("2026-11-26T09:00:00Z");
    assert.equal(parseGpsAgeSec(now - 18_000, now), 18);
    assert.equal(parseGpsAgeSec("2026-11-26 11:55:00", now), 300);
    assert.equal(parseGpsAgeSec("11:59:30", now), 30);
    assert.equal(parseGpsAgeSec("23:59:45", Date.parse("2026-11-26T21:00:00Z")), 15);
    assert.equal(parseGpsAgeSec("12:00:01", now), null);
    assert.equal(parseGpsAgeSec("2026-02-30 11:55:00", now), null);
    assert.equal(parseGpsTimestampMs("", now), null);
    assert.equal(parseGpsTimestampMs(null, now), null);
    assert.equal(parseGpsTimestampMs(undefined, now), null);
    assert.equal(parseGpsTimestampMs("bozuk-tarih", now), null);
    assert.equal(parseGpsAgeSec("", now), null);
    assert.equal(parseGpsAgeSec("not-a-time", now), null);
  });

  test("formatGpsAge TR ve EN çevirileriyle saniye, dakika, saat ve eksik durumu biçimlendirir", (t) => {
    const prev = getLang();
    t.after(() => setLang(prev));

    setLang("tr");
    assert.equal(formatGpsAge(15), "15 sn önce");
    assert.equal(formatGpsAge(15, { includePrefix: true }), "GPS 15 sn önce");
    assert.equal(formatGpsAge(360, { includePrefix: true }), "GPS 6 dk önce");
    assert.equal(formatGpsAge(7200), "2 sa önce");
    assert.equal(formatGpsAge(null, { includePrefix: true }), "GPS zamanı yok");

    setLang("en");
    assert.equal(formatGpsAge(15), "15s ago");
    assert.equal(formatGpsAge(360, { includePrefix: true }), "GPS 6m ago");
    assert.equal(formatGpsAge(null, { includePrefix: true }), "No GPS timestamp");
  });

  test("summarizeVehiclesFreshness: canlı, eski, eksik ve boş filo ayrımı", () => {
    const now = FIXED_MS;
    assert.deepEqual(summarizeVehiclesFreshness([], now), { state: "none", freshestSec: null, freshestMs: null });
    assert.deepEqual(
      summarizeVehiclesFreshness([{ zaman: now - 400_000 }, { zaman: now - 20_000 }], now),
      { state: "live", freshestSec: 20, freshestMs: now - 20_000 }
    );
    assert.deepEqual(
      summarizeVehiclesFreshness([{ zaman: now - 400_000 }, { zaman: now - 300_000 }], now),
      { state: "stale", freshestSec: 300, freshestMs: now - 300_000 }
    );
    assert.deepEqual(
      summarizeVehiclesFreshness([{ zaman: "" }, { zaman: null }], now),
      { state: "missing", freshestSec: null, freshestMs: null }
    );
  });
});

describe("describeEtaTrust — taze / eski / tarife / eksik veri sözleşmesi", () => {
  test("taze ON_TIME + high güven: CANLI, yüksek güven, yakın pil", (t) => {
    const prev = getLang();
    t.after(() => setLang(prev));
    setLang("tr");

    const info = describeEtaTrust({
      dakika: 1,
      durumKod: "ON_TIME",
      guven: "high",
      sonGuncellemeSn: 18,
    });
    assert.equal(info.mode, "live");
    assert.equal(info.isLive, true);
    assert.equal(info.isStale, false);
    assert.equal(info.guven, "high");
    assert.equal(info.gpsTier, "fresh");
    assert.equal(info.pillClass, "sure yakin");
    assert.equal(info.pillText, "geliyor");
    assert.equal(info.canSurgicalUpdate, true);

    const badges = renderTrustBadgesHTML(info);
    assert.match(badges, /class="canli"/);
    assert.match(badges, /Yüksek güven/);
    assert.match(renderGpsAgeHTML(info), /GPS 18 sn önce/);
  });

  test("eski sinyal (STALE veya >240sn): CANLI gösterilmez, eski rozet ve düşük güven ayrışır", (t) => {
    const prev = getLang();
    t.after(() => setLang(prev));
    setLang("tr");

    const info = describeEtaTrust({
      dakika: 1,
      durumKod: "STALE",
      guven: "low",
      sonGuncellemeSn: 360,
    });
    assert.equal(info.mode, "stale");
    assert.equal(info.isLive, false);
    assert.equal(info.isStale, true);
    assert.equal(info.guven, "low");
    assert.equal(info.gpsTier, "stale");
    assert.equal(info.pillClass, "sure eski");
    assert.equal(info.pillText, "~1 dk?", "eski sinyalde 'geliyor' kesinliği gösterilmemeli");
    assert.equal(info.canSurgicalUpdate, false);
    assert.match(info.notice, /6 dk önce/);

    const badges = renderTrustBadgesHTML(info);
    assert.doesNotMatch(badges, /class="canli"/);
    assert.match(badges, /Eski Sinyal/);
    assert.match(badges, /Düşük güven/);

    // 240 sınırında stale değil, 241'de stale
    const atBoundary = describeEtaTrust({
      dakika: 4,
      durumKod: "ON_TIME",
      guven: "high",
      sonGuncellemeSn: STALE_GPS_SEC,
    });
    assert.equal(atBoundary.isStale, false);
    const overBoundary = describeEtaTrust({
      dakika: 4,
      durumKod: "ON_TIME",
      guven: "high",
      sonGuncellemeSn: STALE_GPS_SEC + 1,
    });
    assert.equal(overBoundary.isStale, true);
    assert.equal(overBoundary.isLive, false);
  });

  test("OFF_ROUTE ve AT_TERMINAL dürüst durum/güven ayrımı", (t) => {
    const prev = getLang();
    t.after(() => setLang(prev));
    setLang("tr");

    const off = describeEtaTrust({
      dakika: 1,
      durumKod: "OFF_ROUTE",
      guven: "low",
      sonGuncellemeSn: 20,
    });
    assert.equal(off.isLive, false);
    assert.equal(off.isOffRoute, true);
    assert.equal(off.pillClass, "sure eski");
    assert.equal(off.pillText, "~1 dk?");
    assert.match(renderTrustBadgesHTML(off), /Güzergâh Dışı/);
    assert.doesNotMatch(renderTrustBadgesHTML(off), /class="canli"/);

    const term = describeEtaTrust({
      dakika: 1,
      durumKod: "AT_TERMINAL",
      guven: "medium",
      sonGuncellemeSn: 25,
    });
    assert.equal(term.isLive, true);
    assert.equal(term.guven, "medium");
    assert.notEqual(term.pillText, "geliyor", "sefer başında bekleyen araç 'geliyor' olmamalı");
    assert.match(renderTrustBadgesHTML(term), /Sefer Başı/);
    assert.match(renderTrustBadgesHTML(term), /Orta güven/);
  });

  test("tarife tahmini hiçbir zaman canlı gibi sunulmaz", (t) => {
    const prev = getLang();
    t.after(() => setLang(prev));
    setLang("tr");

    const sched = describeEtaTrust({ dakika: 1 }, { scheduled: true, saatStr: "12:01" });
    assert.equal(sched.mode, "schedule");
    assert.equal(sched.isScheduled, true);
    assert.equal(sched.isLive, false);
    assert.equal(sched.pillClass, "sure tarife");
    assert.equal(sched.pillText, "12:01", "tarife 1 dk kalsa bile canlı 'geliyor' yerine saat/tarife etiketi gösterir");
    assert.doesNotMatch(renderTrustBadgesHTML(sched), /class="canli"/);
    assert.match(renderTrustBadgesHTML(sched), /Tarife/);
    assert.equal(renderGpsAgeHTML(sched), "", "tarife satırında sahte GPS yaşı gösterilmez");
  });

  test("eksik GPS zamanı veya Core fallback yanıltıcı yüksek güven / CANLI göstermez", (t) => {
    const prev = getLang();
    t.after(() => setLang(prev));
    setLang("tr");

    // Mevcut EtaEngine zaman eksikliğinde guven='high' dönse bile UI bunu kısıtlı veri olarak gösterir
    const missingTs = describeEtaTrust({
      dakika: 1,
      durumKod: "ON_TIME",
      guven: "high",
      sonGuncellemeSn: null,
    });
    assert.equal(missingTs.isLive, false);
    assert.equal(missingTs.isMissing, true);
    assert.equal(missingTs.guven, "unknown");
    assert.equal(missingTs.pillClass, "sure eksik");
    assert.notEqual(missingTs.pillText, "geliyor");
    assert.doesNotMatch(renderTrustBadgesHTML(missingTs), /class="canli"/);
    assert.doesNotMatch(renderTrustBadgesHTML(missingTs), /Yüksek güven/);
    assert.match(renderTrustBadgesHTML(missingTs), /Kısıtlı veri/);
    assert.match(renderGpsAgeHTML(missingTs), /GPS zamanı yok/);

    // Core.varisTahmini fallback çıktısı (durumKod / guven / sonGuncellemeSn yok)
    const fallback = Core.varisTahmini(STOPS, { lat: 41.0, lon: 29.0 }, 2, 15);
    const fbTrust = describeEtaTrust(fallback);
    assert.equal(fbTrust.isLive, false);
    assert.equal(fbTrust.isMissing, true);
    assert.equal(fbTrust.pillClass, "sure eksik");
    assert.doesNotMatch(renderTrustBadgesHTML(fbTrust), /Yüksek güven/);

    // Tamamen boş ETA
    const empty = describeEtaTrust(null);
    assert.equal(empty.isMissing, true);
    assert.equal(renderEtaPillHTML(empty), '<span class="sure eksik" title="Veri eksik">–</span>');
  });
});

describe("Görünüm entegrasyonu — nearbyView, stopModal ve busView", () => {
  test("nearbyView.otobusSatiriHTML taze, eski, tarife ve eksik veriyi ayrıştırır", async (t) => {
    ensureBrowserStubs();
    freezeTime(t, FIXED_MS);
    const prev = getLang();
    t.after(() => setLang(prev));
    setLang("tr");

    const { otobusSatiriHTML } = await import("../../src/views/nearbyView.js");

    // 1) Taze canlı araç (EtaEngine çıktısıyla)
    const freshBus = { kapino: "C-101", lat: 41.0, lon: 29.0035, hiz: 24, zaman: FIXED_MS - 15_000 };
    const freshEta = EtaEngine.predict(STOPS, freshBus, 3, { hatBilgi: { km: 12, dk: 30 } });
    const freshHtml = otobusSatiriHTML("18K", { bus: freshBus, t: freshEta, gozlenen: true });
    assert.match(freshHtml, /class="canli">CANLI</);
    assert.match(freshHtml, /Yüksek güven/);
    assert.match(freshHtml, /GPS .*15 sn önce/);
    assert.match(freshHtml, /data-live-eta="18K\/C-101"/);
    assert.match(freshHtml, /role="button" tabindex="0" data-odakla="18K\/C-101"/);

    // 2) Eski GPS sinyali (6 dk)
    const staleBus = { kapino: "C-202", lat: 41.0, lon: 29.011, hiz: 20, zaman: FIXED_MS - 360_000 };
    const staleEta = EtaEngine.predict(STOPS, staleBus, 3, {});
    const staleHtml = otobusSatiriHTML("18K", { bus: staleBus, t: staleEta, gozlenen: true });
    assert.match(staleHtml, /eta-eski/);
    assert.match(staleHtml, /Eski Sinyal/);
    assert.match(staleHtml, /Düşük güven/);
    assert.match(staleHtml, /GPS .*6 dk önce/);
    assert.doesNotMatch(staleHtml, /class="canli"/);
    assert.doesNotMatch(staleHtml, /geliyor/);
    assert.doesNotMatch(staleHtml, /data-live-eta=/);

    // 3) Eksik GPS zamanı
    const missingBus = { kapino: "C-303", lat: 41.0, lon: 29.011, zaman: "" };
    const missingEta = EtaEngine.predict(STOPS, missingBus, 3, {});
    const missingHtml = otobusSatiriHTML("18K", { bus: missingBus, t: missingEta, gozlenen: false });
    assert.match(missingHtml, /eta-eksik/);
    assert.match(missingHtml, /Kısıtlı veri/);
    assert.match(missingHtml, /GPS zamanı yok/);
    assert.doesNotMatch(missingHtml, /class="canli"/);
    assert.doesNotMatch(missingHtml, /Eski Sinyal/);
    assert.doesNotMatch(missingHtml, /Yüksek güven/);
    assert.doesNotMatch(missingHtml, /geliyor/);

    // 4) Tarife tahmini
    const schedHtml = otobusSatiriHTML("18K", {
      bus: { kapino: "" },
      t: { dakika: 1, durakSayisi: 0 },
      scheduled: true,
      saatStr: "12:01",
    });
    assert.match(schedHtml, /eta-tarife/);
    assert.match(schedHtml, /Tarife/);
    assert.match(schedHtml, /sure tarife/);
    assert.doesNotMatch(schedHtml, /class="canli"/);
    assert.doesNotMatch(schedHtml, /geliyor/);
    assert.doesNotMatch(schedHtml, /role="button"|tabindex=/);
  });

  test("stopModal.renderStopBoardRowHTML tarife, taze canlı, eski sinyal ve eksik veriyi ayrıştırır", async (t) => {
    ensureBrowserStubs();
    freezeTime(t, FIXED_MS);
    const prev = getLang();
    t.after(() => setLang(prev));
    setLang("tr");

    const { renderStopBoardRowHTML } = await import("../../src/views/stopModal.js");

    // Tarife satırı (1 dk kalsa bile canlı 'geliyor' olmamalı)
    const schedRow = renderStopBoardRowHTML({
      hat: "14BK",
      yon: "Kadıköy",
      kalan: 1,
      saatStr: "12:01",
      canli: false,
      scheduled: true,
      eta: { dakika: 1 },
      renk: "#0f62fe",
    });
    assert.match(schedRow, /Tarife/);
    assert.match(schedRow, /class="sure tarife"/);
    assert.match(schedRow, /role="button" tabindex="0" data-modal-hat="14BK"/);
    assert.match(schedRow, /class="rozet" style="[^"]+;color:/);
    assert.doesNotMatch(schedRow, /class="canli"/);
    assert.doesNotMatch(schedRow, /geliyor/);
    assert.doesNotMatch(schedRow, /GPS/);

    // Taze canlı İETT satırı
    const liveEta = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.004, zaman: FIXED_MS - 25_000 }, 3, {});
    const liveRow = renderStopBoardRowHTML({
      hat: "18K",
      yon: "Altunizade",
      kalan: liveEta.dakika,
      saatStr: "12:04",
      canli: false,
      scheduled: false,
      eta: liveEta,
      busZaman: FIXED_MS - 25_000,
      kapino: "A-045",
      renk: "#e4572e",
    });
    assert.match(liveRow, /class="canli">CANLI</);
    assert.match(liveRow, /Yüksek güven/);
    assert.match(liveRow, /GPS .*25 sn önce/);

    // Eski sinyalli İETT satırı
    const staleEta = EtaEngine.predict(STOPS, { lat: 41.0, lon: 29.011, zaman: FIXED_MS - 420_000 }, 3, {});
    const staleRow = renderStopBoardRowHTML({
      hat: "18K",
      yon: "Altunizade",
      kalan: staleEta.dakika,
      saatStr: "12:01",
      canli: false,
      scheduled: false,
      eta: staleEta,
      busZaman: FIXED_MS - 420_000,
      kapino: "A-099",
      renk: "#e4572e",
    });
    assert.match(staleRow, /eta-eski/);
    assert.match(staleRow, /Eski Sinyal/);
    assert.match(staleRow, /GPS .*7 dk önce/);
    assert.doesNotMatch(staleRow, /class="canli"/);
    assert.doesNotMatch(staleRow, /geliyor/);

    const missingRow = renderStopBoardRowHTML({ hat: "18K", scheduled: false, kalan: null });
    assert.match(missingRow, /eta-eksik/);
    assert.match(missingRow, /GPS zamanı yok/);
    assert.doesNotMatch(missingRow, /Tarife|Eski Sinyal|class="canli"/);
  });

  test("busView.buildBusEtaContext ve renderVehicle EtaEngine parametre/çıktı sözleşmesini eşler", async (t) => {
    ensureBrowserStubs();
    const now = Date.parse("2026-11-26T09:00:00Z");
    freezeTime(t, now);
    const prev = getLang();
    t.after(() => setLang(prev));
    setLang("tr");

    const { buildBusEtaContext, createBusView } = await import("../../src/views/busView.js");

    const vData = {
      renk: "#e4572e",
      mb: false,
      bilgi: { ad: "KADIKÖY - ALTUNİZADE", km: 12, dk: 30, operator: "İETT" },
      duraklar: { G: STOPS },
      otobusler: [],
      seferler: { G: { I: ["12:15", "12:30"] } },
      hiz: 24,
    };

    const freshArac = {
      hat: "18K",
      kapino: "A-101",
      yon: "G",
      gor: { lat: 41.0, lon: 29.004 },
      gercek: { lat: 41.0, lon: 29.004, ms: now - 20_000 },
      hiz: 26,
      b: {
        kapino: "A-101",
        yon: "G",
        lat: 41.0,
        lon: 29.004,
        zaman: "2026-11-26 11:59:40",
        plaka: "34 HO 1800",
        operator: "ÖHO",
      },
    };

    // 1) buildBusEtaContext EtaEngine.predict parametrelerini doğru eşler
    const ctx = buildBusEtaContext(vData, freshArac, [{ lat: 41.0, lon: 29.008 }]);
    assert.equal(ctx.hatBilgi, vData.bilgi);
    assert.equal(ctx.fleetItem, freshArac.b);
    assert.equal(ctx.observedSpeedKmH, 26);
    assert.equal(typeof ctx.trafficEngine?.getCorridorSpeed, "function");
    assert.equal(ctx.incidents.length, 1);

    // Gözlenen hız yoksa observedSpeedKmH undefined olmalı (fleetItem.hiz ezilmez)
    const ctxNoObs = buildBusEtaContext(vData, { ...freshArac, hiz: null }, []);
    assert.equal(ctxNoObs.observedSpeedKmH, undefined);

    // 2) renderVehicle — taze, eski ve eksik GPS senaryoları
    const makeEnv = (arac) => {
      vData.otobusler = [arac.b];
      const S = {
        arac: new Map([["18K/" + arac.kapino, arac]]),
        favoriler: ["18K"],
        hatVeri: { "18K": vData },
        durak: { "18K": "D4" },
      };
      const mc = {
        aktifHatlarAyarla() {},
        hatHazirla: async () => vData,
        konumIsle() {},
        katman: { clearLayers() {} },
        hedefKatmani: { clearLayers() {} },
        guzergahCiz() { return []; },
        aracCiz() {},
        durakIsaretle() {},
        hedefDurak: () => ({ i: 3, d: STOPS[3], secili: true }),
        aracHizi: () => arac.hiz ?? 24,
        aracYeri: () => ({ sonraki: 2, metre: 220, oran: 0.4 }),
        getTrafikIndeks: () => ({ TI: 42 }),
        getTrafikIncidents: () => [],
        getTakipArac: () => null,
        map: { setView() {}, getZoom: () => 15 },
      };
      const callbacks = {
        onYukle() {},
        getCizimNo: () => 1,
        baslikHTML: (title) => `<header>${title}</header>`,
        sayfa: () => ({ tur: "arac", hat: "18K", kapino: arac.kapino }),
        panelYenile() {},
      };
      return createBusView(S, mc, callbacks);
    };

    // Taze araç çıktısı: EtaEngine çıktı alanları (hizKmSa, duraklamaDk, plaka, operator, guven, sonGuncellemeSn)
    const freshView = makeEnv(freshArac);
    const freshHtml = await freshView.renderVehicle({ hat: "18K", kapino: "A-101" }, false, 1);
    assert.match(freshHtml, /class="canli">CANLI</);
    assert.match(freshHtml, /Yüksek güven/);
    assert.match(freshHtml, /20 sn önce/);
    assert.match(freshHtml, /11:59:40/);
    assert.match(freshHtml, /34 HO 1800/);
    assert.match(freshHtml, /ÖHO/);
    assert.match(freshHtml, /26 km\/sa/);
    assert.match(freshHtml, /0\.7 dk/);
    assert.match(freshHtml, /canli-kart/);

    // Eski GPS sinyalli araç çıktısı: CANLI yok, Eski Sinyal + uyarı notu var
    const staleArac = {
      ...freshArac,
      kapino: "A-202",
      gercek: { lat: 41.0, lon: 29.011, ms: now - 360_000 },
      gor: { lat: 41.0, lon: 29.011 },
      b: { ...freshArac.b, kapino: "A-202", lat: 41.0, lon: 29.011, zaman: now - 360_000 },
    };
    const staleView = makeEnv(staleArac);
    const staleHtml = await staleView.renderVehicle({ hat: "18K", kapino: "A-202" }, false, 1);
    assert.match(staleHtml, /eski-kart/);
    assert.match(staleHtml, /Eski Sinyal/);
    assert.match(staleHtml, /Düşük güven/);
    assert.match(staleHtml, /6 dk önce/);
    assert.match(staleHtml, /güncel olmayabilir/);
    assert.doesNotMatch(staleHtml, /class="canli"/);
    assert.doesNotMatch(staleHtml, /geliyor/);

    // GPS zamanı eksik araç: sahte saat/0 sn önce yok, Yüksek güven/CANLI yok
    const missingArac = {
      ...freshArac,
      kapino: "A-303",
      gercek: { lat: 41.0, lon: 29.011, ms: now },
      gor: { lat: 41.0, lon: 29.011 },
      b: { ...freshArac.b, kapino: "A-303", lat: 41.0, lon: 29.011, zaman: "" },
    };
    const missingView = makeEnv(missingArac);
    const missingHtml = await missingView.renderVehicle({ hat: "18K", kapino: "A-303" }, false, 1);
    assert.match(missingHtml, /eksik-kart/);
    assert.match(missingHtml, /Kısıtlı veri/);
    assert.match(missingHtml, /GPS zamanı yok/);
    assert.match(missingHtml, /yaklaşık tahmindir/);
    assert.doesNotMatch(missingHtml, /class="canli"/);
    assert.doesNotMatch(missingHtml, /Yüksek güven/);
    assert.doesNotMatch(missingHtml, /data-live-age=/);
    assert.doesNotMatch(missingHtml, /geliyor/);

    // 3) renderLine — eski sinyalli filo başlığı ve tarife etiketi kontrolü
    const lineS = {
      arac: new Map([["18K/A-202", staleArac]]),
      favoriler: ["18K"],
      hatVeri: { "18K": { ...vData, otobusler: [staleArac.b] } },
      durak: { "18K": "D4" },
    };
    const lineMc = {
      aktifHatlarAyarla() {},
      hatHazirla: async () => lineS.hatVeri["18K"],
      konumIsle() {},
      katman: { clearLayers() {} },
      hedefKatmani: { clearLayers() {} },
      guzergahCiz() { return []; },
      sigdir() {},
      aracCiz() {},
      durakIsaretle() {},
      hedefDurak: () => ({ i: 3, d: STOPS[3], secili: true }),
      yaklasanOtobusler: () => [
        { bus: staleArac.b, t: EtaEngine.predict(STOPS, staleArac.b, 3, {}), gozlenen: true },
      ],
      aracHizi: () => 20,
      aracYeri: () => ({ sonraki: 2, metre: 220, oran: 0.4 }),
      getTrafikIncidents: () => [],
    };
    const lineView = createBusView(lineS, lineMc, {
      onYukle() {},
      getCizimNo: () => 1,
      baslikHTML: (title) => `<header>${title}</header>`,
      sayfa: () => ({ tur: "hat", hat: "18K" }),
      panelYenile() {},
    });
    const lineHtml = await lineView.renderLine({ hat: "18K", yon: "G", gun: "I" }, false, 1);
    assert.match(lineHtml, /Eski Sinyal/);
    assert.match(lineHtml, /arac-cip eski/);
    assert.match(lineHtml, /role="button" tabindex="0" data-arac="A-202"/);
    assert.match(lineHtml, /data-durak="3" role="button" tabindex="0"/);
    assert.match(lineHtml, /durum-rozet tarife">Tarife</);
    assert.doesNotMatch(lineHtml, /class="canli"/);
  });
});
