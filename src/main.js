/**
 * İstanbul Ulaşım v4.0 — Main Application Bootstrap
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
import { createMapController, esc, hataMesaji } from "./map/mapController.js";
import { createStopModal } from "./views/stopModal.js";
import { createNearbyView, HIZLI_SEMTLER } from "./views/nearbyView.js";
import { createRouteView } from "./views/routeView.js";
import { createBusView } from "./views/busView.js";
import { createRailView } from "./views/railView.js";
import { createFerryView } from "./views/ferryView.js";

const CANLI_SN = 5;

const S = {
  sekme: "yakin",
  yigin: [],
  ben: null,
  semt: null,
  favoriler: ["18K", "14BK"],
  durak: {},
  savedPlaces: { ev: null, is: null },
  hatVeri: {},
  arac: new Map(),
  aktifHatlar: new Set(),
  trafik: false,
  ispark: false,
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
  agVapur: false,
};

let cizimNo = 0;
let panelZamanlayici = null;
let nearbyCache = [];
let deferredInstallPrompt = null;

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
        ${geriVar ? `<button class="btn ikon" data-geri aria-label="Geri" style="width:36px;height:36px;min-width:36px">${iconSvg("chevronLeft", 18)}</button>` : ""}
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

function panelYenile() {
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

// ---------------- Controllers & Views ----------------
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
  openStopBoard: (stop) => modal.openStopBoard(stop),
  openIspark: (park) => modal.openIspark(park),
  openSettings: () => modal.openSettings(),
  setRoutePlace: (alan, yer) => routeView.setRoutePlace(alan, yer),
  applyTheme: (t) => applyTheme(t),
  setNearbyCache: (list) => {
    nearbyCache = list;
  },
};

const mc = createMapController(S, callbacks);
const modal = createStopModal(S, mc, callbacks);
const nearbyView = createNearbyView(S, mc, callbacks);
const routeView = createRouteView(S, mc, callbacks);
const busView = createBusView(S, mc, callbacks);
const railView = createRailView(S, mc, callbacks);
const ferryView = createFerryView(S, mc, callbacks);

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
    routeView.secimBitir();
  }

  const ic = document.querySelector("#icerik");
  if (!ic) return;

  const routes = {
    yakin: (x, i, n) => nearbyView.render(x, i, n),
    rota: (x, i, n) => routeView.render(x, i, n),
    rdetay: (x, i, n) => routeView.renderDetail(x, i, n),
    otobus: (x, i, n) => busView.renderList(x, i, n),
    hat: (x, i, n) => busView.renderLine(x, i, n),
    arac: (x, i, n) => busView.renderVehicle(x, i, n),
    rayli: (x, i, n) => railView.renderList(x, i, n),
    rhat: (x, i, n) => railView.renderLine(x, i, n),
    ist: (x, i, n) => railView.renderStation(x, i, n),
    vapur: (x, i, n) => ferryView.renderList(x, i, n),
    vhat: (x, i, n) => ferryView.renderLine(x, i, n),
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
          <span>Ana ekrana ekleyerek hızlı erişin</span>
          <span style="display:flex;gap:6px">
            <button class="btn kucuk birincil" id="pwaKurBtn">Yükle</button>
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
      baslikHTML("Hata", S.yigin.length > 0) +
      `<div class="duyuru hata"><span class="duyuru-ikon">${iconSvg("alert", 18)}</span><span>${esc(hataMesaji(e))}</span></div>` +
      `<button class="btn" data-yenile>${iconSvg("refresh", 16)} Tekrar Dene</button>`;
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

document.querySelector("#katmanBtn")?.addEventListener("click", () => {
  modal.openSettings();
});

document.querySelector("#konumBtn")?.addEventListener("click", async () => {
  S.konumHata = null;
  S.semt = null;
  try {
    await mc.benimKonum(false);
    if (S.ben) mc.map.setView([S.ben.lat, S.ben.lon], 15);
  } catch (err) {
    S.konumHata = "Konum alınamadı: " + hataMesaji(err);
  }
  ciz(true);
});

document.querySelector("#secimIptal")?.addEventListener("click", (e) => {
  e.stopPropagation();
  routeView.secimBitir();
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

  const t = e.target.closest(
    "[data-sekme],[data-geri],[data-yenile],[data-fav],[data-hat],[data-yon],[data-gun],[data-durak],[data-odakla],[data-rhat],[data-ist],[data-vhat],[data-ac],[data-tumu],[data-oneri],[data-temizle],[data-degistir],[data-rotabul],[data-rota],[data-zaman],[data-rfiltre],[data-bacak-durak],[data-rota-paylas],[data-kayitli],[data-kayitli-duzenle],[data-semt],[data-semt-temizle],[data-yakin-durak],[data-bus-kat],[data-vapur-grup]"
  );
  if (!t) return;
  const d = t.dataset;

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
    t.innerHTML = iconSvg(i >= 0 ? "star" : "starFill", 20);
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
    if (y) routeView.yerSec(y);
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
    if (R.nereden && R.nereye) routeView.rotaBul();
    return;
  }
  if ("rotabul" in d) return routeView.rotaBul();
  if (d.zaman) {
    const R = S.rota;
    if (d.zaman === "simdi") {
      R.zaman = null;
      ciz(false);
      if (R.nereden && R.nereye) routeView.rotaBul();
      return;
    }
    if (!R.zaman) {
      const z = new Date(Date.now() + 3600e3);
      z.setMinutes(Math.ceil(z.getMinutes() / 15) * 15, 0, 0);
      const p2 = (n) => String(n).padStart(2, "0");
      R.zaman = `${z.getFullYear()}-${p2(z.getMonth() + 1)}-${p2(z.getDate())}T${p2(z.getHours())}:${p2(z.getMinutes())}`;
    }
    await ciz(false);
    const el = document.querySelector("#zamanSec");
    if (el) {
      el.focus();
      try {
        el.showPicker?.();
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
  if (d.rotaPaylas != null) return routeView.shareRoute(+d.rotaPaylas);
  if (d.kayitli) return routeView.handleSavedPlace(d.kayitli, false);
  if (d.kayitliDuzenle) return routeView.handleSavedPlace(d.kayitliDuzenle, true);
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
    if (st.tur === "otobus") return modal.openStopBoard(st);
    if (st.tur === "rayli" || st.tur === "marmaray") return git({ tur: "ist", id: st.id });
    if (st.tur === "vapur") {
      S.sekme = "vapur";
      S.yigin = [];
      syncNav();
      return ciz(true);
    }
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

document.addEventListener("change", (e) => {
  if (e.target.id !== "zamanSec") return;
  const R = S.rota;
  R.zaman = e.target.value || null;
  if (R.nereden && R.nereye) routeView.rotaBul();
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
document.addEventListener("input", (e) => {
  if (e.target.dataset?.alan) {
    S.rota.metin = e.target.value;
    routeView.yerAramaYap();
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
      const t = e.touches[0];
      y0 = t.clientY;
      x0 = t.clientX;
      dy = 0;
      surukle = false;
      iptal = false;
      k0 = panelKonum();
      const ic = document.querySelector("#icerik");
      ust0 = !ic || ic.scrollTop <= 0;
      const ust = t.clientY - panel.getBoundingClientRect().top < 56;
      bastan = Boolean(e.target.closest("#tutamak")) || k0 === "tam" || (ust && !e.target.closest("input,select,textarea,button"));
    },
    { passive: true }
  );

  panel.addEventListener(
    "touchmove",
    (e) => {
      if (y0 == null || iptal) return;
      const t = e.touches[0];
      dy = t.clientY - y0;
      if (!surukle && Math.abs(t.clientX - x0) > Math.abs(dy) + 6) {
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
  if (modal.isOpen()) {
    modal.close();
    return;
  }
  if (S.yigin.length) {
    geri(true);
  }
});

App.addListener("backButton", () => {
  if (modal.isOpen()) {
    modal.close();
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
  }
}, 1000);
setInterval(() => {
  if (!document.hidden) {
    if (S.trafik) mc.trafikYukle(true);
    if (S.ispark) mc.isparkYukle(true);
  }
}, 120e3);
setInterval(() => {
  const p = sayfa();
  if (!document.hidden && (p.tur === "ist" || p.tur === "yakin")) ciz(false);
}, 60e3);

// ---------------- Bootstrap ----------------
async function bootstrap() {
  const [f, d, s, sp, th, ms, pr, tr, ip] = await Promise.all([
    KV.get("favoriler"),
    KV.get("durak"),
    KV.get("sonYerler"),
    KV.get("savedPlaces"),
    KV.get("theme"),
    KV.get("mapStyle"),
    KV.get("proxyUrl"),
    KV.get("trafik"),
    KV.get("ispark"),
  ]);

  if (Array.isArray(f)) S.favoriler = f;
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

  ciz(true);
}

bootstrap();
