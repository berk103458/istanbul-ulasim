import { KV } from "../core/storage.js";
import { setLang } from "../i18n/index.js";

export function createStore(initial = {}) {
  // Existing view and map controllers keep a mutable reference to this state.
  const state = { ...initial };
  const listeners = new Set();

  return {
    get: () => state,
    set(patch) {
      Object.assign(state, patch);
      for (const listener of [...listeners]) {
        if (!listeners.has(listener)) continue;
        try {
          listener(state);
        } catch {
          // Isolate subscriber errors so remaining listeners still run.
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createAppStore() {
  return createStore({
    sekme: "yakin",
    yigin: [],
    ben: null,
    semt: null,
    favoriler: ["18K", "14BK"],
    favoriDuraklar: [],
    durak: {},
    savedPlaces: { ev: null, is: null },
    hatVeri: {},
    arac: new Map(),
    aktifHatlar: new Set(),
    trafik: false,
    ispark: false,
    filoRadar: false,
    theme: "system",
    mapStyle: "standart",
    proxyUrl: "",
    arama: "",
    busKat: "tumu",
    rayliArama: "",
    vapurArama: "",
    vapurGrup: "Tümü",
    rota: {
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
    },
    ag: null,
    stopLinesIndex: null,
    agVapur: false,
  });
}

export async function restorePreferences(store) {
  const [
    favoriler, favoriDuraklar, durak, sonYerler, savedPlaces,
    theme, mapStyle, proxyUrl, trafik, ispark, lang,
  ] = await Promise.all([
    KV.get("favoriler"),
    KV.get("favoriDuraklar"),
    KV.get("durak"),
    KV.get("sonYerler"),
    KV.get("savedPlaces"),
    KV.get("theme"),
    KV.get("mapStyle"),
    KV.get("proxyUrl"),
    KV.get("trafik"),
    KV.get("ispark"),
    KV.get("lang"),
  ]);

  if (lang === "tr" || lang === "en") setLang(lang);

  const patch = {};
  if (Array.isArray(favoriler)) patch.favoriler = favoriler;
  if (Array.isArray(favoriDuraklar)) patch.favoriDuraklar = favoriDuraklar;
  if (durak && typeof durak === "object") patch.durak = durak;
  if (Array.isArray(sonYerler)) patch.rota = { ...store.get().rota, son: sonYerler };
  if (savedPlaces && typeof savedPlaces === "object") patch.savedPlaces = savedPlaces;
  if (theme) patch.theme = theme;
  if (mapStyle) patch.mapStyle = mapStyle;
  if (proxyUrl) patch.proxyUrl = proxyUrl;
  store.set(patch);

  return { trafik: Boolean(trafik), ispark: Boolean(ispark) };
}
