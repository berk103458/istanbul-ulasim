// Faz 2 — NotificationEngine birim testleri (node:test, opsiyonel motor). Kaynak dosyalara dokunulmaz.
// Node'da `document`/`Notification` yok → toast noop; fake `Notification` enjekte edilerek web bildirimi test edilir;
// zaman sabitlenir (mock.timers Date); her test taze modül (freshImport).
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { freezeTime, freshImport, FIXED_MS } from "../fixtures/helpers.mjs";

const MOD = "../../src/engines/notificationEngine.js";
async function freshNotify() {
  const m = await freshImport(MOD);
  return m.NotificationEngine;
}

function stubNotification(t, permission = "granted") {
  const created = [];
  class FakeNotification {
    constructor(title, opts) { this.title = title; this.opts = opts; created.push(this); }
    static requestPermission() { return Promise.resolve(FakeNotification.permission); }
  }
  FakeNotification.permission = permission;
  FakeNotification.created = created;
  const orig = globalThis.Notification;
  globalThis.Notification = FakeNotification;
  t.after(() => { if (orig === undefined) delete globalThis.Notification; else globalThis.Notification = orig; });
  return FakeNotification;
}

describe("NotificationEngine.watchStopBus / unwatch / getWatches", () => {
  test("watch id, hat normalizasyonu ve bildirim eşiği", async (t) => {
    freezeTime(t, FIXED_MS);
    const N = await freshNotify();
    const id = N.watchStopBus(" 500 ", "  Kadıköy ", 5);
    assert.match(id, /^w_\d+$/);
    const w = N.getWatches().find((x) => x.id === id);
    assert.equal(w.hat, "500", "hat trim+upper");
    assert.equal(w.durakAd, "Kadıköy", "durakAd trim");
    assert.equal(w.thresholdMin, 5);
    assert.equal(w.createdAt, FIXED_MS, "zaman sabit");
    // threshold
    const thr = (...args) => { const id = N.watchStopBus(...args); return N.getWatches().find((x) => x.id === id).thresholdMin; };
    assert.equal(thr("M2", "x", 0), 1, "eşik alt sınırı 1 dakika");
    assert.equal(thr("M2", "x", "0"), 1);
    assert.equal(thr("M2", "x", -5), 1, "negatif → Math.max(1,..)=1");
    assert.equal(thr("M2", "x", "x"), 3, "NaN→3");
    assert.equal(thr("M2", "x", " "), 3, "boş eşik → varsayılan 3");
    assert.equal(thr("M2", "x", Infinity), 3, "sonsuz eşik → varsayılan 3");
    assert.equal(thr("M2", "x"), 3, "varsayılan 3");
    assert.equal(thr("M2", "x", 2.5), 2.5);
  });

  test("unwatch; clearWatches", async () => {
    const N = await freshNotify();
    const id = N.watchStopBus("500", "X", 3);
    assert.equal(N.unwatch(id), true);
    assert.equal(N.unwatch(id), false);
    assert.equal(N.getWatches().length, 0);
    N.watchStopBus("500", "X"); N.watchStopBus("M2", "Y");
    N.clearWatches();
    assert.deepEqual(N.getWatches(), []);
  });

  test("Node'da showToast noop (document yok); Notification yoksa noop", async () => {
    const N = await freshNotify();
    assert.equal(typeof document, "undefined");
    assert.doesNotThrow(() => N.showToast("t", "m", "info"));
    const id = N.watchStopBus("500", "X", 3); // watchStopBus showToast çağırır; Notification yok
    assert.match(id, /^w_/);
  });
});

describe("NotificationEngine.checkEtas", () => {
  test("hat/durak eşleşmesi; imminent dakika<=threshold; web bildirimi", async (t) => {
    freezeTime(t, FIXED_MS);
    const N = await freshNotify();
    const Fake = stubNotification(t, "granted");
    const id = N.watchStopBus("500", "Kadıköy", 3);
    // hat eşleşmeyen
    N.checkEtas("M2", "Kadıköy", [{ dakika: 1 }]);
    assert.equal(Fake.created.length, 0);
    // durak eşleşmeyen (durakAd verilmiş, küçük/büyük harf)
    N.checkEtas("500", "Başka", [{ dakika: 1 }]);
    assert.equal(Fake.created.length, 0);
    // imminent değil
    N.checkEtas("500", "Kadıköy", [{ dakika: 10 }]);
    assert.equal(Fake.created.length, 0);
    // Durak adı boşluk ve harf farkına rağmen eşleşir.
    N.checkEtas("500", " kadıköy ", [{ dakika: 2, plaka: "34 X 1" }]);
    assert.equal(Fake.created.length, 1, "web bildirimi");
    assert.ok(Fake.created[0].title.includes("500"));
    assert.ok(Fake.created[0].title.includes("2 dk"));
    assert.equal(Fake.created[0].opts.tag, Fake.created[0].title);
    // `durakAd` watch boşsa durak kontrolü atlanır
    const id2 = N.watchStopBus("500", "", 3);
    N.checkEtas("500", "Herhangi", [{ dakika: 1 }]);
    assert.ok(Fake.created.length >= 1);
    N.unwatch(id); N.unwatch(id2);
  });

  test("hat normalizasyonu (trim+upper); Number.isFinite dakika; threshold sınırı <=; boş etas", async (t) => {
    const N = await freshNotify();
    const Fake = stubNotification(t, "granted");
    N.watchStopBus(" 500 ", "X", 3);
    N.checkEtas("500", "X", []);
    N.checkEtas("500", "X", null);
    N.checkEtas("500", "X", "x");
    assert.equal(Fake.created.length, 0);
    N.checkEtas(" 500", "X", [{ dakika: NaN }, { dakika: "x" }, { dakika: Infinity }]);
    assert.equal(Fake.created.length, 0, "Number.isFinite filtre");
    N.checkEtas("500", "X", [{ dakika: 3 }]); // <=threshold
    assert.equal(Fake.created.length, 1, "dakika==threshold");
    N.checkEtas("500", "X", [{ dakika: 3.5 }]);
    // cooldown...
    assert.ok(Fake.created.length >= 1);
  });

  test("cooldown 90s per watch+plaka", async (t) => {
    freezeTime(t, FIXED_MS);
    const N = await freshNotify();
    const Fake = stubNotification(t, "granted");
    N.watchStopBus("500", "X", 3);
    N.checkEtas("500", "X", [{ dakika: 1, plaka: "P1" }]);
    assert.equal(Fake.created.length, 1);
    // aynı plaka, 89s sonra → cooldown
    t.mock.timers.setTime(FIXED_MS + 89_000);
    N.checkEtas("500", "X", [{ dakika: 1, plaka: "P1" }]);
    assert.equal(Fake.created.length, 1);
    // farklı plaka → ayrı key
    N.checkEtas("500", "X", [{ dakika: 1, plaka: "P2" }]);
    assert.equal(Fake.created.length, 2);
    // 90s sonra aynı plaka → tekrar
    t.mock.timers.setTime(FIXED_MS + 91_000);
    N.checkEtas("500", "X", [{ dakika: 1, plaka: "P1" }]);
    assert.equal(Fake.created.length, 3);
    // plaka yok → 'next' key
    N.checkEtas("500", "X", [{ dakika: 1 }]);
    assert.equal(Fake.created.length, 4);
  });

  test("watch yok → noop", async () => {
    const N = await freshNotify();
    assert.doesNotThrow(() => N.checkEtas("500", "X", [{ dakika: 1 }]));
  });
});

describe("NotificationEngine.checkDisruptions", () => {
  test("favori hat duyurusu; key dedup; hat normalizasyonu; hatKod||hat", async (t) => {
    const N = await freshNotify();
    const Fake = stubNotification(t, "granted");
    // favori yok
    N.checkDisruptions([], [{ hatKod: "500", mesaj: "x" }]);
    assert.equal(Fake.created.length, 0);
    // bozuk duyurular
    N.checkDisruptions(["500"], null);
    N.checkDisruptions(["500"], "x");
    assert.equal(Fake.created.length, 0);
    // hat eşleşmeyen
    N.checkDisruptions(["500"], [{ hatKod: "M2", mesaj: "iptal" }]);
    assert.equal(Fake.created.length, 0);
    // favori eşleşme (küçük/büyük harf, trim)
    N.checkDisruptions([" 500 "], [{ hatKod: "500", mesaj: "Sefer aksaklığı", saat: "12:00" }]);
    assert.equal(Fake.created.length, 1);
    // aynı key tekrar → dedup
    N.checkDisruptions(["500"], [{ hatKod: "500", mesaj: "Sefer aksaklığı", saat: "12:00" }]);
    assert.equal(Fake.created.length, 1, "seenDisruptions dedup");
    // hat (hatKod yok)
    N.checkDisruptions(["M2"], [{ hat: "M2", mesaj: "x" }]);
    assert.equal(Fake.created.length, 2);
    // mesaj 140 kırpma + varsayılan mesaj
    N.checkDisruptions(["500"], [{ hatKod: "500", mesaj: "y".repeat(300), saat: "13:00" }]);
    assert.equal(Fake.created.length, 3);
    // hatKod boş → atla
    N.checkDisruptions(["500"], [{ hatKod: "", mesaj: "x" }]);
    assert.equal(Fake.created.length, 3);
  });

  test("favori liste boş/bozuk → noop", async (t) => {
    const N = await freshNotify();
    const Fake = stubNotification(t, "granted");
    N.checkDisruptions([], [{ hatKod: "500", mesaj: "x" }]);
    N.checkDisruptions(null, [{ hatKod: "500", mesaj: "x" }]);
    assert.equal(Fake.created.length, 0);
  });
});
