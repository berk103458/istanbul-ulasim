// Shared test helpers for engine unit tests. Not a test file itself.
import fs from "node:fs";

export const FIXED_LOCAL = new Date(2026, 10, 26, 12, 0, 0); // Çarşamba 12:00 (local)
export const FIXED_MS = FIXED_LOCAL.getTime();

/** Freeze `Date` (node:test mock timers). Only `Date`, not setTimeout. */
export function freezeTime(t, ms = FIXED_MS) {
  t.mock.timers.enable({ apis: ["Date"], now: ms });
}

/** Replace global fetch with `impl`, restoring the original on test teardown. */
export function stubFetch(t, impl) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => {
    globalThis.fetch = orig;
  });
}

/** Build a `fetch` Response-like stub. `body` string or object. */
export function fakeResponse(body, { status = 200, ok = status < 400 } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    ok,
    async text() {
      return text;
    },
    async json() {
      return JSON.parse(text);
    },
  };
}

/** Install a minimal in-memory `localStorage` (Node has no IndexedDB/localStorage). */
export function stubLocalStorage(t) {
  const m = new Map();
  const ls = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    _m: m,
  };
  const orig = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true, writable: true });
  t.after(() => {
    if (orig === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, "localStorage", { value: orig, configurable: true, writable: true });
  });
  return ls;
}

let freshSeq = 0;
/** Import a module with a cache-busting query so its module-level state is fresh. */
export async function freshImport(specifier) {
  return import(specifier + (specifier.includes("?") ? "&" : "?") + "fresh=" + ++freshSeq);
}

export function readFixture(name) {
  return fs.readFileSync(new URL("./" + name, import.meta.url), "utf8");
}
export function readJsonFixture(name) {
  return JSON.parse(readFixture(name));
}

// ---- Synthetic transit graph builders (fed to RouteEngine.initGraph) ----

export function metroLine(id, ad, stopIds, coords, extra = {}) {
  return {
    hat: { id, ad, renk: extra.renk || "#000", ilk: extra.ilk ?? "06:00", son: extra.son ?? "23:00" },
    stations: stopIds.map((sid, i) => ({
      id: sid,
      hatId: id,
      ad: extra.names?.[i] ?? sid,
      kod: extra.kods?.[i],
      lat: coords[i][0],
      lon: coords[i][1],
      sira: i + 1,
    })),
  };
}

/** Simple 3-station line A→B→C spaced ~1.1km apart on the same latitude. */
export function simpleMetroGraph(opts = {}) {
  const line = metroLine(1, opts.ad || "M-TEST", ["A1", "B1", "C1"], [
    [41.0, 29.0],
    [41.0, 29.01],
    [41.0, 29.02],
  ], opts);
  return { hatlar: [line.hat], istasyonlar: line.stations, marmaray: false, gun: opts.gun ?? 3, saat: opts.saat ?? 600 };
}

/** Two metro lines sharing transfer station B (B1 on line1, B2 on line2, same coords). */
export function transferGraph(opts = {}) {
  const l1 = metroLine(1, "M-ONE", ["A1", "B1", "C1"], [[41.0, 29.0], [41.0, 29.01], [41.0, 29.02]], opts);
  const l2 = metroLine(2, "M-TWO", ["B2", "D2"], [[41.0, 29.01], [41.01, 29.01]], opts);
  return {
    hatlar: [l1.hat, l2.hat],
    istasyonlar: [...l1.stations, ...l2.stations],
    marmaray: false,
    gun: opts.gun ?? 3,
    saat: opts.saat ?? 600,
  };
}

/** Synthetic IETT otobus graph. */
export function otobusGraph({ gun = 3, saat = 600, aralik = 5, kod = "500", mb = false, ilk, son } = {}) {
  return {
    hatlar: [],
    istasyonlar: [],
    marmaray: false,
    otobus: {
      hatlar: [{ kod, mb, aralik, ilk, son, yon: { G: ["K1", "K2", "K3"] } }],
      duraklar: { K1: [41.0, 29.0, "A"], K2: [41.0, 29.01, "B"], K3: [41.0, 29.02, "C"] },
    },
    gun,
    saat,
  };
}

// ---- Synthetic ETA stops ----
export const ETA_STOPS = [
  { lat: 41.0, lon: 29.0, ad: "A" },
  { lat: 41.0, lon: 29.001, ad: "B" },
  { lat: 41.0, lon: 29.002, ad: "C" },
];
