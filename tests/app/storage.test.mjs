import assert from "node:assert/strict";
import test from "node:test";

import { createAppStore, restorePreferences } from "../../src/state/store.js";
import { freshImport, stubLocalStorage } from "../fixtures/helpers.mjs";

const favoriteStops = [
  { kod: "1001", stopId: "", ad: "Kadıköy", lat: 40.99, lon: 29.02, tur: "otobus" },
  { kod: "", stopId: "M4-2", ad: "Ayrılık Çeşmesi", lat: 41, lon: 29.03, tur: "metro" },
];
const cacheKey = "iett.ag.v1";

function stubIndexedDB(t, records) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open() {
        return request({
          transaction() {
            const tx = {
              objectStore: () => ({
                get: (key) => request(structuredClone(records.get(key))),
                getAllKeys: () => request([...records.keys()]),
                put: (record, key) => records.set(key, structuredClone(record)),
                delete: (key) => records.delete(key),
              }),
            };
            queueMicrotask(() => tx.oncomplete?.());
            return tx;
          },
        });
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "indexedDB", original);
    else delete globalThis.indexedDB;
  });
}

function request(result) {
  const req = { result };
  queueMicrotask(() => req.onsuccess());
  return req;
}

async function openStorage() {
  const { KV } = await freshImport(new URL("../../src/core/storage.js", import.meta.url).href);
  return KV;
}

test("önbellek temizliği eski IndexedDB favorilerini ve korunan tercihleri yeniden açılışta korur", { timeout: 5000 }, async (t) => {
  const ls = stubLocalStorage(t);
  const preferences = {
    favoriler: ["500T"],
    favoriDuraklar: [{ kod: "1001", ad: "Kadıköy" }],
    durak: { "500T": "1001" },
    sonYerler: [{ ad: "Üsküdar" }],
    savedPlaces: { ev: { ad: "Ev" }, is: null },
    tema: "dark",
    mapStyle: "sade",
    proxyUrl: "https://proxy.example.test",
    trafik: true,
    ispark: false,
  };
  const legacyRecords = new Map(Object.entries(preferences).map(([key, d]) => [key, { t: 1, d }]));
  const records = new Map([...legacyRecords, [cacheKey, { t: Date.now(), d: { hatlar: [] } }]]);
  stubIndexedDB(t, records);
  const kv = await openStorage();
  assert.equal(ls.getItem("ulasim.favoriDuraklar"), null);
  assert.deepEqual(await kv.get(cacheKey), { hatlar: [] });

  await kv.clear();

  assert.deepEqual(records, legacyRecords);
  // Reopening loads preferences through the app's startup path.
  const store = createAppStore();
  const flags = await restorePreferences(store);
  assert.deepEqual(store.get().favoriDuraklar, preferences.favoriDuraklar);
  assert.deepEqual(store.get().favoriler, preferences.favoriler);
  assert.deepEqual(flags, { trafik: true, ispark: false });
  assert.equal(await (await openStorage()).get(cacheKey), null);
});

test("yeni favori duraklar IndexedDB ve localStorage yedeğine kaydedilir, yedek temizliği atlatır", { timeout: 5000 }, async (t) => {
  const ls = stubLocalStorage(t);
  const records = new Map();
  stubIndexedDB(t, records);
  const kv = await openStorage();
  await kv.set("favoriDuraklar", favoriteStops);
  await kv.set(cacheKey, { hatlar: [] });
  const backup = ls.getItem("ulasim.favoriDuraklar");
  assert.deepEqual(records.get("favoriDuraklar"), JSON.parse(backup));
  assert.deepEqual(records.get("favoriDuraklar").d, favoriteStops);

  await kv.clearCache();

  assert.equal(ls.getItem("ulasim.favoriDuraklar"), backup);
  assert.deepEqual(await (await openStorage()).get("favoriDuraklar"), favoriteStops);
  assert.deepEqual([...records.keys()], ["favoriDuraklar"]);
  records.clear();
  assert.deepEqual(await (await openStorage()).get("favoriDuraklar"), favoriteStops);
});

test("IndexedDB kullanılamadığında eski ve güncellenmiş localStorage favorileri yeniden okunur", { timeout: 5000 }, async (t) => {
  const ls = stubLocalStorage(t);
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "indexedDB", original);
    else delete globalThis.indexedDB;
  });
  const legacyStops = [{ kod: "1001", ad: "Kadıköy" }];
  ls.setItem("ulasim.favoriDuraklar", JSON.stringify({ t: 1, d: legacyStops }));
  const kv = await openStorage();

  await kv.clearCache();
  const reopened = await openStorage();
  assert.deepEqual(await reopened.get("favoriDuraklar"), legacyStops);
  await reopened.set("favoriDuraklar", []);
  await reopened.clearCache();
  assert.deepEqual(await (await openStorage()).get("favoriDuraklar"), []);
});
