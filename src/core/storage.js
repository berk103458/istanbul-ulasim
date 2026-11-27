// ---- Kalıcı depolama: IndexedDB (100MB+ destekli) + localStorage ----
const DB_NAME = "istanbul-ulasim-v4";
const STORE_NAME = "kv";
const LS_PREFIX = "ulasim.";
const PREF_KEYS = new Set([
  "favoriler", "favoriDuraklar", "durak", "sonYerler", "savedPlaces",
  "tema", "mapStyle", "proxyUrl", "trafik", "ispark",
]);

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function lsGet(key) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function lsSet(key, val) {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(val));
  } catch {}
}

export const KV = {
  async get(key, maxAgeMs) {
    try {
      let rec = null;
      const db = await openDb();
      if (db) {
        rec = await new Promise((res) => {
          try {
            const tx = db.transaction(STORE_NAME, "readonly");
            const rq = tx.objectStore(STORE_NAME).get(key);
            rq.onsuccess = () => res(rq.result || null);
            rq.onerror = () => res(null);
          } catch {
            res(null);
          }
        });
      }
      if (!rec) rec = lsGet(key);
      if (!rec) return null;
      if (maxAgeMs && Date.now() - rec.t > maxAgeMs) return null;
      return rec.d;
    } catch {
      return null;
    }
  },

  async set(key, d) {
    const rec = { t: Date.now(), d };
    try {
      const db = await openDb();
      if (db) {
        await new Promise((res) => {
          try {
            const tx = db.transaction(STORE_NAME, "readwrite");
            tx.objectStore(STORE_NAME).put(rec, key);
            tx.oncomplete = () => res(true);
            tx.onerror = () => res(false);
          } catch {
            res(false);
          }
        });
      }
      if (PREF_KEYS.has(key)) lsSet(key, rec);
      return true;
    } catch {
      return false;
    }
  },

  async del(key) {
    try {
      const db = await openDb();
      if (db) {
        await new Promise((res) => {
          const tx = db.transaction(STORE_NAME, "readwrite");
          tx.objectStore(STORE_NAME).delete(key);
          tx.oncomplete = () => res(true);
          tx.onerror = () => res(false);
        });
      }
      try { localStorage.removeItem(LS_PREFIX + key); } catch {}
    } catch {}
  },

  async clearCache() {
    try {
      const db = await openDb();
      if (db) {
        const keys = await new Promise((res) => {
          const tx = db.transaction(STORE_NAME, "readonly");
          const rq = tx.objectStore(STORE_NAME).getAllKeys();
          rq.onsuccess = () => res(rq.result || []);
          rq.onerror = () => res([]);
        });
        const toDelete = keys.filter((k) => !PREF_KEYS.has(k));
        if (toDelete.length) {
          await new Promise((res) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const st = tx.objectStore(STORE_NAME);
            for (const k of toDelete) st.delete(k);
            tx.oncomplete = () => res(true);
            tx.onerror = () => res(false);
          });
        }
      }
    } catch {}

    try {
      for (const storageKey of Object.keys(localStorage)) {
        if (!storageKey.startsWith(LS_PREFIX)) continue;
        const key = storageKey.slice(LS_PREFIX.length);
        // The i18n module stores its language as a raw localStorage value.
        if (key !== "lang" && !PREF_KEYS.has(key)) localStorage.removeItem(storageKey);
      }
    } catch {}
  },

  async clear() {
    return KV.clearCache();
  },
};
