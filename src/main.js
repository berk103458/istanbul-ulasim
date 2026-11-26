/**
 * İstanbul Ulaşım v5.0 — Lazy-Loaded Bootstrap, Surgical Live DOM Updates & SSE Integration
 */
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./styles/tokens.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/map.css";

import { App } from "@capacitor/app";
import { KV } from "./core/storage.js";
import { Bridge } from "./core/bridge.js";
import { API } from "./core/api.js";
import { iconSvg } from "./ui/icons.js";
import { initLang, setLang, t } from "./i18n/index.js";
import { DataProvider } from "./engines/dataProvider.js";
import { NotificationEngine } from "./engines/notificationEngine.js";
import { createMapController, esc, hataMesaji } from "./map/mapController.js";
import { createNearbyView, HIZLI_SEMTLER } from "./views/nearbyView.js";

const CANLI_SN = 5;

const S = {
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
};

let cizimNo = 0;
let panelZamanlayici = null;
let nearbyCache = [];
let deferredInstallPrompt = null;

// ---------------- Toast Container for NotificationEngine ----------------
function ensureToastContainer() {
  if (typeof document === "undefined") return null;
  let el = document.querySelector("#toastKutu");
  if (!el) {
    el = document.createElement("div");
    el.id = "toastKutu";
    el.className = "toast-kutu";
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  return el;
}

// ---------------- Lazy-Loaded View & Modal Loaders ----------------
let modalInstance = null;
let modalPromise = null;
async function getModal() {
  if (modalInstance) return modalInstance;
  if (!modalPromise) {
    modalPromise = import("./views/stopModal.js").then((m) => {
      modalInstance = m.createStopModal(S, mc, callbacks);
      return modalInstance;
    });
  }
  return modalPromise;
}

let routeViewInstance = null;
let routeViewPromise = null;
async function getRouteView() {
  if (routeViewInstance) return routeViewInstance;
  if (!routeViewPromise) {
    routeViewPromise = import("./views/routeView.js").then((m) => {
      routeViewInstance = m.createRouteView(S, mc, callbacks);
      return routeViewInstance;
    });
  }
  return routeViewPromise;
}

let busViewInstance = null;
let busViewPromise = null;
async function getBusView() {
  if (busViewInstance) return busViewInstance;
  if (!busViewPromise) {
    busViewPromise = import("./views/busView.js").then((m) => {
      busViewInstance = m.createBusView(S, mc, callbacks);
      return busViewInstance;
    });
  }
  return busViewPromise;
}

let railViewInstance = null;
let railViewPromise = null;
async function getRailView() {
  if (railViewInstance) return railViewInstance;
  if (!railViewPromise) {
    railViewPromise = import("./views/railView.js").then((m) => {
      railViewInstance = m.createRailView(S, mc, callbacks);
      return railViewInstance;
    });
  }
  return railViewPromise;
}

let ferryViewInstance = null;
let ferryViewPromise = null;
async function getFerryView() {
  if (ferryViewInstance) return ferryViewInstance;
  if (!ferryViewPromise) {
    ferryViewPromise = import("./views/ferryView.js").then((m) => {
      ferryViewInstance = m.createFerryView(S, mc, callbacks);
      return ferryViewInstance;
    });
  }
  return ferryViewPromise;
}

function sayfa() {
  return S.yigin.length ? S.yigin[S.yigin.length - 1] : { tur: S.sekme };
}

function syncNav() {
  document.querySelectorAll("#sekmeler button").forEach((b) => {
    b.classList.toggle("aktif", b.dataset.sekme === S.sekme);
  });
}

function baslikHTML(metin, geriVar, ek = "") {
  return `
    <div class="baslik-satir" style="margin-top:4px">
      <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1">
        ${geriVar ? `<button class="btn ikon" data-geri aria-label="${esc(t("common.back"))}" style="width:36px;height:36px;min-width:36px">${iconSvg("chevronLeft", 18)}</button>` : ""}
        <h2 style="font-size:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${metin}</h2>
      </div>
      ${ek}
    </div>`;
}

function onYukle(b, g) {
  const ic = document.querySelector("#icerik");
  if (!ic) return;
  ic.innerHTML =
    baslikHTML(b, g) +
    `<div class="skeleton skeleton-kart"></div><div class="skeleton skeleton-kart"></div><div class="skeleton skeleton-satir"></div>`;
}

function surgicalLiveUpdate() {
  const ic = document.querySelector("#icerik");
  if (!ic) return false;

  // Update live age counters in-place
  ic.querySelectorAll("[data-live-age]").forEach((el) => {
    const ms = Number(el.dataset.liveAge);
    if (!isFinite(ms) || ms <= 0) return;
    const yas = Math.max(0, Math.round((Date.now() - ms) / 1000));
    el.textContent = yas < 90 ? t("eta.secAgo", { n: yas }) : t("eta.minAgo", { n: Math.round(yas / 60) });
  });

  // Update live ETA elements in-place when order/count hasn't changed
  const etaEls = ic.querySelectorAll("[data-live-eta]");
  if (!etaEls.length) return false;

  let anyMismatch = false;
  const p = sayfa();

  etaEls.forEach((el) => {
    const key = el.dataset.liveEta;
    const [hat, kapino] = String(key || "").split("/");
    const a = S.arac.get(key);
    if (!a || !hat || !kapino) {
      anyMismatch = true;
      return;
    }
    const hd = mc.hedefDurak(hat, a.yon);
    if (!hd) return;
    const list = mc.yaklasanOtobusler(hat, a.yon, hd.i);
    const match = list.find((x) => x.bus.kapino === kapino);
    if (!match) {
      anyMismatch = true;
      return;
    }
    const dk = Math.round(match.t.dakika);
    const sureSpan = el.querySelector(".sure") || (el.classList.contains("sure") ? el : null);
    if (sureSpan) {
      sureSpan.classList.toggle("yakin", dk <= 3);
      sureSpan.textContent = dk <= 1 ? t("eta.arriving") : `~${dk} dk`;
    }
  });

  if (typeof NotificationEngine?.checkUpdates === "function") {
    NotificationEngine.checkUpdates(S, mc).catch(() => {});
  }

  return !anyMismatch && p.tur !== "hat";
}

function panelYenile() {
  if (surgicalLiveUpdate()) return;
  clearTimeout(panelZamanlayici);
  panelZamanlayici = setTimeout(() => ciz(false), 120);
}

// ---------------- Bottom Sheet Physics ----------------
const panelEl = () => document.querySelector("#panel");

function panelKonum() {
  const b = document.body.classList;
  return b.contains("tam") ? "tam" : b.contains("genis") ? "genis" : "normal";
}

function panelAyarla(k) {
  document.body.classList.toggle("tam", k === "tam");
  document.body.classList.toggle("genis", k === "genis");
  const p = panelEl();
  if (k === "tam" && p) p.scrollTop = 0;
  setTimeout(() => mc.map.invalidateSize({ pan: false }), 300);
}

// ---------------- Controllers & Eager Nearby View ----------------
const callbacks = {
  sayfa,
  getCizimNo: () => cizimNo,
  baslikHTML,
  onYukle,
  panelYenile,
  syncNav,
  ciz: (degisti) => ciz(degisti),
  git: (s) => git(s),
  geri: (fromPop) => geri(fromPop),
  aracAc: (hat, kapino) => aracAc(hat, kapino),
  openStopBoard: async (stop) => (await getModal()).openStopBoard(stop),
  openIspark: async (park) => (await getModal()).openIspark(park),
  openSettings: async () => (await getModal()).openSettings(),
  setRoutePlace: async (alan, yer) => (await getRouteView()).setRoutePlace(alan, yer),
  applyTheme: (th) => applyTheme(th),
  setNearbyCache: (list) => {
    nearbyCache = list;
  },
};

const mc = createMapController(S, callbacks);
const nearbyView = createNearbyView(S, mc, callbacks);

function git(s) {
  S.yigin.push(s);
  try {
    history.pushState({ depth: S.yigin.length, sekme: S.sekme }, "");
  } catch {
    // ignore history errors in restricted contexts
  }
  ciz(true);
}

function geri(fromPop = false) {
  if (!S.yigin.length) return;
  S.yigin.pop();
  if (!fromPop) {
    try {
      if (history.state?.depth > 0) history.back();
    } catch {
      // ignore
    }
  }
  ciz(true);
}

function aracAc(hat, kapino) {
  if (panelKonum() === "tam") panelAyarla("normal");
  const yeni = { tur: "arac", hat, kapino };
  if (sayfa().tur === "arac") S.yigin[S.yigin.length - 1] = yeni;
  else git(yeni);
  mc.setTakipArac(hat + "/" + kapino);
  ciz(true);
}

async function ciz(sayfaDegisti = false) {
  const no = ++cizimNo;
  const p = sayfa();
  if (sayfaDegisti) {
    if (p.tur !== "arac") mc.setTakipArac(null);
    mc.haritaTemizle();
    const ic = document.querySelector("#icerik");
    if (ic) ic.scrollTop = 0;
    routeViewInstance?.secimBitir();
  }

  const ic = document.querySelector("#icerik");
  if (!ic) return;

  const routes = {
    yakin: (x, i, n) => nearbyView.render(x, i, n),
    rota: async (x, i, n) => (await getRouteView()).render(x, i, n),
    rdetay: async (x, i, n) => (await getRouteView()).renderDetail(x, i, n),
    otobus: async (x, i, n) => (await getBusView()).renderList(x, i, n),
    hat: async (x, i, n) => (await getBusView()).renderLine(x, i, n),
    arac: async (x, i, n) => (await getBusView()).renderVehicle(x, i, n),
    rayli: async (x, i, n) => (await getRailView()).renderList(x, i, n),
    rhat: async (x, i, n) => (await getRailView()).renderLine(x, i, n),
    ist: async (x, i, n) => (await getRailView()).renderStation(x, i, n),
    vapur: async (x, i, n) => (await getFerryView()).renderList(x, i, n),
    vhat: async (x, i, n) => (await getFerryView()).renderLine(x, i, n),
  };

  try {
    const html = await (routes[p.tur] || routes.yakin)(p, sayfaDegisti, no);
    if (no !== cizimNo || html == null) return;

    const aktif = document.activeElement;
    const id = aktif && aktif.id;
    const pos = aktif && aktif.selectionStart;

    let installBanner = "";
    if (deferredInstallPrompt && S.sekme === "yakin" && !S.yigin.length) {
      installBanner = `
        <div class="duyuru bilgi" id="pwaBanner" style="justify-content:space-between;align-items:center">
          <span>${esc(t("common.installBanner"))}</span>
          <span style="display:flex;gap:6px">
            <button class="btn kucuk birincil" id="pwaKurBtn">${esc(t("common.installBtn"))}</button>
            <button class="btn kucuk" id="pwaKapatBtn">×</button>
          </span>
        </div>`;
    }

    ic.innerHTML = installBanner + html;

    if (id) {
      const el = document.getElementById(id);
      if (el && el.tagName === "INPUT") {
        el.focus();
        try {
          el.setSelectionRange(pos, pos);
        } catch {
          // ignore
        }
      }
    }
  } catch (e) {
    if (no !== cizimNo) return;
    ic.innerHTML =
      baslikHTML(esc(t("common.error")), S.yigin.length > 0) +
      `<div class="duyuru hata"><span class="duyuru-ikon">${iconSvg("alert", 18)}</span><span>${esc(hataMesaji(e))}</span></div>` +
      `<button class="btn" data-yenile>${iconSvg("refresh", 16)} ${esc(t("common.retry"))}</button>`;
  }
}

// ---------------- Theme ----------------
function applyTheme(theme) {
  S.theme = theme || "system";
  KV.set("theme", S.theme);
  if (S.theme === "light" || S.theme === "dark") {
    document.documentElement.dataset.theme = S.theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
  mc.updateBaseLayer();
}

window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (S.theme === "system") mc.updateBaseLayer();
});

// ---------------- Map Floating Controls ----------------
document.querySelector("#trafikBtn")?.addEventListener("click", () => {
  S.trafik = !S.trafik;
  document.querySelector("#trafikBtn")?.classList.toggle("aktif", S.trafik);
  KV.set("trafik", S.trafik);
  if (S.trafik) mc.trafikYukle();
  else {
    mc.trafikKatmani.clearLayers();
    mc.trafikBilgiYaz();
  }
});

document.querySelector("#isparkBtn")?.addEventListener("click", () => {
  S.ispark = !S.ispark;
  document.querySelector("#isparkBtn")?.classList.toggle("aktif", S.ispark);
  KV.set("ispark", S.ispark);
  if (S.ispark) mc.isparkYukle();
  else {
    mc.isparkKatmani.clearLayers();
    mc.isparkBilgiYaz();
  }
});

document.querySelector("#katmanBtn")?.addEventListener("click", async () => {
  (await getModal()).openSettings();
});

document.querySelector("#konumBtn")?.addEventListener("click", async () => {
  S.konumHata = null;
  S.semt = null;
  try {
    await mc.benimKonum(false);
    if (S.ben) mc.map.setView([S.ben.lat, S.ben.lon], 15);
  } catch (err) {
    S.konumHata = hataMesaji(err);
  }
  ciz(true);
});

document.querySelector("#secimIptal")?.addEventListener("click", (e) => {
  e.stopPropagation();
  routeViewInstance?.secimBitir();
});

// ---------------- Delegated Click & Input Events ----------------
document.addEventListener("click", async (e) => {
  if (e.target.closest("#pwaKurBtn") && deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => {});
    deferredInstallPrompt = null;
    document.querySelector("#pwaBanner")?.remove();
    return;
  }
  if (e.target.closest("#pwaKapatBtn")) {
    deferredInstallPrompt = null;
    document.querySelector("#pwaBanner")?.remove();
    return;
  }

  const ar = e.target.closest("[data-arac]");
  if (ar && sayfa().tur === "hat") {
    e.stopImmediatePropagation();
    return aracAc(sayfa().hat, ar.dataset.arac);
  }

  const ak = e.target.closest("[data-ak]");
  if (ak) {
    const p = sayfa();
    if (ak.dataset.ak === "takip" && p.tur === "arac") {
      const key = p.hat + "/" + p.kapino;
      const cur = mc.getTakipArac();
      mc.setTakipArac(cur === key ? null : key);
      const a = S.arac.get(key);
      if (mc.getTakipArac() && a) mc.map.setView([a.gor.lat, a.gor.lon], Math.max(mc.map.getZoom(), 15));
      return ciz(false);
    }
    if (ak.dataset.ak === "hat") {
      return git({ tur: "hat", hat: ak.dataset.akhat, yon: ak.dataset.akyon });
    }
  }

  const el = e.target.closest(
    "[data-sekme],[data-geri],[data-yenile],[data-fav],[data-hat],[data-yon],[data-gun],[data-durak],[data-odakla],[data-rhat],[data-ist],[data-vhat],[data-ac],[data-tumu],[data-oneri],[data-temizle],[data-degistir],[data-rotabul],[data-rotabul-alt],[data-rota],[data-zaman],[data-rfiltre],[data-bacak-durak],[data-rota-paylas],[data-kayitli],[data-kayitli-duzenle],[data-semt],[data-semt-temizle],[data-yakin-durak],[data-fav-durak],[data-akilli-rota],[data-filo-toggle],[data-bildir-hat],[data-bus-kat],[data-vapur-grup]"
  );
  if (!el) return;
  const d = el.dataset;

  if (d.sekme) {
    S.sekme = d.sekme;
    S.yigin = [];
    syncNav();
    return ciz(true);
  }
  if ("geri" in d) return geri();
  if ("yenile" in d) return ciz(true);
  if (d.fav) {
    e.stopPropagation();
    const i = S.favoriler.indexOf(d.fav);
    if (i >= 0) S.favoriler.splice(i, 1);
    else S.favoriler.push(d.fav);
    KV.set("favoriler", S.favoriler);
    el.innerHTML = iconSvg(i >= 0 ? "star" : "starFill", 20);
    return;
  }
  if (d.hat) return git({ tur: "hat", hat: d.hat });
  if (d.yon) {
    sayfa().yon = d.yon;
    return ciz(false);
  }
  if (d.gun) {
    sayfa().gun = d.gun;
    return ciz(false);
  }
  if (d.durak != null) {
    const p = sayfa();
    const dd = S.hatVeri[p.hat]?.duraklar?.[p.yon]?.[+d.durak];
    if (!dd) return;
    mc.map.setView([dd.lat, dd.lon], 16);
    L.popup().setLatLng([dd.lat, dd.lon]).setContent(mc.durakPopup(p.hat, dd)).openOn(mc.map);
    return;
  }
  if (d.odakla) {
    const [hat, kapino] = d.odakla.split("/");
    if (hat && kapino) mc.aracOdakla(hat, kapino);
    return;
  }
  if (d.rhat) return git({ tur: "rhat", id: d.rhat === "MR" ? "MR" : +d.rhat });
  if (d.ist) return git({ tur: "ist", id: String(d.ist).startsWith("mr:") ? d.ist : +d.ist });
  if (d.vhat) return git({ tur: "vhat", url: d.vhat });
  if (d.ac) {
    Bridge.call("open", { url: d.ac }).catch(() => {});
    return;
  }
  if ("tumu" in d) {
    const p = sayfa();
    p.tumu = !p.tumu;
    return ciz(false);
  }
  if (d.oneri != null) {
    const y = S.rota.gosterilen?.[+d.oneri];
    if (y) (await getRouteView()).yerSec(y);
    return;
  }
  if (d.temizle) {
    S.rota[d.temizle] = null;
    S.rota.aktif = d.temizle;
    S.rota.metin = "";
    S.rota.sonuclar = null;
    return ciz(false);
  }
  if ("degistir" in d) {
    const R = S.rota;
    [R.nereden, R.nereye] = [R.nereye, R.nereden];
    R.aktif = !R.nereden ? "nereden" : !R.nereye ? "nereye" : null;
    R.sonuclar = null;
    ciz(true);
    if (R.nereden && R.nereye) (await getRouteView()).rotaBul();
    return;
  }
  if ("rotabul" in d) return (await getRouteView()).rotaBul();
  if ("rotabulAlt" in d) {
    S.sekme = "rota";
    S.yigin = [];
    syncNav();
    return (await getRouteView()).rotaBul();
  }
  if (d.zaman) {
    const R = S.rota;
    if (d.zaman === "simdi") {
      R.zaman = null;
      ciz(false);
      if (R.nereden && R.nereye) (await getRouteView()).rotaBul();
      return;
    }
    if (!R.zaman) {
      const z = new Date(Date.now() + 3600e3);
      z.setMinutes(Math.ceil(z.getMinutes() / 15) * 15, 0, 0);
      const p2 = (n) => String(n).padStart(2, "0");
      R.zaman = `${z.getFullYear()}-${p2(z.getMonth() + 1)}-${p2(z.getDate())}T${p2(z.getHours())}:${p2(z.getMinutes())}`;
    }
    await ciz(false);
    const zEl = document.querySelector("#zamanSec");
    if (zEl) {
      zEl.focus();
      try {
        zEl.showPicker?.();
      } catch {
        // ignore
      }
    }
    return;
  }
  if (d.rfiltre) {
    S.rota.filtre = d.rfiltre;
    return ciz(false);
  }
  if (d.rota != null) return git({ tur: "rdetay", i: +d.rota });
  if (d.bacakDurak != null) {
    const p = sayfa();
    const i = +d.bacakDurak;
    p.acikBacak = p.acikBacak === i ? null : i;
    return ciz(false);
  }
  if (d.rotaPaylas != null) return (await getRouteView()).shareRoute(+d.rotaPaylas);
  if (d.kayitli) return (await getRouteView()).handleSavedPlace(d.kayitli, false);
  if (d.kayitliDuzenle) return (await getRouteView()).handleSavedPlace(d.kayitliDuzenle, true);
  if (d.akilliRota) {
    const target = S.savedPlaces?.[d.akilliRota];
    if (target) return (await getRouteView()).setRoutePlace("nereye", target);
    return;
  }
  if ("filoToggle" in d) {
    S.filoRadar = !S.filoRadar;
    if (S.filoRadar) await mc.filoRadarYukle(true);
    else mc.filoKatmani.clearLayers();
    return ciz(false);
  }
  if (d.bildirHat) {
    const hat = d.bildirHat;
    const durakKod = d.bildirDurak;
    const durakAd = d.bildirAd || durakKod;
    const yon = d.bildirYon || "";
    const watches = typeof NotificationEngine?.getWatches === "function" ? NotificationEngine.getWatches() : [];
    const existing = watches.find((w) => w.hat === hat && w.durakKod === durakKod);
    if (existing) {
      NotificationEngine.unwatch?.(existing.id || `${hat}|${durakKod}`);
    } else {
      NotificationEngine.watchStopBus?.({ hat, durakKod, durakAd, yon, thresholdMin: 3 });
      NotificationEngine.notifyToast?.(`🔔 ${hat} → ${durakAd} (${t("eta.notify3m")})`);
    }
    return ciz(false);
  }
  if (d.semt) {
    const hub = HIZLI_SEMTLER.find((s) => s.ad === d.semt);
    if (!hub) return;
    S.semt = S.semt?.ad === hub.ad ? null : hub;
    if (S.semt) mc.map.setView([hub.lat, hub.lon], 15);
    return ciz(true);
  }
  if ("semtTemizle" in d) {
    S.semt = null;
    if (S.ben) mc.map.setView([S.ben.lat, S.ben.lon], 15);
    return ciz(true);
  }
  if (d.yakinDurak != null) {
    const st = nearbyCache[+d.yakinDurak];
    if (!st) return;
    if (st.tur === "otobus") return (await getModal()).openStopBoard(st);
    if (st.tur === "rayli" || st.tur === "marmaray") return git({ tur: "ist", id: st.id });
    if (st.tur === "vapur") {
      S.sekme = "vapur";
      S.yigin = [];
      syncNav();
      return ciz(true);
    }
  }
  if (d.favDurak != null) {
    const st = S.favoriDuraklar?.[+d.favDurak];
    if (st) return (await getModal()).openStopBoard(st);
    return;
  }
  if (d.busKat) {
    S.busKat = d.busKat;
    return ciz(false);
  }
  if (d.vapurGrup) {
    S.vapurGrup = d.vapurGrup;
    return ciz(false);
  }
});

document.addEventListener("change", async (e) => {
  if (e.target.id !== "zamanSec") return;
  const R = S.rota;
  R.zaman = e.target.value || null;
  if (R.nereden && R.nereye) (await getRouteView()).rotaBul();
  else ciz(false);
});

document.addEventListener("focusin", (e) => {
  const alan = e.target.dataset?.alan;
  if (!alan) return;
  const R = S.rota;
  if (R.aktif === alan) return;
  R.aktif = alan;
  R.metin = "";
  R.oneriler = [];
  ciz(false);
});

let aramaZaman = null;
document.addEventListener("input", async (e) => {
  if (e.target.dataset?.alan) {
    S.rota.metin = e.target.value;
    (await getRouteView()).yerAramaYap();
    return;
  }
  if (e.target.id === "ara") {
    S.arama = e.target.value;
    clearTimeout(aramaZaman);
    aramaZaman = setTimeout(() => ciz(false), 220);
  } else if (e.target.id === "rayliAra") {
    S.rayliArama = e.target.value;
    clearTimeout(aramaZaman);
    aramaZaman = setTimeout(() => ciz(false), 200);
  } else if (e.target.id === "vapurAra") {
    S.vapurArama = e.target.value;
    clearTimeout(aramaZaman);
    aramaZaman = setTimeout(() => ciz(false), 200);
  }
});

// ---------------- Bottom Sheet Touch Drag ----------------
(() => {
  const panel = panelEl();
  if (!panel) return;
  let y0 = null, x0 = 0, dy = 0, bastan = false, surukle = false, iptal = false, k0 = "normal", ust0 = true;

  panel.addEventListener(
    "touchstart",
    (e) => {
      const touch = e.touches[0];
      y0 = touch.clientY;
      x0 = touch.clientX;
      dy = 0;
      surukle = false;
      iptal = false;
      k0 = panelKonum();
      const ic = document.querySelector("#icerik");
      ust0 = !ic || ic.scrollTop <= 0;
      const ust = touch.clientY - panel.getBoundingClientRect().top < 56;
      bastan = Boolean(e.target.closest("#tutamak")) || k0 === "tam" || (ust && !e.target.closest("input,select,textarea,button"));
    },
    { passive: true }
  );

  panel.addEventListener(
    "touchmove",
    (e) => {
      if (y0 == null || iptal) return;
      const touch = e.touches[0];
      dy = touch.clientY - y0;
      if (!surukle && Math.abs(touch.clientX - x0) > Math.abs(dy) + 6) {
        iptal = true;
        return;
      }
      const izin = surukle || bastan || (dy > 0 && ust0);
      if (!izin || Math.abs(dy) < 6) return;
      if (k0 === "genis" && dy < 0 && !bastan) return;
      if (k0 === "tam" && dy > 0) return;
      surukle = true;
      e.preventDefault();
      panel.classList.add("suruk");
      const sin =
        k0 === "tam"
          ? [-window.innerHeight * 0.8, 0]
          : k0 === "genis"
          ? [0, window.innerHeight * 0.8]
          : [-window.innerHeight * 0.3, window.innerHeight * 0.5];
      panel.style.transform = `translateY(${Math.max(sin[0], Math.min(sin[1], dy))}px)`;
    },
    { passive: false }
  );

  const bitir = () => {
    panel.classList.remove("suruk");
    panel.style.transform = "";
    if (surukle) {
      const H = window.innerHeight;
      let k = k0;
      if (k0 === "normal") k = dy > 70 ? "tam" : dy < -60 ? "genis" : "normal";
      else if (k0 === "genis") k = dy > H * 0.45 ? "tam" : dy > 60 ? "normal" : "genis";
      else if (k0 === "tam") k = dy < -H * 0.5 ? "genis" : dy < -40 ? "normal" : "tam";
      if (k !== k0) panelAyarla(k);
    }
    y0 = null;
    surukle = false;
  };

  panel.addEventListener("touchend", bitir);
  panel.addEventListener("touchcancel", bitir);
  panel.addEventListener(
    "click",
    (e) => {
      const k = panelKonum();
      if (k === "tam") {
        e.stopPropagation();
        e.preventDefault();
        panelAyarla("normal");
        return;
      }
      if (e.target.closest("#tutamak")) {
        panelAyarla(k === "genis" ? "normal" : "genis");
      }
    },
    true
  );
})();

// ---------------- History & Capacitor Back Button ----------------
window.addEventListener("popstate", () => {
  if (modalInstance?.isOpen()) {
    modalInstance.close();
    return;
  }
  if (S.yigin.length) {
    geri(true);
  }
});

App.addListener("backButton", () => {
  if (modalInstance?.isOpen()) {
    modalInstance.close();
    return;
  }
  if (panelKonum() === "genis") {
    panelAyarla("normal");
    return;
  }
  if (S.yigin.length) {
    geri(true);
    return;
  }
  App.exitApp();
}).catch(() => {});

// ---------------- PWA Service Worker & Install Prompt ----------------
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (sayfa().tur === "yakin") panelYenile();
});

// ---------------- Periodic Loops ----------------
setInterval(() => mc.canliTur(), CANLI_SN * 1000);
setInterval(() => {
  if (!document.hidden) {
    mc.oluHesap();
    mc.tahminiCiz();
    surgicalLiveUpdate();
  }
}, 1000);
setInterval(() => {
  if (!document.hidden) {
    if (S.trafik) mc.trafikYukle(true);
    if (S.ispark) mc.isparkYukle(true);
    if (S.filoRadar) mc.filoRadarYukle(true);
  }
}, 120e3);
setInterval(() => {
  const p = sayfa();
  if (!document.hidden && (p.tur === "ist" || p.tur === "yakin")) ciz(false);
}, 60e3);

// ---------------- Bootstrap ----------------
async function bootstrap() {
  initLang();
  ensureToastContainer();

  const [f, fd, d, s, sp, th, ms, pr, tr, ip, lg] = await Promise.all([
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

  if (lg === "tr" || lg === "en") setLang(lg);
  if (Array.isArray(f)) S.favoriler = f;
  if (Array.isArray(fd)) S.favoriDuraklar = fd;
  if (d && typeof d === "object") S.durak = d;
  if (Array.isArray(s)) S.rota.son = s;
  if (sp && typeof sp === "object") S.savedPlaces = sp;
  if (th) S.theme = th;
  if (ms) S.mapStyle = ms;
  if (pr) {
    S.proxyUrl = pr;
    if (typeof Bridge.setProxyUrl === "function") Bridge.setProxyUrl(pr);
  }

  applyTheme(S.theme);

  S.trafik = Boolean(tr);
  document.querySelector("#trafikBtn")?.classList.toggle("aktif", S.trafik);
  if (S.trafik) mc.trafikYukle();

  S.ispark = Boolean(ip);
  document.querySelector("#isparkBtn")?.classList.toggle("aktif", S.ispark);
  if (S.ispark) mc.isparkYukle();

  if (typeof DataProvider?.connectStream === "function") {
    DataProvider.connectStream({
      onVehicles: (payload) => {
        if (payload?.hat && Array.isArray(payload.vehicles) && S.aktifHatlar.has(payload.hat)) {
          if (mc.konumIsle(payload.hat, payload.vehicles)) {
            mc.aracCiz(payload.hat);
            panelYenile();
          }
        }
      },
      onTraffic: () => {
        if (S.trafik) mc.trafikYukle(true);
      },
    });
  }

  ciz(true);
}

bootstrap();
