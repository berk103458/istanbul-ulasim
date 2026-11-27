/**
 * İstanbul Ulaşım v5.0.0 — Lazy-Loaded Bootstrap, Surgical Live DOM Updates & SSE Integration
 */
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./styles/tokens.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/map.css";

import { KV } from "./core/storage.js";
import { Bridge } from "./core/bridge.js";
import { iconSvg } from "./ui/icons.js";
import { initLang, t } from "./i18n/index.js";
import { createMapController, esc, hataMesaji } from "./map/mapController.js";
import { createAppStore } from "./state/store.js";
import { createNearbyView, HIZLI_SEMTLER } from "./views/nearbyView.js";

import { createBottomSheet } from "./app/bottomSheet.js";
import { createLiveUpdates } from "./app/liveUpdates.js";
import { ensureToastContainer, toggleStopWatch } from "./app/notifications.js";
import { bindPlatformEvents } from "./app/platformEvents.js";
import { createPwaInstall } from "./app/pwa.js";
import { createSettings } from "./app/settings.js";

const store = createAppStore();
const S = store.get();

let cizimNo = 0;
let nearbyCache = [];

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

// ---------------- Controllers & Eager Nearby View ----------------
const callbacks = {
  sayfa,
  getCizimNo: () => cizimNo,
  baslikHTML,
  onYukle,
  panelYenile: () => panelYenile(),
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
const bottomSheet = createBottomSheet(mc);
const { panelKonum, panelAyarla } = bottomSheet;
const liveUpdates = createLiveUpdates(S, mc, { sayfa, ciz });
const { panelYenile } = liveUpdates;
const pwaInstall = createPwaInstall(S, { sayfa, panelYenile });
const settings = createSettings(store, mc);
const { applyTheme } = settings;

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

    ic.innerHTML = pwaInstall.renderBanner() + html;

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

settings.bind();

// ---------------- Map Floating Controls ----------------
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
  const installAction = pwaInstall.handleClick(e.target);
  if (installAction) return installAction;

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
    toggleStopWatch(d);
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

bottomSheet.bind();
bindPlatformEvents({
  getModalInstance: () => modalInstance,
  hasHistory: () => S.yigin.length > 0,
  geri,
  panelKonum,
  panelAyarla,
});
pwaInstall.bind();
liveUpdates.startTimers();
// ---------------- Bootstrap ----------------
async function bootstrap() {
  initLang();
  ensureToastContainer();

  await settings.restore();
  liveUpdates.connectStream();
  ciz(true);
}

bootstrap();
