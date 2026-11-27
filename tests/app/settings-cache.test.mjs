import assert from "node:assert/strict";
import test from "node:test";

import { KV } from "../../src/core/storage.js";
import { getLang, initLang, setLang, t as translate } from "../../src/i18n/index.js";
import { createAppStore, restorePreferences } from "../../src/state/store.js";
import { stubFetch } from "../fixtures/helpers.mjs";

test("Ayarlar düğmesi IndexedDB olmadan önbelleği temizler ve yeniden açılışta favoriler yüklenir", { timeout: 5000 }, async (t) => {
  const store = createAppStore();
  const cacheNames = new Set(["istanbul-ulasim-v4.0", "istanbul-ulasim-tiles-v1"]);
  const cacheStorage = {
    keys: async () => [...cacheNames],
    delete: async (key) => cacheNames.delete(key),
  };
  const localStorage = Object.create({
    getItem(key) { return Object.hasOwn(this, key) ? this[key] : null; },
    setItem(key, value) { this[key] = String(value); },
    removeItem(key) { delete this[key]; },
  });
  const modal = {
    innerHTML: "",
    hasAttribute: (name) => name === "hidden",
    removeAttribute() {},
    querySelector: () => null,
  };
  const status = { textContent: "" };
  let onClearClick;
  const clearButton = {
    addEventListener(type, listener) {
      assert.equal(type, "click");
      onClearClick = listener;
    },
    click() { return onClearClick(); },
  };
  const elements = {
    "#altModal": modal,
    "#cacheTemizleBtn": clearButton,
    "#cacheTemizleBtn .ayar-alt": status,
  };
  const globals = {
    indexedDB: undefined,
    localStorage,
    caches: cacheStorage,
    HTMLElement: class {},
    window: { screen: {}, caches: cacheStorage },
    document: {
      documentElement: { style: {} },
      createElement: () => ({ style: {} }),
      querySelector: (selector) => elements[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener() {},
    },
  };
  const originalLang = getLang();
  t.after(() => setLang(originalLang));
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else delete globalThis[key];
    });
  }
  stubFetch(t, async () => Response.json({ googleMapsConfigured: false }));

  const favoriteStops = [{ kod: "1001", ad: "Kadıköy" }];
  await KV.set("favoriDuraklar", favoriteStops);
  await KV.set("favoriler", ["500T"]);
  await KV.set("mapStyle", "sade");
  localStorage.setItem("ulasim.lang", "en");
  localStorage.setItem("ulasim.iett.ag.v1", JSON.stringify({ t: 1, d: { hatlar: [] } }));
  localStorage.setItem("ulasim.tile-index", "{}");
  localStorage.setItem("other-app.preference", "keep");
  assert.deepEqual(await KV.get("iett.ag.v1"), { hatlar: [] });

  const { createStopModal } = await import("../../src/views/stopModal.js");
  createStopModal(store.get(), {}, {}).openSettings();
  assert.match(modal.innerHTML, /id="cacheTemizleBtn"/);
  await clearButton.click();

  assert.equal(await KV.get("iett.ag.v1"), null);
  assert.equal(localStorage.getItem("ulasim.tile-index"), null);
  assert.deepEqual(await cacheStorage.keys(), []);
  assert.equal(localStorage.getItem("other-app.preference"), "keep");
  assert.equal(status.textContent, translate("settings.clearCacheDone"));

  const reopened = createAppStore();
  assert.equal(initLang(), "en");
  await restorePreferences(reopened);
  assert.deepEqual(reopened.get().favoriDuraklar, favoriteStops);
  assert.deepEqual(reopened.get().favoriler, ["500T"]);
  assert.equal(reopened.get().mapStyle, "sade");
});
