/**
 * İstanbul Ulaşım v5.0 — Yakınımda (Non-Blocking GPS, Smart Commute, Favorite Stops, Corridors & Fleet Radar)
 */
import L from "leaflet";
import { Core } from "../core/geo.js";
import { API } from "../core/api.js";
import { iconSvg } from "../ui/icons.js";
import { t } from "../i18n/index.js";
import { TrafficEngine } from "../engines/trafficEngine.js";
import { esc, bas, metre, renkKod, sureEtiket, hataMesaji } from "../map/mapController.js";
import { accessibleBadgeStyle, bindKeyboardActivators } from "./a11y.js";

export const DEFAULT_HUB = { ad: "Kadıköy", lat: 40.9904, lon: 29.0235, varsayilan: true };

export const HIZLI_SEMTLER = [
  { ad: "Kadıköy", lat: 40.9904, lon: 29.0235 },
  { ad: "Beşiktaş", lat: 41.0422, lon: 29.0067 },
  { ad: "Eminönü", lat: 41.0175, lon: 28.9708 },
  { ad: "Taksim", lat: 41.037, lon: 28.9851 },
  { ad: "Üsküdar", lat: 41.0258, lon: 29.0152 },
  { ad: "Bakırköy", lat: 40.9803, lon: 28.8723 },
  { ad: "Mecidiyeköy", lat: 41.0669, lon: 28.9958 },
];

export function otobusSatiriHTML(hat, x) {
  const key = `${hat}/${x.bus.kapino}`;
  const etaText = x.t.dakika <= 1 ? t("eta.arriving") : t("eta.min", { n: Math.round(x.t.dakika) });
  return `
    <div class="kart satir tik" role="button" tabindex="0" data-odakla="${esc(key)}">
      <div class="kart-sol">
        <div class="bas">
          ${x.t.durakSayisi === 0 ? esc(t("eta.stopNext")) : esc(t("eta.stopsAway", { n: x.t.durakSayisi }))}
          ${x.gozlenen ? `<span class="canli">${esc(t("common.live"))}</span>` : ""}
        </div>
        <div class="alt">
          <span>${esc(t("eta.distanceAway", { m: metre(x.t.metre) }))}</span>
          <span>· ${esc(x.bus.kapino)}</span>
          ${x.gozlenen ? `<span>· ${esc(t("eta.trafficFactored"))}</span>` : ""}
        </div>
      </div>
      <div class="kart-sag" data-live-eta="${esc(key)}" data-live-dk="${Math.round(x.t.dakika)}">${sureEtiket(x.t.dakika).replace(/>[^<]+</, `>${esc(etaText)}<`)}</div>
    </div>`;
}

export function createNearbyView(S, mc, callbacks) {
  bindKeyboardActivators();
  let gpsPending = false;
  let shortcutHandled = false;
  let corridorCache = { data: null, incidents: [], ts: 0 };

  function handleManifestShortcut() {
    if (shortcutHandled || typeof window === "undefined") return false;
    shortcutHandled = true;
    try {
      const tab = new URLSearchParams(window.location.search).get("tab");
      if (tab && ["rota", "otobus", "rayli", "vapur"].includes(tab)) {
        const btn = document.querySelector(`#sekmeler button[data-sekme="${tab}"]`);
        if (btn) {
          queueMicrotask(() => btn.click());
          return true;
        }
      }
    } catch {
      // ignore URL parsing errors
    }
    return false;
  }

  function triggerBackgroundGps() {
    if (gpsPending || S.ben || S.semt) return;
    gpsPending = true;
    mc.benimKonum(true)
      .then((pos) => {
        if (pos && !S.semt && callbacks.sayfa().tur === "yakin") {
          callbacks.ciz(true);
        }
      })
      .catch(() => {})
      .finally(() => {
        gpsPending = false;
      });
  }

  function buildSmartSuggestionHTML(ti) {
    const hour = new Date().getHours();
    const ev = S.savedPlaces?.ev;
    const is = S.savedPlaces?.is;
    const items = [];

    if (hour >= 6 && hour < 12 && is) {
      items.push(`
        <div class="kart satir tik" role="button" tabindex="0" data-akilli-rota="is" style="background:var(--vurgu-yumusak)">
          <div class="kart-sol">
            <div class="bas">${iconSvg("work", 15)} <span>${esc(t("nearby.goToWork"))} · ${esc(is.ad)}</span></div>
            <div class="alt">${esc(t("nearby.smartMorning", { ad: is.ad }))}</div>
          </div>
          <div class="kart-sag">${iconSvg("chevronRight", 16)}</div>
        </div>`);
    } else if (hour >= 16 && hour < 23 && ev) {
      items.push(`
        <div class="kart satir tik" role="button" tabindex="0" data-akilli-rota="ev" style="background:var(--vurgu-yumusak)">
          <div class="kart-sol">
            <div class="bas">${iconSvg("home", 15)} <span>${esc(t("nearby.goToHome"))} · ${esc(ev.ad)}</span></div>
            <div class="alt">${esc(t("nearby.smartEvening", { ad: ev.ad }))}</div>
          </div>
          <div class="kart-sag">${iconSvg("chevronRight", 16)}</div>
        </div>`);
    }

    if (ti != null && ti >= 65) {
      items.push(`
        <div class="uyari-banner">
          <span>${iconSvg("alert", 15)} ${esc(t("nearby.heavyTrafficTip", { ti: Math.round(ti) }))}</span>
          <span style="display:flex;gap:6px">
            <button type="button" class="btn kucuk" data-sekme="rayli">${iconSvg("metro", 13)} ${esc(t("nav.rayli"))}</button>
            <button type="button" class="btn kucuk" data-sekme="vapur">${iconSvg("vapur", 13)} ${esc(t("nav.vapur"))}</button>
          </span>
        </div>`);
    }

    if (!items.length) return "";
    return `<div class="baslik-satir"><h2>${esc(t("nearby.smartTitle"))}</h2></div>${items.join("")}`;
  }

  function buildFavoriteStopsHTML() {
    const favStops = S.favoriDuraklar || [];
    if (!favStops.length) return "";
    return `
      <div class="baslik-satir">
        <h2>${esc(t("nearby.favStops"))}</h2>
        <span class="soluk">${favStops.length}</span>
      </div>
      <div class="liste">
        ${favStops
          .map(
            (st, idx) => `
          <div class="kart satir tik" role="button" tabindex="0" data-fav-durak="${idx}">
            <div class="kart-sol">
              <div class="bas">${iconSvg("starFill", 14)} <span>${esc(bas(st.ad || t("common.stop")))}</span></div>
              <div class="alt">${st.kod ? esc(t("common.stopCode", { kod: st.kod })) : esc(t("modal.stopBoard"))}</div>
            </div>
            <div class="kart-sag">${iconSvg("chevronRight", 16)}</div>
          </div>`
          )
          .join("")}
      </div>`;
  }

  function buildCorridorsHTML(corridors, incidents) {
    const list = Array.isArray(corridors) ? corridors : [];
    const incList = Array.isArray(incidents) ? incidents.slice(0, 3) : [];
    if (!list.length && !incList.length) return "";

    const badgeCls = (level) => (level >= 4 ? "hata" : level === 3 ? "uyari" : "iyi");
    const levelLabel = (level) =>
      level >= 4 ? t("traffic.severe") : level === 3 ? t("traffic.heavy") : level === 2 ? t("traffic.moderate") : t("traffic.smooth");

    return `
      <div class="baslik-satir"><h2>${esc(t("traffic.corridorsTitle"))}</h2></div>
      <div class="kart">
        ${list
          .slice(0, 5)
          .map(
            (c) => `
          <div class="saglik-satir">
            <span style="font-weight:600">${esc(c.name || c.ad || "")}</span>
            <span style="display:flex;align-items:center;gap:6px">
              ${c.speedKmh != null ? `<span class="alt">${Math.round(c.speedKmh)} ${esc(t("unit.kmh"))}</span>` : ""}
              <span class="durum-rozet ${badgeCls(c.level ?? 1)}">${esc(levelLabel(c.level ?? 1))}</span>
            </span>
          </div>`
          )
          .join("")}
        ${
          incList.length
            ? `<div class="alt" style="margin-top:8px;font-weight:700">${esc(t("traffic.incidentsTitle"))}</div>` +
              incList
                .map(
                  (inc) => `
                <div class="alt" style="margin-top:4px">
                  ${iconSvg("alert", 13)} <span>${esc(inc.title || inc.road || inc.description || "")}</span>
                </div>`
                )
                .join("")
            : ""
        }
      </div>`;
  }

  async function render(p, ilk, no) {
    if (handleManifestShortcut()) return null;

    if (ilk) {
      callbacks.onYukle(t("nearby.title"), false);
      mc.aktifHatlarAyarla(S.favoriler);
    }

    // Non-blocking GPS: fire in background, render immediately with fallback hub
    triggerBackgroundGps();

    const refPoint = S.semt || S.ben || DEFAULT_HUB;
    const favs = S.favoriler.slice();

    // Fetch announcements, corridors/incidents (cached 90s), and favorite lines in parallel
    const duyuruPromise = API.iett.duyurular ? API.iett.duyurular().catch(() => []) : Promise.resolve([]);
    const corridorPromise =
      Date.now() - corridorCache.ts < 90e3 && corridorCache.data
        ? Promise.resolve(corridorCache)
        : Promise.all([
            typeof TrafficEngine?.analyzeCorridors === "function"
              ? Promise.resolve().then(() => TrafficEngine.analyzeCorridors()).catch(() => [])
              : Promise.resolve([]),
            typeof TrafficEngine?.fetchIncidents === "function" ? TrafficEngine.fetchIncidents().catch(() => []) : Promise.resolve([]),
          ]).then(([data, incidents]) => {
            corridorCache = { data, incidents, ts: Date.now() };
            return corridorCache;
          });

    const [duyurular, corridorRes, hatalarRaw] = await Promise.all([
      duyuruPromise,
      corridorPromise,
      Promise.all(
        favs.map(async (h) => {
          try {
            await mc.hatHazirla(h);
            if (!S.hatVeri[h].otobusler) {
              mc.konumIsle(h, await API.iett.konum(h));
            }
            mc.aracCiz(h);
            return null;
          } catch (e) {
            return `${h}: ${hataMesaji(e)}`;
          }
        })
      ),
    ]);

    if (no !== callbacks.getCizimNo()) return null;
    const hatalar = hatalarRaw.filter(Boolean);
    const duyuruSet = new Set((duyurular || []).map((d) => String(d.hat || d.HATKODU || "").trim()).filter(Boolean));

    if (ilk) {
      mc.katman.clearLayers();
      mc.durakKatmani.clearLayers();
      const gor = new Set();
      for (const h of favs) {
        for (const l of Object.values(S.hatVeri[h]?.duraklar || {})) {
          for (const d of l) {
            if (gor.has(d.kod)) continue;
            gor.add(d.kod);
            L.circleMarker([d.lat, d.lon], {
              radius: 4.5,
              color: S.hatVeri[h].renk,
              weight: 2,
              fillColor: "#fff",
              fillOpacity: 1,
            })
              .bindPopup(() => mc.durakPopup(h, d))
              .addTo(mc.durakKatmani);
          }
        }
      }
      mc.zoomAyarla();
    }

    mc.hedefKatmani.clearLayers();
    const noktalar = [[refPoint.lat, refPoint.lon]];

    // Header & Fleet Radar Quick Toggle
    const fleetBtn = `<button type="button" class="btn kucuk ${S.filoRadar ? "birincil" : ""}" data-filo-toggle aria-pressed="${S.filoRadar ? "true" : "false"}">${iconSvg("otobus", 14)} ${esc(S.filoRadar ? t("nearby.fleetOn") : t("nearby.fleetOff"))}${S.filoRadar && mc.getFiloCount() ? ` (${mc.getFiloCount()})` : ""}</button>`;
    let html = callbacks.baslikHTML(esc(t("nearby.title")), false, fleetBtn);

    if (S.semt) {
      html += `<div class="alt" style="margin-bottom:8px">${iconSvg("konum", 14)} <b style="color:var(--yazi)">${esc(S.semt.ad)}</b> ${esc(t("nearby.hubSelected"))} · <button type="button" class="btn kucuk" data-semt-temizle>${esc(t("nearby.backToLocation"))}</button></div>`;
    } else if (S.ben) {
      html += `<div class="alt" style="margin-bottom:8px">${esc(t("nearby.locLive", { acc: Math.round(S.ben.acc || 0) }))} <span class="canli">${esc(t("common.live"))}</span></div>`;
    } else if (gpsPending) {
      html += `<div class="alt" style="margin-bottom:8px">${iconSvg("konum", 13)} ${esc(t("nearby.locPending", { ad: refPoint.ad }))}</div>`;
    } else {
      html += `<div class="alt" style="margin-bottom:8px">${esc(t("nearby.locMissing"))}</div>`;
    }

    if (S.konumHata) {
      html += `<div class="duyuru hata"><span class="duyuru-ikon">${iconSvg("alert", 18)}</span><span>${esc(S.konumHata)}</span></div>`;
    }
    if (hatalar.length) {
      html += `<div class="duyuru"><span class="duyuru-ikon">${iconSvg("alert", 18)}</span><span>${hatalar.map(esc).join("<br>")}</span></div>`;
    }

    // Quick Hub Chips
    html += `
      <div class="hizli-yerler" role="group" aria-label="${esc(t("nearby.quickHubsAria"))}">
        ${HIZLI_SEMTLER.map((s) => {
          const aktif = S.semt?.ad === s.ad || (refPoint.varsayilan && s.ad === refPoint.ad);
          return `<button type="button" class="cip ${aktif ? "aktif" : ""}" data-semt="${esc(s.ad)}" aria-pressed="${aktif ? "true" : "false"}">${esc(s.ad)}</button>`;
        }).join("")}
      </div>`;

    // Smart Commute Suggestion
    const ti = mc.getTrafikIndeks()?.TI ?? null;
    html += buildSmartSuggestionHTML(ti);

    // Favorite Stops
    html += buildFavoriteStopsHTML();

    // Nearby Stops & Stations around refPoint
    let yakinHTML = "";
    const [trStops, metroIst, metroHat, mrIst, iskeleler] = await Promise.all([
      API.transitous?.yakinDuraklar ? API.transitous.yakinDuraklar(refPoint.lat, refPoint.lon).catch(() => []) : Promise.resolve([]),
      API.metro.istasyonlar().catch(() => []),
      API.metro.hatlar().catch(() => []),
      typeof API.marmaray?.istasyonlar === "function"
        ? API.marmaray.istasyonlar().catch(() => [])
        : Promise.resolve(API.marmaray?.istasyonlar || []),
      API.iskeleler().catch(() => []),
    ]);

    if (no !== callbacks.getCizimNo()) return null;

    const yakinDuraklar = [];
    for (const st of trStops || []) {
      const lat = Number(st.lat);
      const lon = Number(st.lon);
      if (!isFinite(lat) || !isFinite(lon)) continue;
      const m = Core.mesafe(refPoint, { lat, lon });
      if (m > 1200) continue;
      yakinDuraklar.push({
        tur: "otobus",
        ad: bas(st.name || st.ad || t("common.stop")),
        kod: st.code || st.kod || "",
        stopId: st.stopId || st.id || "",
        lat,
        lon,
        m,
        alt: t("nav.otobus"),
        renk: "var(--mod-otobus)",
      });
    }

    const hatMap = new Map((metroHat || []).map((h) => [h.id, h]));
    for (const s of metroIst || []) {
      const m = Core.mesafe(refPoint, s);
      if (m > 1500) continue;
      const h = hatMap.get(s.hatId);
      yakinDuraklar.push({
        tur: "rayli",
        id: s.id,
        ad: s.ad,
        hat: s.hat,
        lat: s.lat,
        lon: s.lon,
        m,
        alt: `${s.hat} · ${t("nav.rayli")}`,
        renk: h?.renk || "var(--mod-metro)",
      });
    }

    for (const s of mrIst || []) {
      const m = Core.mesafe(refPoint, s);
      if (m > 1500) continue;
      yakinDuraklar.push({
        tur: "marmaray",
        id: "mr:" + s.ad,
        ad: s.ad,
        hat: "MR",
        lat: s.lat,
        lon: s.lon,
        m,
        alt: "Marmaray",
        renk: "var(--mod-marmaray)",
      });
    }

    for (const pier of iskeleler || []) {
      const m = Core.mesafe(refPoint, pier);
      if (m > 1500) continue;
      yakinDuraklar.push({
        tur: "vapur",
        ad: pier.ad,
        hat: t("nav.vapur"),
        lat: pier.lat,
        lon: pier.lon,
        m,
        alt: pier.op || "Şehir Hatları",
        renk: "var(--mod-vapur)",
      });
    }

    yakinDuraklar.sort((a, b) => a.m - b.m);
    const gosterilen = yakinDuraklar.slice(0, 8);
    callbacks.setNearbyCache(gosterilen);

    if (gosterilen.length) {
      if (ilk) {
        for (const d of gosterilen) {
          noktalar.push([d.lat, d.lon]);
          L.circleMarker([d.lat, d.lon], {
            radius: 6,
            color: "#fff",
            weight: 2,
            fillColor: d.renk.startsWith("var(") ? "#0f62fe" : d.renk,
            fillOpacity: 0.95,
          })
            .bindTooltip(esc(d.ad))
            .addTo(mc.katman);
        }
      }
      yakinHTML += `<div class="baslik-satir"><h2>${esc(t("nearby.stopsHeading"))}</h2><span class="soluk">${esc(t("nearby.pointsCount", { n: gosterilen.length }))}</span></div>`;
      yakinHTML += `<div class="liste">${gosterilen
        .map((d, idx) => {
          const ikonAd = d.tur === "vapur" ? "vapur" : d.tur === "marmaray" ? "marmaray" : d.tur === "rayli" ? "metro" : "busStop";
          return `
            <div class="kart satir tik" role="button" tabindex="0" data-yakin-durak="${idx}">
              <div class="kart-sol">
                <div class="bas">
                  <span class="rozet" style="${accessibleBadgeStyle(d.renk)}">${iconSvg(ikonAd, 13)} ${esc(d.hat || t("common.stop"))}</span>
                  <span>${esc(d.ad)}</span>
                </div>
                <div class="alt">${esc(d.alt)}</div>
              </div>
              <div class="kart-sag">
                <span class="sure tarife">${metre(d.m)}</span>
                ${iconSvg("chevronRight", 16)}
              </div>
            </div>`;
        })
        .join("")}</div>`;
    }

    // Favorite Lines
    let favHTML = `<div class="baslik-satir"><h2>${esc(t("nearby.favLines"))}</h2><span class="soluk">${esc(t("nearby.linesCount", { n: favs.length }))}</span></div>`;
    if (!favs.length) {
      favHTML += `<div class="bos">${esc(t("nearby.noFavLines"))}</div>`;
    } else {
      favHTML += `<div class="liste">`;
      for (const hat of favs) {
        const v = S.hatVeri[hat];
        const duyuruVar = duyuruSet.has(hat);
        const duyuruBadge = duyuruVar
          ? `<span class="rozet" style="${accessibleBadgeStyle("var(--uyari)")}" role="img" title="${esc(t("bus.hasAlert"))}" aria-label="${esc(t("bus.hasAlert"))}">${iconSvg("alert", 12)}</span>`
          : "";

        if (!v?.duraklar || !Object.keys(v.duraklar).length) {
          favHTML += `
            <div class="kart satir tik" role="button" tabindex="0" data-hat="${esc(hat)}">
              <div class="kart-sol">
                <div class="bas"><span class="rozet" style="${accessibleBadgeStyle(renkKod(hat))}">${esc(hat)}</span>${duyuruBadge}<span class="alt">${esc(t("nearby.lineFetchErr"))}</span></div>
              </div>
              <div class="kart-sag">${iconSvg("chevronRight", 16)}</div>
            </div>`;
          continue;
        }

        for (const yon of Object.keys(v.duraklar).sort()) {
          const liste = v.duraklar[yon];
          const origBen = S.ben;
          if (S.semt || !S.ben) S.ben = refPoint;
          const h = mc.hedefDurak(hat, yon);
          S.ben = origBen;

          let govde = "";
          if (!h) {
            govde = `<div class="alt">${esc(t("nearby.noLocOrStop"))}</div>`;
          } else {
            noktalar.push([h.d.lat, h.d.lon]);
            mc.durakIsaretle(hat, h.d, v.renk);
            const gel = mc.yaklasanOtobusler(hat, yon, h.i).slice(0, 3);
            if (gel[0]) {
              const a = S.arac.get(hat + "/" + gel[0].bus.kapino);
              if (a) noktalar.push([a.gor.lat, a.gor.lon]);
            }
            govde = `<div class="alt">${esc(h.secili ? t("nearby.myStop") : t("nearby.nearestStop"))}: <b style="color:var(--yazi)">${esc(bas(h.d.ad))}</b>${h.metre != null ? " · " + metre(h.metre) : ""}</div>`;
            govde +=
              `<div class="liste" style="margin-top:4px">` +
              (gel.length ? gel.map((x) => otobusSatiriHTML(hat, x)).join("") : `<div class="alt">${esc(t("nearby.noApproaching"))}</div>`) +
              `</div>`;
          }

          favHTML += `
            <div class="kart">
              <div class="bas tik" role="button" tabindex="0" data-hat="${esc(hat)}" style="justify-content:space-between">
                <span style="display:flex;align-items:center;gap:8px;min-width:0">
                  <span class="rozet" style="${accessibleBadgeStyle(v.renk)}">${esc(hat)}</span>
                  <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">→ ${esc(bas(liste[liste.length - 1].ad))}</span>
                  ${duyuruBadge}
                </span>
                ${iconSvg("chevronRight", 16)}
              </div>
              ${govde}
            </div>`;
        }
      }
      favHTML += `</div>`;
    }

    // Bridges, Tunnels & Traffic Incidents summary
    const corridorsHTML = buildCorridorsHTML(corridorRes.data, corridorRes.incidents);

    if (no !== callbacks.getCizimNo()) return null;

    if (ilk && noktalar.length) {
      mc.sigdir(noktalar, 15);
    }

    return (
      html +
      yakinHTML +
      favHTML +
      corridorsHTML +
      `<p class="alt" style="margin-top:14px">${esc(t("nearby.etaFootnote"))}</p>`
    );
  }

  return { render };
}
