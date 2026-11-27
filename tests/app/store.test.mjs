// Faz 3 — Uygulama store sözleşmesi testleri (node:test, bağımlılıksız).
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { createStore, createAppStore, restorePreferences } from "../../src/state/store.js";
import { getLang, setLang } from "../../src/i18n/index.js";
import { stubLocalStorage } from "../fixtures/helpers.mjs";

function putKv(ls, key, d) {
  ls.setItem("ulasim." + key, JSON.stringify({ t: Date.now(), d }));
}

describe("createStore(initial)", () => {
  test("başlangıç state'i döner, varsayılan boş nesnedir ve başlangıç nesnesini değiştirmez", () => {
    const empty = createStore();
    assert.deepEqual(empty.get(), {});

    const initial = { sekme: "yakin", count: 1 };
    const store = createStore(initial);
    assert.deepEqual(store.get(), { sekme: "yakin", count: 1 });
    assert.notEqual(store.get(), initial, "üst düzey nesne sığ kopyalanmalı");

    store.set({ count: 2, extra: true });
    assert.deepEqual(initial, { sekme: "yakin", count: 1 }, "initial girdi nesnesi mutasyona uğramamalı");
    assert.deepEqual(store.get(), { sekme: "yakin", count: 2, extra: true });
  });

  test("sığ birleştirme yapar ve mevcut state referansını korur", () => {
    const store = createStore({ a: 1, b: "ilk", c: true, d: "kalir" });
    const ref = store.get();

    store.set({ b: "yeni", c: false });
    assert.equal(store.get(), ref, "view/map denetleyicileri için aynı state referansı korunmalı");
    assert.deepEqual(store.get(), { a: 1, b: "yeni", c: false, d: "kalir" });

    store.set({ a: 0, b: "", d: null });
    assert.deepEqual(store.get(), { a: 0, b: "", c: false, d: null });

    assert.doesNotThrow(() => store.set({}));
    assert.doesNotThrow(() => store.set(null));
    assert.doesNotThrow(() => store.set(undefined));
  });

  test("subscribe(fn) güncellemeleri sırayla bildirir ve unsubscribe aboneliği sonlandırır", () => {
    const store = createStore({ sekme: "yakin", arama: "" });
    const log = [];

    const unsub1 = store.subscribe((s) => log.push(`A:${s.sekme}:${s.arama}`));
    const unsub2 = store.subscribe((s) => log.push(`B:${s.sekme}:${s.arama}`));
    assert.equal(log.length, 0, "subscribe anında bildirim yapmamalı");

    store.set({ sekme: "rota" });
    assert.deepEqual(log, ["A:rota:", "B:rota:"]);

    unsub1();
    unsub1(); // idempotent olmalı
    store.set({ arama: "500T" });
    assert.deepEqual(log, ["A:rota:", "B:rota:", "B:rota:500T"]);

    unsub2();
    store.set({ sekme: "otobus" });
    assert.equal(log.length, 3, "tüm aboneler ayrıldıktan sonra bildirim yapılmamalı");
  });

  test("aynı abone fonksiyonu iki kez eklendiğinde tek bildirim alır", () => {
    const store = createStore({ n: 0 });
    let calls = 0;
    const fn = () => { calls++; };

    const unsub1 = store.subscribe(fn);
    store.subscribe(fn);
    store.set({ n: 1 });
    assert.equal(calls, 1);

    unsub1();
    store.set({ n: 2 });
    assert.equal(calls, 1);
  });

  test("bildirim sırasında unsubscribe ve yeni subscribe güvenli çalışır", () => {
    const store = createStore({ step: 0 });
    const seen = [];
    let unsubLate;
    let lateAddedCalls = 0;

    let unsubSelf;
    unsubSelf = store.subscribe((s) => {
      seen.push(`self:${s.step}`);
      unsubSelf();
      unsubLate?.();
      store.subscribe(() => { lateAddedCalls++; });
    });
    unsubLate = store.subscribe((s) => {
      seen.push(`removed:${s.step}`);
    });
    store.subscribe((s) => {
      seen.push(`keep:${s.step}`);
    });

    store.set({ step: 1 });
    assert.deepEqual(seen, ["self:1", "keep:1"]);
    assert.equal(lateAddedCalls, 0, "devam eden set() sırasında eklenen abone aynı turda tetiklenmemeli");

    store.set({ step: 2 });
    assert.deepEqual(seen, ["self:1", "keep:1", "keep:2"]);
    assert.equal(lateAddedCalls, 1);
  });

  test("iç içe nesneler (rota, savedPlaces) sığ birleştirme sözleşmesine uyar", () => {
    const store = createStore({
      savedPlaces: { ev: null, is: null },
      rota: { nereden: null, nereye: null, filtre: "onerilen", son: [] },
    });

    const ev = { ad: "Ev", lat: 41.0, lon: 29.0 };
    store.set({ savedPlaces: { ...store.get().savedPlaces, ev } });
    assert.deepEqual(store.get().savedPlaces, { ev, is: null });

    // Sığ birleştirme: rota doğrudan kısmi nesne ile set edilirse o alan tamamen yenisiyle değişir
    const prevRota = store.get().rota;
    store.set({ rota: { ...prevRota, filtre: "fastest", son: [{ ad: "Üsküdar" }] } });
    assert.equal(store.get().rota.filtre, "fastest");
    assert.equal(store.get().rota.nereden, null);
    assert.deepEqual(store.get().rota.son, [{ ad: "Üsküdar" }]);

    // Doğrudan sığ değişim (derin birleştirme yapılmadığını doğrula)
    store.set({ savedPlaces: { ev: { ad: "Yeni Ev" } } });
    assert.deepEqual(store.get().savedPlaces, { ev: { ad: "Yeni Ev" } });
    assert.equal("is" in store.get().savedPlaces, false);
  });

  test("Set ve Map alanlarını korur ve yeni örneklerle günceller", () => {
    const arac = new Map([["18K/A001", { kapino: "A001", lat: 41.01, lon: 29.05 }]]);
    const aktifHatlar = new Set(["18K"]);
    const store = createStore({ arac, aktifHatlar, sekme: "yakin" });

    // İlgisiz set() Map/Set örneklerini bozmamalı
    store.set({ sekme: "otobus" });
    assert.ok(store.get().arac instanceof Map);
    assert.ok(store.get().aktifHatlar instanceof Set);
    assert.equal(store.get().arac.get("18K/A001").kapino, "A001");
    assert.equal(store.get().aktifHatlar.has("18K"), true);

    // Yerinde mutasyonlar state üzerinden görünür
    store.get().arac.set("14BK/B002", { kapino: "B002" });
    store.get().aktifHatlar.add("14BK");
    assert.equal(store.get().arac.size, 2);
    assert.deepEqual([...store.get().aktifHatlar], ["18K", "14BK"]);

    // Patch ile yeni Map/Set atanabilir
    const nextMap = new Map();
    const nextSet = new Set(["500T"]);
    store.set({ arac: nextMap, aktifHatlar: nextSet });
    assert.equal(store.get().arac, nextMap);
    assert.equal(store.get().aktifHatlar, nextSet);
    assert.equal(store.get().aktifHatlar.has("500T"), true);
  });

  test("abone hatası diğer aboneleri durdurmamalı ve state güncellemesi tamamlanmalı", () => {
    const store = createStore({ sekme: "yakin", count: 0 });
    const calls = [];

    store.subscribe((s) => {
      calls.push(`first:${s.count}`);
      throw new Error("abone-1 patladı");
    });
    store.subscribe((s) => {
      calls.push(`second:${s.count}`);
    });
    store.subscribe((s) => {
      calls.push(`third:${s.count}`);
      throw new TypeError("abone-3 patladı");
    });
    store.subscribe((s) => {
      calls.push(`fourth:${s.count}`);
    });

    assert.doesNotThrow(() => store.set({ sekme: "rota", count: 1 }));
    assert.equal(store.get().sekme, "rota");
    assert.equal(store.get().count, 1);
    assert.deepEqual(calls, ["first:1", "second:1", "third:1", "fourth:1"]);

    // Sonraki set() çağrıları da tüm aboneleri çalıştırmaya devam etmeli
    assert.doesNotThrow(() => store.set({ count: 2 }));
    assert.deepEqual(calls, [
      "first:1", "second:1", "third:1", "fourth:1",
      "first:2", "second:2", "third:2", "fourth:2",
    ]);
  });
});

describe("createAppStore() varsayılanları", () => {
  test("beklenen varsayılan değerler ve koleksiyon tipleriyle başlar", () => {
    const store = createAppStore();
    const s = store.get();

    assert.equal(s.sekme, "yakin");
    assert.deepEqual(s.favoriler, ["18K", "14BK"]);
    assert.equal(s.theme, "system");
    assert.equal(s.mapStyle, "standart");
    assert.equal(s.rota.filtre, "onerilen");

    assert.deepEqual(s.yigin, []);
    assert.deepEqual(s.favoriDuraklar, []);
    assert.deepEqual(s.durak, {});
    assert.deepEqual(s.savedPlaces, { ev: null, is: null });
    assert.deepEqual(s.hatVeri, {});
    assert.ok(s.arac instanceof Map);
    assert.equal(s.arac.size, 0);
    assert.ok(s.aktifHatlar instanceof Set);
    assert.equal(s.aktifHatlar.size, 0);

    assert.equal(s.trafik, false);
    assert.equal(s.ispark, false);
    assert.equal(s.filoRadar, false);
    assert.equal(s.proxyUrl, "");
    assert.equal(s.arama, "");
    assert.equal(s.busKat, "tumu");
    assert.equal(s.rayliArama, "");
    assert.equal(s.vapurArama, "");
    assert.equal(s.vapurGrup, "Tümü");
    assert.deepEqual(s.rota, {
      nereden: null,
      nereye: null,
      aktif: null,
      metin: "",
      oneriler: [],
      sonuclar: null,
      gosterilenSonuclar: null,
      filtre: "onerilen",
      durum: "",
      son: [],
      zaman: null,
    });
    assert.equal(s.ag, null);
    assert.equal(s.stopLinesIndex, null);
    assert.equal(s.agVapur, false);
  });

  test("iki createAppStore() örneği birbirinden izoledir", () => {
    const a = createAppStore();
    const b = createAppStore();

    a.get().favoriler.push("500T");
    a.get().savedPlaces.ev = { ad: "Ev" };
    a.get().rota.filtre = "fastest";
    a.get().arac.set("18K/1", { kapino: "1" });
    a.get().aktifHatlar.add("18K");

    assert.deepEqual(b.get().favoriler, ["18K", "14BK"]);
    assert.deepEqual(b.get().savedPlaces, { ev: null, is: null });
    assert.equal(b.get().rota.filtre, "onerilen");
    assert.equal(b.get().arac.size, 0);
    assert.equal(b.get().aktifHatlar.size, 0);
  });
});

describe("restorePreferences(store)", () => {
  test("boş depolamada varsayılanları korur ve trafik/ispark false döner", async (t) => {
    stubLocalStorage(t);
    const store = createAppStore();
    let notifications = 0;
    store.subscribe(() => { notifications++; });

    const flags = await restorePreferences(store);
    assert.deepEqual(flags, { trafik: false, ispark: false });
    assert.equal(notifications, 1);
    assert.equal(store.get().sekme, "yakin");
    assert.deepEqual(store.get().favoriler, ["18K", "14BK"]);
    assert.equal(store.get().theme, "system");
    assert.equal(store.get().mapStyle, "standart");
    assert.equal(store.get().rota.filtre, "onerilen");
  });

  test("kayıtlı tercihleri store'a uygular, rota alanlarını korur ve geçersiz tipleri yok sayar", async (t) => {
    const prevLang = getLang();
    t.after(() => setLang(prevLang));

    const ls = stubLocalStorage(t);
    putKv(ls, "favoriler", ["500T", "34BZ"]);
    putKv(ls, "favoriDuraklar", [{ kod: "1001", ad: "Kadıköy" }]);
    putKv(ls, "durak", { "500T": "1001" });
    putKv(ls, "sonYerler", [{ ad: "Üsküdar", lat: 41.025, lon: 29.013 }]);
    putKv(ls, "savedPlaces", { ev: { ad: "Ev", lat: 41.0, lon: 29.0 }, is: null });
    putKv(ls, "theme", "dark");
    putKv(ls, "mapStyle", "sade");
    putKv(ls, "proxyUrl", "https://proxy.example.test");
    putKv(ls, "trafik", true);
    putKv(ls, "ispark", true);
    putKv(ls, "lang", "en");

    const store = createAppStore();
    const flags = await restorePreferences(store);

    assert.deepEqual(flags, { trafik: true, ispark: true });
    assert.equal(getLang(), "en");
    assert.deepEqual(store.get().favoriler, ["500T", "34BZ"]);
    assert.deepEqual(store.get().favoriDuraklar, [{ kod: "1001", ad: "Kadıköy" }]);
    assert.deepEqual(store.get().durak, { "500T": "1001" });
    assert.deepEqual(store.get().savedPlaces, { ev: { ad: "Ev", lat: 41.0, lon: 29.0 }, is: null });
    assert.equal(store.get().theme, "dark");
    assert.equal(store.get().mapStyle, "sade");
    assert.equal(store.get().proxyUrl, "https://proxy.example.test");
    assert.equal(store.get().rota.filtre, "onerilen", "sonYerler yüklenirken diğer rota alanları korunmalı");
    assert.deepEqual(store.get().rota.son, [{ ad: "Üsküdar", lat: 41.025, lon: 29.013 }]);

    // Geçersiz tipler varsayılanları bozmamalı
    ls.clear();
    putKv(ls, "favoriler", "bozuk");
    putKv(ls, "sonYerler", "bozuk");
    putKv(ls, "savedPlaces", "bozuk");
    const store2 = createAppStore();
    await restorePreferences(store2);
    assert.deepEqual(store2.get().favoriler, ["18K", "14BK"]);
    assert.deepEqual(store2.get().rota.son, []);
    assert.deepEqual(store2.get().savedPlaces, { ev: null, is: null });
  });
});
