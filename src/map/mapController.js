/**
 * İstanbul Ulaşım v5.0 — Leaflet Map Controller, Live Vehicles, Batched Traffic, Fleet Radar & İSPARK
 */
import L from "leaflet";
import { Zaman } from "../core/time.js";
import { Core } from "../core/geo.js";
import { KV } from "../core/storage.js";
import { Bridge } from "../core/bridge.js";
import { API } from "../core/api.js";
import { Plan } from "../core/router.js";
import { iconSvg } from "../ui/icons.js";
import { t } from "../i18n/index.js";
import { DataProvider } from "../engines/dataProvider.js";
import { TrafficEngine } from "../engines/trafficEngine.js";
import { EtaEngine, parseIettGpsTimestamp, STALE_GPS_SEC } from "../engines/etaEngine.js";
import { TrackingEngine } from "../engines/trackingEngine.js";

const RENKLER = ["#e4572e", "#0f62fe", "#0a8f4f", "#8e44ad", "#d97706", "#0891b2", "#be185d", "#4d7c0f"];
const TRAFIK_RENK = { 0: "#9ca3af", 1: "#16a34a", 2: "#84cc16", 3: "#f59e0b", 4: "#dc2626", 5: "#7f1d1d" };

// ---------------- Shared Pure Helpers ----------------
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const bas = (s) =>
  String(s || "")
    .toLocaleLowerCase("tr")
    .replace(/(^|[\s/(.\-])([^\s/(.\-])/g, (_, a, b) => a + b.toLocaleUpperCase("tr"))
    .trim();

export const metre = (m) =>
  m == null ? "" : m < 1000 ? Math.round(m / 10) * 10 + " m" : (m / 1000).toFixed(1) + " km";

export const saat = (dk) => {
  dk = Math.round(dk);
  dk = ((dk % 1440) + 1440) % 1440;
  return String(Math.floor(dk / 60)).padStart(2, "0") + ":" + String(dk % 60).padStart(2, "0");
};

export const sureEtiket = (k) =>
  `<span class="sure ${k != null && k <= 3 ? "yakin" : ""}">${k == null ? "–" : k <= 1 ? esc(t("eta.arriving")) : "~" + Zaman.kalanYazi(Math.round(k))}</span>`;

export const renkKod = (kod) => {
  let h = 0;
  for (const c of String(kod)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return RENKLER[h % RENKLER.length];
};

export const metrobusMu = (h) => Boolean(h && /METROBÜS/i.test(h.tarife || ""));

export const hataMesaji = (e) => {
  const m = String((e && e.message) || e);
  if (/Sunucu hatası|network|Load failed|timed out|Could not connect|offline|Failed to fetch/i.test(m)) {
    return t("common.networkError");
  }
  return m;
};

export { parseIettGpsTimestamp as iettZaman };

// ---------------- Tile Layer Definitions (100% Keyless) ----------------
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
const TILE_LAYERS = {
  light: {
    standart: () =>
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        maxNativeZoom: 19,
        attribution: "© OpenStreetMap · İETT · Metro İstanbul · İBB",
      }),
    sade: () =>
      L.layerGroup([
        L.tileLayer(ESRI + "World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
          maxZoom: 19,
          maxNativeZoom: 16,
          attribution: "© Esri · İETT · Metro İstanbul · İBB",
        }),
        L.tileLayer(ESRI + "World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
          maxZoom: 19,
          maxNativeZoom: 16,
          opacity: 0.9,
        }),
      ]),
    osm: () =>
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        maxNativeZoom: 19,
        attribution: "© OpenStreetMap · İETT · İBB",
      }),
  },
  dark: {
    standart: () =>
      L.layerGroup([
        L.tileLayer(ESRI + "World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
          maxZoom: 19,
          maxNativeZoom: 16,
          attribution: "© Esri · İETT · Metro İstanbul · İBB",
        }),
        L.tileLayer(ESRI + "World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
          maxZoom: 19,
          maxNativeZoom: 16,
          opacity: 0.9,
        }),
      ]),
    sade: () =>
      L.tileLayer(ESRI + "World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        maxNativeZoom: 16,
        attribution: "© Esri · İETT · İBB",
      }),
    osm: () =>
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        maxNativeZoom: 19,
        attribution: "© OpenStreetMap · İETT · İBB",
      }),
  },
};

/**
 * Create and manage the Leaflet map, overlays, and live vehicle animations.
 * @param {object} S - Shared application state
 * @param {object} callbacks - Navigation and modal callbacks from main.js
 */
export function createMapController(S, callbacks) {
  const map = L.map("harita", { zoomControl: false, maxZoom: 19 }).setView([41.03, 29.0], 11);

  let baseLayer = null;
  function updateBaseLayer() {
    const resolvedTheme =
      document.documentElement.dataset.theme === "dark" ||
      (!document.documentElement.dataset.theme && window.matchMedia?.("(prefers-color-scheme: dark)").matches)
        ? "dark"
        : "light";
    const styleKey = S.mapStyle || "standart";
    const factory = TILE_LAYERS[resolvedTheme]?.[styleKey] || TILE_LAYERS[resolvedTheme].standart;
    if (baseLayer) map.removeLayer(baseLayer);
    baseLayer = factory().addTo(map);
    if (typeof baseLayer.bringToBack === "function") baseLayer.bringToBack();
    else if (typeof baseLayer.eachLayer === "function") baseLayer.eachLayer((l) => l.bringToBack?.());
  }

  const trafikCizici = L.canvas({ padding: 0.3 });
  const trafikKatmani = L.layerGroup().addTo(map);
  const isparkKatmani = L.layerGroup().addTo(map);
  const filoKatmani = L.layerGroup().addTo(map);
  const katman = L.layerGroup().addTo(map);
  const aracKatmani = L.layerGroup().addTo(map);
  const durakKatmani = L.layerGroup();
  const hedefKatmani = L.layerGroup().addTo(map);

  const hedefGor = new Set();
  const hedefAdlar = [];
  const tahminiIsaret = new Map();
  let benIsaret = null;
  let benDaire = null;
  let tahminiKaynak = null;
  let takipArac = null;

  map.on("dragstart", () => {
    takipArac = null;
  });

  function zoomAyarla() {
    const z = map.getZoom();
    if (z >= 13) {
      if (!map.hasLayer(durakKatmani)) durakKatmani.addTo(map);
    } else if (map.hasLayer(durakKatmani)) {
      map.removeLayer(durakKatmani);
    }
    map.getContainer().classList.toggle("uzak", z < 13);
  }
  map.on("zoomend", zoomAyarla);

  function haritaTemizle() {
    katman.clearLayers();
    durakKatmani.clearLayers();
    hedefKatmani.clearLayers();
    hedefGor.clear();
    hedefAdlar.length = 0;
    for (const a of S.arac.values()) a.isaret = null;
    aracKatmani.clearLayers();
    tahminiIsaret.clear();
    tahminiKaynak = null;
  }

  function sigdir(noktalar, zoom = 16) {
    const valid = (noktalar || []).filter(Boolean);
    if (!valid.length) return;
    const b = L.latLngBounds(valid);
    if (b.isValid()) map.fitBounds(b, { padding: [28, 28], maxZoom: zoom });
  }

  function benCiz() {
    if (!S.ben) return;
    const ll = [S.ben.lat, S.ben.lon];
    if (!benIsaret) {
      benIsaret = L.marker(ll, {
        icon: L.divIcon({ className: "", html: '<div class="ben-ikon"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
        zIndexOffset: 2000,
        interactive: false,
      }).addTo(map);
      benDaire = L.circle(ll, {
        radius: S.ben.acc || 30,
        color: "#0f62fe",
        weight: 1,
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(map);
    } else {
      benIsaret.setLatLng(ll);
      benDaire.setLatLng(ll).setRadius(S.ben.acc || 30);
    }
  }

  function ucIsaret(ll, tip = "baslangic") {
    const cls = tip === "varis" ? "uc-ikon varis" : "uc-ikon";
    const harf = tip === "varis" ? "B" : "A";
    return L.marker(ll, {
      icon: L.divIcon({ className: "", html: `<div class="${cls}"><span>${harf}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 30] }),
      zIndexOffset: 1500,
    });
  }

  function aracIkon(tur, renk, aci, etiket, tahmini) {
    const iconName = ["otobus", "mb", "metro", "marmaray", "tram", "fun", "tf", "vapur"].includes(tur) ? tur : "otobus";
    const svg = iconSvg(iconName, 14);
    const ok =
      aci == null
        ? ""
        : `<svg style="position:absolute;inset:-6px;width:40px;height:40px;transform:rotate(${Math.round(aci)}deg);pointer-events:none" viewBox="0 0 38 38"><path d="M19 1 L24 7 H14 Z" fill="${esc(renk)}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    return L.divIcon({
      className: "arac" + (tahmini ? " tahmini" : ""),
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      html:
        (!tahmini ? '<div class="halka"></div>' : "") +
        ok +
        `<div class="govde" style="background:${esc(renk)}">${svg}${etiket ? `<span class="yazi">${esc(etiket)}</span>` : ""}</div>`,
    });
  }

  // ---------------- Stops & Route Polylines ----------------
  function durakPopup(hat, d) {
    const el = document.createElement("div");
    const sec = S.durak[hat] === d.kod;
    let yonY = "";
    const v = S.hatVeri[hat];
    if (v?.duraklar) {
      for (const l of Object.values(v.duraklar)) {
        if (l.some((x) => x.kod === d.kod)) {
          yonY = "→ " + bas(l[l.length - 1].ad) + " yönü";
          break;
        }
      }
    }
    el.innerHTML = `<b>${esc(bas(d.ad))}</b><br><span class="soluk" style="font-size:12px">${esc(yonY)}${yonY ? " · " : ""}Durak ${esc(d.kod)} · ${esc(hat)}</span><br>`;
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;gap:6px;margin-top:8px;flex-wrap:wrap";

    const b = document.createElement("button");
    b.className = "btn kucuk";
    b.textContent = sec ? `${t("nearby.myStop")} ✓ (${t("common.clear")})` : t("nearby.myStop");
    b.onclick = () => {
      if (sec) delete S.durak[hat];
      else S.durak[hat] = d.kod;
      KV.set("durak", S.durak);
      map.closePopup();
      callbacks.ciz();
    };
    wrap.appendChild(b);

    const panoBtn = document.createElement("button");
    panoBtn.className = "btn kucuk birincil";
    panoBtn.textContent = t("modal.stopBoard");
    panoBtn.onclick = () => {
      map.closePopup();
      callbacks.openStopBoard({ ad: bas(d.ad), kod: d.kod, lat: d.lat, lon: d.lon, tur: "otobus" });
    };
    wrap.appendChild(panoBtn);

    el.appendChild(wrap);
    return el;
  }

  function durakIsaretle(hat, d, renk) {
    if (hedefGor.has(d.kod)) return;
    hedefGor.add(d.kod);
    const m = L.circleMarker([d.lat, d.lon], {
      radius: 8,
      color: "#fff",
      weight: 3,
      fillColor: renk,
      fillOpacity: 1,
    })
      .bindPopup(() => durakPopup(hat, d))
      .addTo(hedefKatmani);

    if (!hedefAdlar.some((x) => x.ad === d.ad && Core.mesafe(x, d) < 250)) {
      hedefAdlar.push(d);
      m.bindTooltip(esc(bas(d.ad)), {
        permanent: true,
        direction: "top",
        offset: [0, -8],
        className: "durak-etiket",
      });
    }
  }

  function guzergahCiz(hat, sadeceYon) {
    const v = S.hatVeri[hat];
    if (!v?.duraklar) return [];
    const pts = [];
    for (const [yon, liste] of Object.entries(v.duraklar)) {
      if (sadeceYon && yon !== sadeceYon) continue;
      const ll = liste.map((d) => [d.lat, d.lon]);
      pts.push(...ll);
      L.polyline(ll, { color: v.renk, weight: 3.5, opacity: 0.8, interactive: false }).addTo(katman);
      for (const d of liste) {
        const sec = S.durak[hat] === d.kod;
        L.circleMarker([d.lat, d.lon], {
          radius: sec ? 6.5 : 4,
          color: v.renk,
          weight: 2,
          fillColor: sec ? v.renk : "#fff",
          fillOpacity: 1,
        })
          .bindPopup(() => durakPopup(hat, d))
          .addTo(sec ? katman : durakKatmani);
      }
      zoomAyarla();
    }
    return pts;
  }

  // ---------------- Live İETT Vehicles & Dead-Reckoning ----------------
  async function hatHazirla(hat) {
    let v = S.hatVeri[hat];
    if (!v) v = S.hatVeri[hat] = { renk: renkKod(hat) };
    if (!v.duraklar) {
      const [bilgi, duraklar] = await Promise.all([API.iett.hat(hat).catch(() => null), API.iett.duraklar(hat)]);
      if (!bilgi && !Object.keys(duraklar || {}).length) throw new Error(`${hat} hattı bulunamadı`);
      v.bilgi = bilgi;
      v.duraklar = duraklar;
      v.mb = metrobusMu(bilgi);
      if (v.mb) v.renk = "#d9381e";
      v.hiz = Core.ortalamaHiz({ uzunlukKm: bilgi?.km, seferSuresiDk: bilgi?.dk });
      if (v.mb) v.hiz = Math.max(v.hiz, 25);
    }
    return v;
  }

  function konumIsle(hat, liste) {
    const v = S.hatVeri[hat];
    let degisti = false;
    const gor = new Set();
    const now = Date.now();
    for (const b of liste || []) {
      if (!Core.gecerliKonum(b) || Math.abs(b.lat) > 90 || Math.abs(b.lon) > 180) continue;
      const k = hat + "/" + b.kapino;
      gor.add(k);
      const ms = parseIettGpsTimestamp(b.zaman, now);
      let a = S.arac.get(k);
      if (!a) {
        a = { hat, kapino: b.kapino, gor: { lat: b.lat, lon: b.lon }, gercek: { lat: b.lat, lon: b.lon, ms }, hiz: null };
        S.arac.set(k, a);
        degisti = true;
      } else if (ms == null || a.gercek.ms == null || ms > a.gercek.ms) {
        const dtSec = ms != null && a.gercek.ms != null ? (ms - a.gercek.ms) / 1000 : null;
        if (dtSec != null && dtSec <= STALE_GPS_SEC && now - ms <= STALE_GPS_SEC * 1000) {
          const km = (Core.mesafe(a.gercek, b) / 1000) * 1.15;
          const o = Math.min(70, km / (dtSec / 3600));
          a.hiz = a.hiz == null ? o : a.hiz * 0.5 + o * 0.5;
        } else {
          a.hiz = null;
        }
        a.gercek = { lat: b.lat, lon: b.lon, ms };
        a.gor = { lat: b.lat, lon: b.lon };
        degisti = true;
      }
      if (ms === a.gercek.ms) {
        a.b = b;
        a.yon = b.yon;
      }
    }
    for (const [k, a] of S.arac) {
      if (a.hat === hat && !gor.has(k)) {
        if (a.isaret) aracKatmani.removeLayer(a.isaret);
        S.arac.delete(k);
        degisti = true;
      }
    }
    v.otobusler = liste || [];
    v.zaman = Date.now();
    return degisti;
  }

  function aracHizi(hat, kapino) {
    const v = S.hatVeri[hat];
    const a = S.arac.get(hat + "/" + kapino);
    const ort = v?.hiz || 15;
    if (!a || a.hiz == null) return ort;
    return Math.max(5, Math.min(45, a.hiz * 0.6 + ort * 0.4));
  }

  function aracYeri(liste, a) {
    const s = Core.siradakiDurak(liste, a.gor);
    if (s < 0) return null;
    const mS = Core.mesafe(a.gor, liste[s]);
    if (mS < 60) return { durakta: s, sonraki: s, metre: mS };
    if (s > 0) {
      const mO = Core.mesafe(a.gor, liste[s - 1]);
      if (mO < 40) return { durakta: s - 1, sonraki: s, metre: mS };
      return { sonraki: s, metre: mS, oran: mO / (mO + mS) };
    }
    return { sonraki: s, metre: mS, oran: 0 };
  }

  function hedefDurak(hat, yon) {
    const liste = S.hatVeri[hat]?.duraklar?.[yon];
    if (!liste?.length) return null;
    const secili = S.durak[hat] ? liste.findIndex((d) => d.kod === S.durak[hat]) : -1;
    if (secili >= 0) return { i: secili, d: liste[secili], secili: true };
    if (S.durak[hat]) {
      const tum = Object.values(S.hatVeri[hat].duraklar).flat().find((d) => d.kod === S.durak[hat]);
      if (tum) {
        const r = Core.enYakinIndex(liste, tum);
        if (r.metre < 400) return { i: r.index, d: liste[r.index], secili: true };
      }
    }
    if (S.ben) {
      const r = Core.enYakinIndex(liste, S.ben);
      return { i: r.index, d: liste[r.index], metre: r.metre };
    }
    return null;
  }

  function yaklasanOtobusler(hat, yon, hedefIndex) {
    const v = S.hatVeri[hat];
    const liste = v?.duraklar?.[yon];
    if (!liste) return [];
    const now = Date.now();
    const ctx = {
      hatBilgi: v.bilgi,
      trafficEngine: Trafik.zaman ? TrafficEngine : undefined,
    };
    return (v.otobusler || [])
      .filter((b) => b.yon === yon)
      .map((b) => {
        const a = S.arac.get(hat + "/" + b.kapino);
        const ms = parseIettGpsTimestamp(b.zaman, now);
        const tracked = a && ms != null && ms === a.gercek.ms && Math.round((now - ms) / 1000) <= STALE_GPS_SEC &&
          b.lat === a.gercek.lat && b.lon === a.gercek.lon;
        const p = tracked ? { ...b, lat: a.gor.lat, lon: a.gor.lon } : b;
        const observedSpeedKmH = tracked ? a.hiz : null;
        const eta = EtaEngine.predict(liste, p, hedefIndex, { ...ctx, observedSpeedKmH });
        const gozlenen = Boolean(eta && eta.guven !== "low" && (observedSpeedKmH >= 4 || eta.trafficFactored));
        return { bus: b, t: eta, gozlenen };
      })
      .filter((x) => x.t)
      .sort((a, b) => a.t.metre - b.t.metre);
  }

  function aracCiz(hat) {
    const v = S.hatVeri[hat];
    if (!v) return;
    for (const a of S.arac.values()) {
      if (a.hat !== hat) continue;
      const liste = v.duraklar?.[a.yon] || [];
      const s = liste.length ? Core.siradakiDurak(liste, a.gor) : -1;
      const aci = s >= 0 ? Core.yonAcisi(a.gor, liste[s]) : null;
      const ikon = aracIkon(v.mb ? "mb" : "otobus", v.renk, aci, hat, false);
      if (!a.isaret) {
        a.isaret = L.marker([a.gor.lat, a.gor.lon], { icon: ikon, zIndexOffset: 500 })
          .on("click", () => callbacks.aracAc(a.hat, a.kapino))
          .addTo(aracKatmani);
        a.aci = aci;
      } else {
        a.isaret.setLatLng([a.gor.lat, a.gor.lon]);
        if (aci == null || a.aci == null || Math.abs(aci - a.aci) > 12) {
          a.isaret.setIcon(ikon);
          a.aci = aci;
        }
      }
    }
  }

  function aktifHatlarAyarla(hatlar) {
    const yeni = new Set(hatlar);
    for (const a of S.arac.values()) {
      if (!yeni.has(a.hat)) {
        if (a.isaret) aracKatmani.removeLayer(a.isaret);
        a.isaret = null;
      }
    }
    S.aktifHatlar = yeni;
  }

  // Smooth 1-second bus dead-reckoning + rAF interpolation
  let rafId = null;
  let lastRafMs = 0;

  function stepRaf(ts) {
    rafId = null;
    if (document.hidden || !S.arac.size) return;
    const dt = lastRafMs ? Math.min(0.1, (ts - lastRafMs) / 1000) : 0.016;
    lastRafMs = ts;
    if (typeof TrackingEngine?.stepAnimations === "function") {
      const updated = TrackingEngine.stepAnimations(S.arac, dt);
      if (updated) {
        for (const a of S.arac.values()) {
          if (a.isaret && a.animGor) {
            a.isaret.setLatLng([a.animGor.lat, a.animGor.lon]);
          }
        }
      }
    }
    if (S.arac.size && !document.hidden) {
      rafId = requestAnimationFrame(stepRaf);
    }
  }

  function ensureRaf() {
    if (!rafId && typeof requestAnimationFrame === "function" && S.arac.size && !document.hidden) {
      lastRafMs = 0;
      rafId = requestAnimationFrame(stepRaf);
    }
  }

  function oluHesap() {
    for (const a of S.arac.values()) {
      if (!a.isaret) continue;
      const v = S.hatVeri[a.hat];
      const liste = v?.duraklar?.[a.yon];
      if (!liste?.length) continue;
      if (a.gercek.ms == null) continue;
      const gecen = (Date.now() - a.gercek.ms) / 1000;
      if (gecen > 150 || (a.hiz != null && a.hiz < 3)) continue;
      let kalan = (aracHizi(a.hat, a.kapino) * 0.85) / 3.6;
      let p = { ...a.gor };
      let i = Core.siradakiDurak(liste, p);
      if (Core.mesafe(p, a.gercek) > 1500) continue;
      while (kalan > 0 && i >= 0 && i < liste.length) {
        const h = liste[i];
        const m = Core.mesafe(p, h);
        if (m > kalan) {
          const f = kalan / m;
          p = { lat: p.lat + (h.lat - p.lat) * f, lon: p.lon + (h.lon - p.lon) * f };
          kalan = 0;
        } else {
          p = { lat: h.lat, lon: h.lon };
          kalan -= m;
          i++;
        }
      }
      a.gor = p;
      if (!a.animGor) a.isaret.setLatLng([p.lat, p.lon]);
    }
    ensureRaf();
    if (takipArac) {
      const t = S.arac.get(takipArac);
      if (t?.isaret) map.panTo([t.gor.lat, t.gor.lon], { animate: true, duration: 0.8 });
      else takipArac = null;
    }
  }

  let canliCalisiyor = false;
  async function canliTur() {
    if (canliCalisiyor || document.hidden || !S.aktifHatlar.size) return;
    canliCalisiyor = true;
    let degisti = false;
    try {
      await Promise.all(
        [...S.aktifHatlar].map(async (hat) => {
          try {
            await hatHazirla(hat);
            const l = await API.iett.konum(hat);
            if (S.aktifHatlar.has(hat) && konumIsle(hat, l)) {
              degisti = true;
              aracCiz(hat);
            }
          } catch {
            // ignore transient network errors
          }
        })
      );
    } finally {
      canliCalisiyor = false;
    }
    if (degisti) {
      const p = callbacks.sayfa();
      if (["yakin", "hat", "rdetay", "arac"].includes(p.tur)) callbacks.panelYenile();
    }
  }

  // ---------------- Estimated Rail & Ferry Markers ----------------
  function tahminiAyarla(kaynak) {
    tahminiKaynak = kaynak;
    tahminiCiz();
  }

  function tahminiCiz() {
    if (!tahminiKaynak) return;
    const simdi = Zaman.simdi() + new Date().getSeconds() / 60;
    const gor = new Set();
    const koy = (key, ll, tur, renk, aci, etiket, ipucu) => {
      gor.add(key);
      let m = tahminiIsaret.get(key);
      if (!m) {
        m = L.marker(ll, { icon: aracIkon(tur, renk, aci, etiket, true), zIndexOffset: 400 })
          .bindPopup(ipucu)
          .addTo(aracKatmani);
        m._aci = aci;
        tahminiIsaret.set(key, m);
      } else {
        m.setLatLng(ll);
        if (Math.abs((m._aci ?? 0) - (aci ?? 0)) > 15) {
          m.setIcon(aracIkon(tur, renk, aci, etiket, true));
          m._aci = aci;
        }
        m.setPopupContent(ipucu);
      }
    };

    for (const tr of tahminiKaynak.seferler || []) {
      const { d, t } = tr;
      if (!d?.length || simdi < t[0] || simdi > t[t.length - 1]) continue;
      let k = 0;
      while (k < t.length - 2 && simdi > t[k + 1]) k++;
      const f = t[k + 1] > t[k] ? (simdi - t[k]) / (t[k + 1] - t[k]) : 0;
      const a = d[k];
      const b = d[k + 1];
      if (!a || !b) continue;
      const ll = [a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f];
      const ip = `<b>${esc(tr.hat)}</b> → ${esc(tr.hedef)}<br>Sıradaki: ${esc(b.ad)} · ${saat(t[k + 1])}<br><span style="opacity:.7;font-size:12px">Tarifeye göre tahmini konum</span>`;
      koy(tr.key, ll, tr.tur, tr.renk, Core.yonAcisi(a, b), tr.hat, ip);
    }

    for (const [k, m] of tahminiIsaret) {
      if (!gor.has(k)) {
        aracKatmani.removeLayer(m);
        tahminiIsaret.delete(k);
      }
    }
  }

  async function rayliTahminiHazirla(hat, istasyonlar) {
    const ag = Plan.kur({ hatlar: [hat], istasyonlar, marmaray: false });
    const yonler = await API.metro.yonler(hat.id).catch(() => []);
    const seferler = [];
    for (const p of ag.desenler) {
      const d = p.d.map((i) => ag.duraklar[i]);
      const toplam = p.t[p.t.length - 1];
      const hedef = Plan.norm(d[d.length - 1].ad);
      const bas0 = Plan.norm(d[0].ad);
      const y = yonler.find((x) => {
        const [a, b] = x.ad.split("->").map(Plan.norm);
        return (
          (b && (b.startsWith(hedef.slice(0, 5)) || hedef.startsWith(b.slice(0, 5)))) ||
          (a && a.startsWith(bas0.slice(0, 5)))
        );
      });
      let kalkislar = [];
      if (y) {
        try {
          const geri = new Date(Date.now() - (toplam + 3) * 60000);
          const p2 = (n) => String(n).padStart(2, "0");
          const iso = `${geri.getFullYear()}-${p2(geri.getMonth() + 1)}-${p2(geri.getDate())}T${p2(geri.getHours())}:${p2(geri.getMinutes())}:00`;
          const j = JSON.parse(
            await API.http("https://api.ibb.gov.tr/MetroIstanbul/api/MetroMobile/V2/GetTimeTable", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ BoardingStationId: d[0].istId, LineId: hat.id, DirectionId: y.id, DateTime: iso }),
            })
          );
          kalkislar = (j.Data?.[0]?.TimeInfos?.Times || []).map(Zaman.dk).filter((x) => x != null);
        } catch {
          // fallback below
        }
      }
      if (!kalkislar.length) {
        const s = Zaman.simdi();
        for (let k = s - toplam - p.aralik; k <= s + 30; k += p.aralik) kalkislar.push(Math.round(k));
      }
      for (const k of kalkislar) {
        seferler.push({
          key: p.id + "@" + k,
          hat: hat.ad,
          renk: hat.renk,
          tur: p.tur,
          hedef: d[d.length - 1].ad,
          d,
          t: p.t.map((x) => k + x),
        });
      }
    }
    return seferler;
  }

  function marmarayTahminiHazirla() {
    const ag = Plan.kur({ hatlar: [], istasyonlar: [], marmaray: true });
    const seferler = [];
    const s = Zaman.simdi();
    for (const p of ag.desenler) {
      if (p.tur !== "marmaray") continue;
      const d = p.d.map((i) => ag.duraklar[i]);
      const toplam = p.t[p.t.length - 1];
      const ilkKalkis = 360; // 06:00
      for (let k = ilkKalkis; k <= 1440; k += p.aralik) {
        if (k + toplam < s - 2 || k > s + 30) continue;
        seferler.push({
          key: p.id + "@" + k,
          hat: "MR",
          renk: p.renk || "#1d4ed8",
          tur: "marmaray",
          hedef: d[d.length - 1].ad,
          d,
          t: p.t.map((x) => k + x),
        });
      }
    }
    return seferler;
  }

  // ---------------- Traffic Overlay (Batched 5-Layer Canvas + Incidents) ----------------
  const Trafik = { geo: null, ana: null, spatialIndex: null, veri: null, indeks: null, incidents: [], zaman: 0, yukleniyor: false };

  function trafikBilgiYaz(mesaj) {
    const el = document.querySelector("#trafikBilgi");
    if (!el) return;
    if (!S.trafik) {
      el.innerHTML = "";
      return;
    }
    if (mesaj) {
      el.textContent = mesaj;
      return;
    }
    const i = Trafik.indeks;
    const ti = i ? t("traffic.index", { ti: esc(i.TI) }) : t("traffic.title");
    const bolge = i ? ` · And %${esc(i.TI_An)} · Avr %${esc(i.TI_Av)}` : "";
    const bar = [1, 2, 3, 4, 5].map((k) => `<i style="display:inline-block;width:10px;height:4px;border-radius:2px;background:${TRAFIK_RENK[k]}"></i>`).join("");
    el.innerHTML = `<span>${ti}${bolge}</span><span style="display:inline-flex;gap:2px;align-items:center">${bar}</span>`;
  }

  function olayCiz() {
    if (!S.trafik || !Array.isArray(Trafik.incidents) || !Trafik.incidents.length) return;
    const b = map.getBounds().pad(0.15);
    let count = 0;
    for (const inc of Trafik.incidents) {
      const lat = Number(inc.lat);
      const lon = Number(inc.lon);
      if (!isFinite(lat) || !isFinite(lon) || !b.contains([lat, lon])) continue;
      const tip = inc.type || inc.tur || "other";
      const kaza = tip === "accident" || /kaza/i.test(inc.title || inc.description || "");
      const icon = L.divIcon({
        className: "",
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        html: `<div class="olay-pin ${kaza ? "kaza" : ""}" title="${esc(inc.title || "")}">!</div>`,
      });
      const tipEtiket = t(`traffic.incidentType.${kaza ? "accident" : tip === "roadwork" ? "roadwork" : tip === "congestion" ? "congestion" : "other"}`);
      const popupHtml = `
        <div style="min-width:170px">
          <div style="font-weight:800;margin-bottom:4px;color:${kaza ? "var(--hata)" : "var(--uyari)"}">${esc(tipEtiket)}</div>
          ${inc.title || inc.road ? `<div style="font-weight:600;margin-bottom:3px">${esc(inc.title || inc.road)}</div>` : ""}
          ${inc.description ? `<div style="font-size:12px;opacity:.85">${esc(inc.description)}</div>` : ""}
          ${inc.time ? `<div style="font-size:11px;opacity:.65;margin-top:4px">${esc(inc.time)}</div>` : ""}
        </div>`;
      L.marker([lat, lon], { icon, zIndexOffset: 650 })
        .bindPopup(popupHtml)
        .addTo(trafikKatmani);
      if (++count >= 60) break;
    }
  }

  function trafikCiz() {
    trafikKatmani.clearLayers();
    if (!S.trafik || !Trafik.geo || !Trafik.veri) return;
    const z = map.getZoom();
    const b = map.getBounds().pad(0.15);
    const kalin = z < 12 ? 2.5 : z < 15 ? 4 : 6;

    if (typeof TrafficEngine?.getVisibleBatchedPolylines === "function" && Trafik.spatialIndex) {
      const batches = TrafficEngine.getVisibleBatchedPolylines(Trafik.spatialIndex, Trafik.veri, b, z) || [];
      let drawn = 0;
      for (const batch of batches) {
        const latlngs = batch.latlngs || batch.coords || batch.lines;
        if (!latlngs?.length) continue;
        L.polyline(latlngs, {
          renderer: trafikCizici,
          color: batch.color || TRAFIK_RENK[batch.level] || "#999",
          weight: kalin,
          opacity: 0.85,
          interactive: false,
        }).addTo(trafikKatmani);
        if (++drawn >= 5) break;
      }
      olayCiz();
      return;
    }

    // Fallback batched by level (max 5 polylines)
    const s = b.getSouth(), w = b.getWest(), n = b.getNorth(), e = b.getEast();
    const sadeceAna = z < 13;
    const adim = z < 12 ? 6 : z < 14 ? 2 : 1;
    const buckets = new Map();
    for (const [id, duz, a, bb, c, d] of Trafik.geo) {
      if (c < s || a > n || d < w || bb > e) continue;
      if (sadeceAna && !Trafik.ana?.has(id)) continue;
      const v = Trafik.veri.get(id);
      if (!v) continue;
      const lvl = Math.min(5, Math.max(1, Number(v[0]) || 1));
      const ll = [];
      for (let i = 0; i < duz.length; i += 2 * adim) ll.push([duz[i], duz[i + 1]]);
      if (duz.length >= 2) ll.push([duz[duz.length - 2], duz[duz.length - 1]]);
      if (!buckets.has(lvl)) buckets.set(lvl, []);
      buckets.get(lvl).push(ll);
    }
    for (const [lvl, multiLatLng] of buckets) {
      L.polyline(multiLatLng, {
        renderer: trafikCizici,
        color: TRAFIK_RENK[lvl] || "#999",
        weight: kalin,
        opacity: 0.85,
        interactive: false,
      }).addTo(trafikKatmani);
    }
    olayCiz();
  }

  async function trafikYukle(zorla) {
    if (Trafik.yukleniyor) return;
    Trafik.yukleniyor = true;
    trafikBilgiYaz(t("traffic.loading"));
    try {
      if (!Trafik.geo) {
        const [g0, g4] = await Promise.all([API.trafik.geometri(0), API.trafik.geometri(4).catch(() => [])]);
        Trafik.geo = g0;
        Trafik.ana = new Set(g4.map((x) => x[0]));
        if (typeof TrafficEngine?.buildSpatialIndex === "function") {
          Trafik.spatialIndex = TrafficEngine.buildSpatialIndex(Trafik.geo, Trafik.ana);
        }
      }
      if (zorla || Date.now() - Trafik.zaman > 110e3) {
        const [veri, indeks, incidents] = await Promise.all([
          API.trafik.veri(),
          API.trafik.indeks(),
          typeof TrafficEngine?.fetchIncidents === "function" ? TrafficEngine.fetchIncidents().catch(() => []) : Promise.resolve([]),
        ]);
        Trafik.veri = veri;
        TrafficEngine.setTrafficData(veri, Trafik.ana);
        Trafik.indeks = indeks;
        Trafik.incidents = Array.isArray(incidents) ? incidents : [];
        Trafik.zaman = Date.now();
      }
      trafikCiz();
      trafikBilgiYaz();
    } catch (e) {
      trafikBilgiYaz(t("traffic.error", { msg: hataMesaji(e) }));
    } finally {
      Trafik.yukleniyor = false;
    }
  }

  // ---------------- İSPARK Live Parking Overlay ----------------
  const Ispark = { liste: null, zaman: 0, yukleniyor: false };

  function normalizeIspark(p) {
    const lat = Number(p.lat ?? p.latitude ?? p.Lat ?? p.LT);
    const lon = Number(p.lon ?? p.lng ?? p.longitude ?? p.Lng ?? p.LN);
    const kapasite = Number(p.kapasite ?? p.capacity ?? p.Capacity ?? 0);
    const bos = Number(p.bos ?? p.emptyCapacity ?? p.EmptyCapacity ?? 0);
    return {
      id: p.id ?? p.parkID ?? p.ParkID,
      ad: p.ad ?? p.parkName ?? p.ParkName ?? "İSPARK Otopark",
      ilce: p.ilce ?? p.district ?? p.District ?? "",
      tip: p.tip ?? p.parkType ?? p.ParkType ?? "",
      kapasite,
      bos,
      saatler: p.saatler ?? p.workHours ?? p.WorkHours ?? "",
      ucretsizDk: Number(p.ucretsizDk ?? p.freeTime ?? p.FreeTime ?? 0),
      isOpen: p.isOpen ?? p.IsOpen ?? 1,
      lat,
      lon,
    };
  }

  function isparkBilgiYaz(mesaj) {
    const el = document.querySelector("#isparkBilgi");
    if (!el) return;
    if (!S.ispark) {
      el.innerHTML = "";
      return;
    }
    if (mesaj) {
      el.textContent = mesaj;
      return;
    }
    const toplam = Ispark.liste?.length || 0;
    const bosOtopark = (Ispark.liste || []).filter((p) => p.bos > 0).length;
    el.innerHTML = `${iconSvg("ispark", 14)} <span>İSPARK · ${bosOtopark}/${toplam} müsait</span>`;
  }

  function isparkCiz() {
    isparkKatmani.clearLayers();
    if (!S.ispark || !Ispark.liste) return;
    const b = map.getBounds().pad(0.2);
    const z = map.getZoom();
    let count = 0;
    const limit = z < 12 ? 120 : 400;

    for (const p of Ispark.liste) {
      if (!isFinite(p.lat) || !isFinite(p.lon)) continue;
      if (!b.contains([p.lat, p.lon])) continue;
      const oran = p.kapasite > 0 ? p.bos / p.kapasite : 0;
      const cls = oran > 0.3 ? "ispark-pin" : oran >= 0.1 ? "ispark-pin az" : "ispark-pin dolu";
      const icon = L.divIcon({
        className: "",
        iconSize: [32, 28],
        iconAnchor: [16, 14],
        html: `<div class="${cls}">${p.bos}</div>`,
      });
      L.marker([p.lat, p.lon], { icon, zIndexOffset: 350 })
        .on("click", () => callbacks.openIspark(p))
        .addTo(isparkKatmani);
      if (++count >= limit) break;
    }
  }

  async function isparkYukle(zorla = false) {
    if (Ispark.yukleniyor) return;
    Ispark.yukleniyor = true;
    isparkBilgiYaz("İSPARK yükleniyor…");
    try {
      if (zorla || !Ispark.liste || Date.now() - Ispark.zaman > 120e3) {
        const fn = API.ispark?.otoparklar || API.ispark?.liste;
        const raw = fn ? await fn() : [];
        Ispark.liste = (raw || []).map(normalizeIspark).filter((p) => isFinite(p.lat) && isFinite(p.lon) && p.lat && p.lon);
        Ispark.zaman = Date.now();
      }
      isparkCiz();
      isparkBilgiYaz();
    } catch (e) {
      isparkBilgiYaz("İSPARK alınamadı: " + hataMesaji(e));
    } finally {
      Ispark.yukleniyor = false;
    }
  }

  // ---------------- Live Fleet Radar (Clustered BBox İETT) ----------------
  const Filo = { araclar: [], zaman: 0, yukleniyor: false };

  function filoRadarCiz() {
    filoKatmani.clearLayers();
    if (!S.filoRadar || !Filo.araclar.length) return;
    const z = map.getZoom();
    const b = map.getBounds();
    const visible =
      typeof TrackingEngine?.filterVisibleVehicles === "function"
        ? TrackingEngine.filterVisibleVehicles(Filo.araclar, b)
        : Filo.araclar.filter((v) => isFinite(v.lat) && isFinite(v.lon) && b.contains([v.lat, v.lon]));

    const items =
      typeof TrackingEngine?.clusterVehicles === "function"
        ? TrackingEngine.clusterVehicles(visible, z, b)
        : visible.slice(0, 120).map((v) => ({ type: "vehicle", ...v }));

    for (const item of items || []) {
      if (item.cluster || item.type === "cluster" || (item.count && item.count > 1)) {
        const count = item.count || item.vehicles?.length || 2;
        const icon = L.divIcon({
          className: "",
          iconSize: [36, 36],
          iconAnchor: [18, 18],
          html: `<div class="filo-kume">${count}</div>`,
        });
        L.marker([item.lat, item.lon], { icon, zIndexOffset: 420 })
          .on("click", () => map.setView([item.lat, item.lon], Math.min(17, z + 2), { animate: true }))
          .addTo(filoKatmani);
      } else {
        const v = item.vehicle || item;
        const hat = v.hat || v.hatKodu || "";
        const kapino = v.kapino || v.kapiNo || "";
        const renk = renkKod(hat || kapino);
        const icon = aracIkon("otobus", renk, v.yonAci ?? null, hat, false);
        L.marker([v.lat, v.lon], { icon, zIndexOffset: 430 })
          .on("click", () => {
            if (hat && kapino) callbacks.aracAc(hat, kapino);
          })
          .addTo(filoKatmani);
      }
    }
  }

  async function filoRadarYukle(zorla = false) {
    if (!S.filoRadar || Filo.yukleniyor) return;
    if (!zorla && Date.now() - Filo.zaman < 12e3 && Filo.araclar.length) {
      filoRadarCiz();
      return;
    }
    Filo.yukleniyor = true;
    try {
      const b = map.getBounds();
      const bbox = { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
      const res = typeof DataProvider?.fetchFleetBbox === "function" ? await DataProvider.fetchFleetBbox(bbox) : [];
      Filo.araclar = Array.isArray(res) ? res : res?.vehicles || [];
      Filo.zaman = Date.now();
      filoRadarCiz();
    } catch {
      // ignore transient fleet radar error
    } finally {
      Filo.yukleniyor = false;
    }
  }

  map.on("moveend zoomend", () => {
    if (S.trafik) trafikCiz();
    if (S.ispark) isparkCiz();
    if (S.filoRadar) filoRadarYukle(false);
  });

  // ---------------- Location ----------------
  async function benimKonum(sessiz = false) {
    try {
      const p = await Bridge.call("location");
      if (p && isFinite(p.lat)) {
        S.ben = p;
        benCiz();
        return p;
      }
    } catch (e) {
      if (!sessiz) throw e;
    }
    return null;
  }

  // ---------------- Tracking & Focusing ----------------
  function setTakipArac(key) {
    takipArac = key;
  }
  function getTakipArac() {
    return takipArac;
  }

  function aracOdakla(hat, kapino) {
    callbacks.aracAc(hat, kapino);
    const a = S.arac.get(hat + "/" + kapino);
    if (a?.isaret) {
      map.setView(a.isaret.getLatLng(), Math.max(map.getZoom(), 15), { animate: true });
    }
  }

  return {
    map,
    katman,
    aracKatmani,
    durakKatmani,
    hedefKatmani,
    trafikKatmani,
    isparkKatmani,
    filoKatmani,
    updateBaseLayer,
    zoomAyarla,
    haritaTemizle,
    sigdir,
    benCiz,
    ucIsaret,
    durakPopup,
    durakIsaretle,
    guzergahCiz,
    hatHazirla,
    konumIsle,
    aracHizi,
    aracYeri,
    hedefDurak,
    yaklasanOtobusler,
    aracCiz,
    aktifHatlarAyarla,
    oluHesap,
    canliTur,
    tahminiAyarla,
    tahminiCiz,
    rayliTahminiHazirla,
    marmarayTahminiHazirla,
    trafikYukle,
    trafikCiz,
    trafikBilgiYaz,
    getTrafikIndeks: () => Trafik.indeks,
    getTrafikIncidents: () => Trafik.incidents || [],
    isparkYukle,
    isparkCiz,
    isparkBilgiYaz,
    filoRadarYukle,
    filoRadarCiz,
    getFiloCount: () => Filo.araclar.length,
    benimKonum,
    setTakipArac,
    getTakipArac,
    aracOdakla,
  };
}
