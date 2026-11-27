/**
 * İstanbul Ulaşım v5.0 — Otobüs & Metrobüs (Search, Line Detail, Live Vehicle Card + 9-Factor ETA & Alerts)
 */
import { Zaman } from "../core/time.js";
import { Core } from "../core/geo.js";
import { API } from "../core/api.js";
import { iconSvg } from "../ui/icons.js";
import { t } from "../i18n/index.js";
import { EtaEngine } from "../engines/etaEngine.js";
import { TrafficEngine } from "../engines/trafficEngine.js";
import { NotificationEngine } from "../engines/notificationEngine.js";
import { esc, bas, metre, saat, renkKod, metrobusMu } from "../map/mapController.js";
import {
  describeEtaTrust,
  parseGpsAgeSec,
  parseGpsTimestampMs,
  FRESH_GPS_SEC,
  renderTrustBadgesHTML,
  renderGpsAgeHTML,
  summarizeVehiclesFreshness,
} from "../ui/etaIndicators.js";
import { otobusSatiriHTML } from "./nearbyView.js";
import { accessibleBadgeStyle, bindKeyboardActivators } from "./a11y.js";

function dayLabel(code) {
  if (code === "C") return t("bus.daySaturday");
  if (code === "P") return t("bus.daySunday");
  return t("bus.dayWeekday");
}

export function buildBusEtaContext(hatVeri, arac, incidents = []) {
  return {
    hatBilgi: hatVeri?.bilgi,
    fleetItem: arac?.b || undefined,
    observedSpeedKmH: Number.isFinite(arac?.hiz) ? arac.hiz : undefined,
    trafficEngine: typeof TrafficEngine?.getCorridorSpeed === "function" ? TrafficEngine : undefined,
    incidents: Array.isArray(incidents) ? incidents : [],
  };
}

const gpsClock = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function isWatched(hat, durakKod) {
  const list = typeof NotificationEngine?.getWatches === "function" ? NotificationEngine.getWatches() : [];
  return list.some((w) => w.hat === hat && (!durakKod || w.durakKod === durakKod));
}

export function createBusView(S, mc, callbacks) {
  bindKeyboardActivators();

  async function renderList(p, ilk) {
    if (ilk) {
      callbacks.onYukle(t("bus.title"), false);
      mc.aktifHatlarAyarla([]);
    }
    const [hatlar, duyurular] = await Promise.all([
      API.iett.hatlar(),
      API.iett.duyurular ? API.iett.duyurular().catch(() => []) : Promise.resolve([]),
    ]);

    const q = (S.arama || "").trim().toLocaleUpperCase("tr");
    const kat = S.busKat || "tumu"; // tumu | fav | mb | duyuru
    const duyuruMap = new Map();
    for (const d of duyurular || []) {
      const k = String(d.hat || d.HATKODU || "").trim();
      if (!k) continue;
      if (!duyuruMap.has(k)) duyuruMap.set(k, []);
      duyuruMap.get(k).push(d.mesaj || d.MESAJ || d.tip || t("bus.alertDefault"));
    }

    let html = callbacks.baslikHTML(esc(t("bus.title")), false);
    html += `
      <div class="arama-kutu">
        <span class="arama-ikon" aria-hidden="true">${iconSvg("search", 17)}</span>
        <input type="search" class="giris" id="ara" aria-label="${esc(t("bus.searchLabel"))}" placeholder="${esc(t("bus.searchPlaceholder"))}" value="${esc(S.arama || "")}" autocomplete="off" autocapitalize="characters">
      </div>
      <div class="cip-satir" role="group" aria-label="${esc(t("bus.categoriesAria"))}">
        <button type="button" class="cip ${kat === "tumu" ? "aktif" : ""}" data-bus-kat="tumu" aria-pressed="${kat === "tumu" ? "true" : "false"}">${esc(t("bus.catAll"))}</button>
        <button type="button" class="cip ${kat === "fav" ? "aktif" : ""}" data-bus-kat="fav" aria-pressed="${kat === "fav" ? "true" : "false"}">${iconSvg("starFill", 14)} ${esc(t("bus.catFav"))}</button>
        <button type="button" class="cip ${kat === "mb" ? "aktif" : ""}" data-bus-kat="mb" aria-pressed="${kat === "mb" ? "true" : "false"}">${iconSvg("mb", 14)} ${esc(t("bus.catMb"))}</button>
        <button type="button" class="cip ${kat === "duyuru" ? "aktif" : ""}" data-bus-kat="duyuru" aria-pressed="${kat === "duyuru" ? "true" : "false"}">${iconSvg("alert", 14)} ${esc(t("bus.catAnn"))} (${duyuruMap.size})</button>
      </div>`;

    const satir = (h) => {
      const fav = S.favoriler.includes(h.kod);
      const mb = metrobusMu(h);
      const dVar = duyuruMap.has(h.kod);
      const favLabel = fav ? t("bus.favRemove", { hat: h.kod }) : t("bus.favAdd", { hat: h.kod });
      return `
        <div class="kart satir tik" role="button" tabindex="0" data-hat="${esc(h.kod)}">
          <div class="kart-sol">
            <div class="bas">
              <span class="rozet ${mb ? "mb" : "otobus"}" style="${mb ? "" : accessibleBadgeStyle(renkKod(h.kod))}">${iconSvg(mb ? "mb" : "otobus", 13)} ${esc(h.kod)}</span>
              <span>${esc(bas(h.ad))}</span>
              ${dVar ? `<span class="rozet" style="${accessibleBadgeStyle("var(--uyari)")}" role="img" title="${esc(t("bus.hasAlert"))}" aria-label="${esc(t("bus.hasAlert"))}">${iconSvg("alert", 12)}</span>` : ""}
            </div>
            <div class="alt">${mb ? `${esc(t("bus.catMb"))} · ` : ""}${h.km ? h.km.toFixed(1) + " km · " : ""}${h.dk ? `${Math.round(h.dk)} ${esc(t("unit.minShort"))}` : ""}</div>
          </div>
          <div class="kart-sag">
            <button type="button" class="btn ikon fav-btn" data-fav="${esc(h.kod)}" title="${esc(favLabel)}" aria-label="${esc(favLabel)}" aria-pressed="${fav ? "true" : "false"}">${iconSvg(fav ? "starFill" : "star", 20)}</button>
          </div>
        </div>`;
    };

    if (q) {
      const bulunan = hatlar
        .filter((h) => h.kod.startsWith(q))
        .concat(hatlar.filter((h) => !h.kod.startsWith(q) && (h.kod.includes(q) || h.ad.toLocaleUpperCase("tr").includes(q))))
        .slice(0, 40);
      html += `<div class="baslik-satir"><h2>${esc(t("bus.results"))}</h2><span class="soluk">${esc(t("nearby.linesCount", { n: bulunan.length }))}</span></div>`;
      html += `<div class="liste">${bulunan.map(satir).join("") || `<div class="bos">${esc(t("bus.noMatch"))}</div>`}</div>`;
    } else if (kat === "duyuru") {
      const duyurulu = hatlar.filter((h) => duyuruMap.has(h.kod));
      html += `<div class="baslik-satir"><h2>${esc(t("bus.annLines"))}</h2><span class="soluk">${esc(t("nearby.linesCount", { n: duyurulu.length }))}</span></div>`;
      html += `<div class="liste">${duyurulu.map(satir).join("") || `<div class="bos">${esc(t("bus.noAnn"))}</div>`}</div>`;
    } else if (kat === "mb") {
      const mb = hatlar.filter(metrobusMu).sort((a, b) => a.kod.localeCompare(b.kod, "tr"));
      html += `<div class="baslik-satir"><h2>${esc(t("bus.mbLines"))}</h2><span class="soluk">${esc(t("nearby.linesCount", { n: mb.length }))}</span></div>`;
      html += `<div class="liste">${mb.map(satir).join("")}</div>`;
    } else if (kat === "fav") {
      const favs = S.favoriler.map((k) => hatlar.find((h) => h.kod === k) || { kod: k, ad: "" });
      html += `<div class="baslik-satir"><h2>${esc(t("bus.favLines"))}</h2><span class="soluk">${esc(t("nearby.linesCount", { n: favs.length }))}</span></div>`;
      html += `<div class="liste">${favs.map(satir).join("") || `<div class="bos">${esc(t("bus.noFavShort"))}</div>`}</div>`;
    } else {
      const favs = S.favoriler.map((k) => hatlar.find((h) => h.kod === k) || { kod: k, ad: "" });
      html += `<div class="baslik-satir"><h2>${esc(t("bus.favLines"))}</h2></div>`;
      html += `<div class="liste">${favs.map(satir).join("") || `<div class="bos">${esc(t("bus.noFavShort"))}</div>`}</div>`;
      const mb = hatlar.filter(metrobusMu).sort((a, b) => a.kod.localeCompare(b.kod, "tr"));
      html += `<div class="baslik-satir"><h2>${esc(t("bus.mbLines"))}</h2></div>`;
      html += `<div class="liste">${mb.map(satir).join("")}</div>`;
      html += `<p class="alt" style="margin-top:12px">${esc(t("bus.totalInfo", { n: hatlar.length }))}</p>`;
    }

    return html;
  }

  async function renderLine(p, ilk, no) {
    const hat = p.hat;
    if (ilk) {
      callbacks.onYukle(esc(hat), true);
      mc.aktifHatlarAyarla([hat]);
    }
    const [v, hatDuyurular] = await Promise.all([
      mc.hatHazirla(hat),
      API.iett.hatDuyurulari ? API.iett.hatDuyurulari(hat).catch(() => []) : Promise.resolve([]),
    ]);
    if (!v.otobusler || ilk) mc.konumIsle(hat, await API.iett.konum(hat));
    if (no !== callbacks.getCizimNo()) return null;
    if (!v.seferler) {
      try {
        v.seferler = await API.iett.seferler(hat);
      } catch {
        v.seferler = {};
      }
    }

    const yonler = Object.keys(v.duraklar).sort();
    if (!yonler.includes(p.yon)) p.yon = yonler[0];
    if (!p.gun) p.gun = Zaman.gunTipi();

    const liste = v.duraklar[p.yon] || [];
    const b = v.bilgi || {};
    const fav = S.favoriler.includes(hat);
    const favLabel = fav ? t("bus.favRemove", { hat }) : t("bus.favAdd", { hat });

    if (ilk || p.cizilenYon !== p.yon) {
      mc.katman.clearLayers();
      const pts = mc.guzergahCiz(hat, p.yon);
      if (ilk) mc.sigdir(S.ben ? pts.concat([[S.ben.lat, S.ben.lon]]) : pts);
      p.cizilenYon = p.yon;
    }
    mc.aracCiz(hat);

    const favBtn = `<button type="button" class="btn ikon fav-btn" data-fav="${esc(hat)}" title="${esc(favLabel)}" aria-label="${esc(favLabel)}" aria-pressed="${fav ? "true" : "false"}">${iconSvg(fav ? "starFill" : "star", 22)}</button>`;
    let html = callbacks.baslikHTML(
      `<span class="rozet" style="${accessibleBadgeStyle(v.renk)}">${iconSvg(v.mb ? "mb" : "otobus", 14)} ${esc(hat)}</span> <span style="font-size:15px">${esc(bas(b.ad || ""))}</span>`,
      true,
      favBtn
    );

    const lineFresh = summarizeVehiclesFreshness(v.otobusler);
    const lineAgeHTML = renderGpsAgeHTML({
      sonGuncellemeSn: lineFresh.freshestSec,
      gpsTier: lineFresh.state === "stale" ? "stale" : lineFresh.freshestSec <= FRESH_GPS_SEC ? "fresh" : "aging",
    }, { liveMs: lineFresh.freshestMs });
    const lineStatusHTML =
      lineFresh.state === "live"
        ? `<span class="canli">${esc(t("common.live"))}</span> ${lineAgeHTML}`
        : lineFresh.state === "stale"
        ? `<span class="durum-rozet eski">${esc(t("eta.status.STALE"))}</span> ${lineAgeHTML}`
        : lineFresh.state === "missing"
        ? `<span class="durum-rozet soluk">${esc(t("eta.gpsUnknown"))}</span>`
        : `<span class="durum-rozet soluk">${esc(t("eta.noLiveVehicle"))}</span>`;

    html += `<div class="alt" style="margin-bottom:8px">${[
      b.km ? b.km.toFixed(1) + " km" : "",
      b.dk ? t("bus.tripDuration", { n: Math.round(b.dk) }) : "",
      b.tarife ? bas(b.tarife) : "",
      t("bus.inService", { n: (v.otobusler || []).length }),
    ]
      .filter(Boolean)
      .map(esc)
      .join(" · ")} ${lineStatusHTML}</div>`;

    // Announcements banner
    for (const d of hatDuyurular || []) {
      const msg = d.mesaj || d.MESAJ || d.tip || "";
      if (msg) {
        html += `<div class="duyuru"><span class="duyuru-ikon">${iconSvg("alert", 18)}</span><span>${esc(msg)}</span></div>`;
      }
    }

    // Direction switcher
    html += `<div class="segment" role="group">${yonler
      .map((y) => {
        const l = v.duraklar[y];
        const active = y === p.yon;
        return `<button type="button" data-yon="${esc(y)}" class="${active ? "aktif" : ""}" aria-pressed="${active ? "true" : "false"}">→ ${esc(bas(l[l.length - 1].ad))}</button>`;
      })
      .join("")}</div>`;

    const h = mc.hedefDurak(hat, p.yon);
    mc.hedefKatmani.clearLayers();
    if (h) {
      mc.durakIsaretle(hat, h.d, v.renk);
      const gel = mc.yaklasanOtobusler(hat, p.yon, h.i).slice(0, 4);
      const watched = isWatched(hat, h.d.kod);
      html += `
        <div class="kart" style="margin-bottom:10px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
            <div class="alt">${esc(h.secili ? t("nearby.myStop") : t("nearby.nearestStop"))}: <b style="color:var(--yazi)">${esc(bas(h.d.ad))}</b>${h.metre != null ? " · " + metre(h.metre) : ""}</div>
            <button type="button" class="btn kucuk ${watched ? "birincil" : ""}" data-bildir-hat="${esc(hat)}" data-bildir-durak="${esc(h.d.kod)}" data-bildir-ad="${esc(bas(h.d.ad))}" data-bildir-yon="${esc(p.yon)}" aria-pressed="${watched ? "true" : "false"}">🔔 ${esc(watched ? t("eta.notifying") : t("eta.notify3m"))}</button>
          </div>
          <div class="liste" style="margin-top:6px">${gel.length ? gel.map((x) => otobusSatiriHTML(hat, x)).join("") : `<div class="alt">${esc(t("nearby.noApproaching"))}</div>`}</div>
        </div>`;
    } else {
      html += `<div class="alt" style="margin-bottom:8px">${esc(t("bus.pickStopHint"))}</div>`;
    }

    // Timetable
    const gunler = v.seferler?.[p.yon] || {};
    const saatler = gunler[p.gun] || [];
    const bugun = p.gun === Zaman.gunTipi();
    const simdi = Zaman.simdi();
    const sonraki = bugun ? saatler.find((s) => Zaman.dk(s) >= simdi) : null;

    html += `<div class="baslik-satir"><h2>${esc(t("bus.timetable"))}</h2><span class="soluk">${esc(t("bus.departureFrom", { ad: bas(liste[0]?.ad || "") }))}</span></div>`;
    html += `<div class="segment" role="group">${["I", "C", "P"]
      .map((g) => {
        const active = g === p.gun;
        return `<button type="button" data-gun="${g}" class="${active ? "aktif" : ""}" aria-pressed="${active ? "true" : "false"}">${esc(dayLabel(g))}${g === Zaman.gunTipi() ? " •" : ""}</button>`;
      })
      .join("")}</div>`;

    html += `<div class="kart" style="margin-bottom:12px">`;
    if (saatler.length) {
      if (sonraki) {
        const remaining = Zaman.dk(sonraki) - simdi;
        const countdown = remaining === 0
          ? t("common.now")
          : remaining < 60
          ? t("bus.departureIn", { n: remaining })
          : t("bus.departureInHours", { h: Math.floor(remaining / 60), m: remaining % 60 });
        html += `<div class="alt"><span class="durum-rozet tarife">${esc(t("eta.sourceSchedule"))}</span> ${esc(t("bus.nextDep"))} <b style="color:var(--yazi)">${esc(sonraki)}</b> · ${esc(countdown)}</div>`;
      }
      html += `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">${saatler
        .map((s) => {
          const gecti = bugun && Zaman.dk(s) < simdi;
          const isNext = s === sonraki;
          return `<span class="sure tarife" style="${gecti ? "background:transparent" : isNext ? "color:var(--yazi);border:1px solid var(--cizgi)" : ""}">${esc(s)}</span>`;
        })
        .join("")}</div>`;
    } else {
      html += `<div class="alt">${esc(t("bus.noSchedule"))}</div>`;
    }
    html += `</div>`;

    // Interactive Stop Timeline with Live Vehicles
    const durakta = {};
    const arada = {};
    const hiz0 = v.hiz || 15;
    const lineIncidents = mc.getTrafikIncidents?.() || [];
    for (const a of S.arac.values()) {
      if (a.hat !== hat || a.yon !== p.yon) continue;
      const yer = mc.aracYeri(liste, a);
      if (!yer) continue;
      let eta = null;
      if (h && h.i >= yer.sonraki) {
        if (typeof EtaEngine?.predict === "function") {
          eta = EtaEngine.predict(
            liste,
            { ...(a.b || {}), lat: a.gor.lat, lon: a.gor.lon },
            h.i,
            buildBusEtaContext(v, a, lineIncidents)
          );
        } else {
          eta = Core.varisTahmini(liste, a.gor, h.i, mc.aracHizi(hat, a.kapino) || hiz0);
        }
      }
      const trust = describeEtaTrust(eta, { fallbackAgeSec: parseGpsAgeSec(a.b?.zaman) });
      const kayit = { a, yer, t: eta, trust };
      if (yer.durakta != null) (durakta[yer.durakta] ||= []).push(kayit);
      else (arada[yer.sonraki] ||= []).push(kayit);
    }

    const kalanYazi = (k) => {
      if (!k.t) return "";
      const suffix = k.trust?.isStale ? ` (${esc(t("eta.status.STALE"))})` : "";
      return ` · <b>${esc(k.trust.pillText)}</b>${suffix}`;
    };
    let lis = "";
    liste.forEach((d, i) => {
      for (const k of (arada[i] || []).sort((x, y) => y.yer.oran - x.yer.oran)) {
        const staleCls = k.trust?.isStale ? " eski" : "";
        lis += `
          <li class="tik" role="button" tabindex="0" data-arac="${esc(k.a.kapino)}" style="padding-left:8px">
            <span class="arac-cip${staleCls}" style="${accessibleBadgeStyle(v.renk)}">${iconSvg(v.mb ? "mb" : "otobus", 12)} ${esc(k.a.kapino)}</span>
            <span class="alt">${esc(t("bus.toStopDist", { ad: bas(d.ad), m: metre(k.yer.metre) }))}${kalanYazi(k)}</span>
          </li>`;
      }
      const bu = durakta[i] || [];
      lis += `
        <li data-durak="${i}" role="button" tabindex="0" class="tik ${h && h.i === i ? "aktif" : ""}">
          <span>${esc(bas(d.ad))}</span>
          <span style="display:flex;align-items:center;gap:6px">
            ${bu.map((k) => `<button type="button" class="arac-cip${k.trust?.isStale ? " eski" : ""}" data-arac="${esc(k.a.kapino)}" style="border:0;cursor:pointer;${accessibleBadgeStyle(v.renk)}">${iconSvg(v.mb ? "mb" : "otobus", 12)} ${esc(k.a.kapino)}</button>`).join("")}
          </span>
        </li>`;
    });

    const toplam = Object.values(durakta).flat().length + Object.values(arada).flat().length;
    html += `<div class="baslik-satir"><h2>${esc(t("bus.stops", { n: liste.length }))}</h2><span class="soluk">${esc(t("bus.vehiclesOnDir", { n: toplam }))}</span></div>`;
    html += `<div class="kart"><ol class="duraklar">${lis}</ol></div>`;
    return html;
  }

  async function renderVehicle(p, ilk, no) {
    const key = p.hat + "/" + p.kapino;
    if (ilk) {
      mc.aktifHatlarAyarla([p.hat]);
      callbacks.onYukle(`${esc(p.hat)} · ${esc(p.kapino)}`, true);
    }
    const v = await mc.hatHazirla(p.hat);
    if (!v.otobusler || ilk) mc.konumIsle(p.hat, await API.iett.konum(p.hat));
    if (no !== callbacks.getCizimNo()) return null;

    const a = S.arac.get(key);
    if (ilk || p.cizilenYon !== a?.yon) {
      mc.katman.clearLayers();
      if (a) {
        mc.guzergahCiz(p.hat, a.yon);
        p.cizilenYon = a.yon;
        if (ilk) mc.map.setView([a.gor.lat, a.gor.lon], Math.max(mc.map.getZoom(), 15));
      }
    }
    mc.aracCiz(p.hat);
    if (a) {
      mc.hedefKatmani.clearLayers();
      const hd = mc.hedefDurak(p.hat, a.yon);
      if (hd) mc.durakIsaretle(p.hat, hd.d, v.renk);
    }
    if (!v.seferler) {
      API.iett
        .seferler(p.hat)
        .then((x) => {
          v.seferler = x || {};
          if (callbacks.sayfa() === p) callbacks.panelYenile();
        })
        .catch(() => {
          v.seferler = {};
        });
    }

    const baslik = callbacks.baslikHTML(
      `<span class="rozet" style="${accessibleBadgeStyle(v.renk)}">${iconSvg(v.mb ? "mb" : "otobus", 14)} ${esc(p.hat)}</span> <span style="font-size:15px">${esc(t("bus.vehicleLabel", { id: p.kapino }))}</span>`,
      true
    );

    if (!a) {
      return baslik + `<div class="bos">${esc(t("bus.vehicleMissing"))}</div>`;
    }

    const liste = v.duraklar?.[a.yon] || [];
    const simdi = Zaman.simdi();
    const s = liste.length ? Core.siradakiDurak(liste, a.gor) : -1;
    const hiz = mc.aracHizi(p.hat, a.kapino);
    const ti = mc.getTrafikIndeks?.()?.TI ?? null;
    const incidents = mc.getTrafikIncidents?.() || [];
    const etaCtx = buildBusEtaContext(v, a, incidents);
    const tah = (i) => {
      if (!liste.length || s < 0 || i < s) return null;
      if (typeof EtaEngine?.predict === "function") {
        return EtaEngine.predict(liste, { ...(a.b || {}), lat: a.gor.lat, lon: a.gor.lon }, i, etaCtx);
      }
      return Core.varisTahmini(liste, a.gor, i, hiz);
    };

    const hd = mc.hedefDurak(p.hat, a.yon);
    const tEta = hd && s >= 0 ? tah(hd.i) : null;
    const refEta = tEta || (liste.length && s >= 0 ? tah(Math.min(liste.length - 1, s)) : null);
    const validMs = parseGpsTimestampMs(a.b?.zaman);
    const fallbackAgeSec = refEta?.sonGuncellemeSn != null ? refEta.sonGuncellemeSn : parseGpsAgeSec(a.b?.zaman);
    const refTrust = describeEtaTrust(refEta, { fallbackAgeSec });
    const etaTrust = tEta ? describeEtaTrust(tEta, { fallbackAgeSec }) : null;

    const badges = [];
    const trustBadges = renderTrustBadgesHTML(refTrust, { compact: false, showOnTime: true });
    if (trustBadges) badges.push(trustBadges);
    if ((a.b?.sapma || a.b?.deviation) && refTrust.durumKod !== "OFF_ROUTE") {
      badges.push(`<span class="durum-rozet uyari">${esc(t("eta.deviation"))}</span>`);
    }
    if ((a.b?.gecikme || a.b?.delayed) && refTrust.durumKod !== "DELAYED") {
      badges.push(`<span class="durum-rozet uyari">${esc(t("eta.delayed"))}</span>`);
    }
    if (a.b?.hizmetDisi || a.b?.outOfService) {
      badges.push(`<span class="durum-rozet hata">${esc(t("eta.outOfService"))}</span>`);
    }

    const plaka = refEta?.plaka || a.b?.plaka || a.b?.plate || "";
    const operator = refEta?.operator || a.b?.operator || v.bilgi?.operator || "";
    const gpsAgeSpan = renderGpsAgeHTML(refTrust, { prefix: false, liveMs: validMs });
    const lastUpdateDetail =
      refTrust.sonGuncellemeSn != null && validMs != null
        ? `<b style="color:var(--yazi)">${esc(gpsClock.format(validMs))}</b> · ${gpsAgeSpan}`
        : gpsAgeSpan;

    let kart = `<div class="kart">`;
    if (liste.length) {
      kart += `<div class="bas" style="justify-content:space-between"><span>→ ${esc(bas(liste[liste.length - 1].ad))}</span><span style="display:flex;gap:4px;flex-wrap:wrap">${badges.join("")}</span></div>`;
    } else if (badges.length) {
      kart += `<div class="eta-guven-serit">${badges.join("")}</div>`;
    }
    if (v.bilgi?.ad) kart += `<div class="alt">${esc(bas(v.bilgi.ad))}</div>`;
    kart += `<div class="alt">${esc(t("eta.lastUpdate"))}: ${lastUpdateDetail}${a.hiz != null ? ` · ~${Math.round(a.hiz)} ${esc(t("unit.kmh"))}` : ""}</div>`;
    if (plaka || operator) {
      kart += `<div class="alt">${plaka ? `${esc(t("eta.plate"))}: <b style="color:var(--yazi)">${esc(plaka)}</b>` : ""}${plaka && operator ? " · " : ""}${operator ? `${esc(t("eta.operator"))}: <b style="color:var(--yazi)">${esc(operator)}</b>` : ""}</div>`;
    }

    const yer = liste.length ? mc.aracYeri(liste, a) : null;
    if (yer) {
      kart += `<div class="kart" style="background:var(--kart-2);margin:6px 0">
        <div class="alt">${iconSvg("konum", 14)} <b style="color:var(--yazi)">${esc(t("bus.nowAt"))}</b> ${
        yer.durakta != null
          ? esc(t("bus.atStop", { ad: bas(liste[yer.durakta].ad) }))
          : yer.sonraki > 0
          ? `<b>${esc(bas(liste[yer.sonraki - 1].ad))}</b> → <b>${esc(bas(liste[yer.sonraki].ad))}</b> (${metre(yer.metre)})`
          : esc(t("bus.toStopDist", { ad: bas(liste[0].ad), m: metre(yer.metre) }))
      }</div></div>`;
    }

    if (hd && s >= 0) {
      const watched = isWatched(p.hat, hd.d.kod);
      const minUnit = t("unit.minShort");
      const speedVal = Number.isFinite(tEta?.hizKmSa) ? `${Math.round(tEta.hizKmSa)} ${t("unit.kmh")}` : "–";
      const trafficFactor =
        Number.isFinite(tEta?.trafikEtkisiDk) && tEta.trafikEtkisiDk > 0
          ? `+${Number(tEta.trafikEtkisiDk).toFixed(1)} ${minUnit}`
          : ti != null
          ? `%${Math.round(ti)}`
          : "–";
      const dwellMin = Number.isFinite(tEta?.duraklamaDk)
        ? `${Number(tEta.duraklamaDk).toFixed(1)} ${minUnit}`
        : "–";
      const delayBadge =
        Number.isFinite(tEta?.gecikmeDk) && tEta.gecikmeDk >= 1
          ? `<span class="durum-rozet uyari">${esc(t("eta.delayAmount", { n: Number(tEta.gecikmeDk).toFixed(1) }))}</span>`
          : "";
      const hasIncident = Number.isFinite(tEta?.kazaEtkisiDk) && tEta.kazaEtkisiDk > 0;
      const cardVariant = etaTrust ? etaTrust.cardClass : "eksik-kart";
      const etaHeadlineColor =
        etaTrust?.isStale
          ? "var(--uyari)"
          : etaTrust?.isOffRoute
          ? "var(--hata)"
          : etaTrust?.isMissing
          ? "var(--soluk)"
          : "var(--vurgu)";
      const clockText =
        tEta && Number.isFinite(tEta.dakika)
          ? `${etaTrust?.isLive && !etaTrust?.isMissing ? "" : "~"}${saat(simdi + tEta.dakika)}`
          : "";
      const liveEtaAttr = etaTrust?.canSurgicalUpdate ? ` data-live-eta="${esc(key)}"` : "";

      kart += `<div class="kart eta-detay-kart ${cardVariant}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <div class="alt">${esc(hd.secili ? t("nearby.myStop") : t("nearby.nearestStop"))} (${esc(bas(hd.d.ad))})</div>
          <button type="button" class="btn kucuk ${watched ? "birincil" : ""}" data-bildir-hat="${esc(p.hat)}" data-bildir-durak="${esc(hd.d.kod)}" data-bildir-ad="${esc(bas(hd.d.ad))}" data-bildir-yon="${esc(a.yon)}" aria-pressed="${watched ? "true" : "false"}">🔔 ${esc(watched ? t("eta.notifying") : t("eta.notify3m"))}</button>
        </div>
        ${
          tEta && etaTrust
            ? `<div class="bas" style="color:${etaHeadlineColor};font-size:20px"${liveEtaAttr}>${esc(etaTrust.pillText)} <span class="alt">${esc(t("eta.stopsAway", { n: tEta.durakSayisi }))} · ${metre(tEta.metre)}${clockText ? ` · ${esc(clockText)}` : ""}</span></div>
               <div class="eta-guven-serit">
                 ${renderTrustBadgesHTML(etaTrust, { compact: false, showOnTime: true })}
                 ${renderGpsAgeHTML(etaTrust, { prefix: true, liveMs: validMs })}
                 ${delayBadge}
               </div>
               ${etaTrust.notice ? `<div class="eta-not">${iconSvg("alert", 14)} <span>${esc(etaTrust.notice)}</span></div>` : ""}
               <div class="alt" style="margin-top:4px;gap:8px;flex-wrap:wrap">
                 <span>${esc(t("eta.speed"))}: <b>${esc(speedVal)}</b></span>
                 <span>· ${esc(t("eta.trafficImpact"))}: <b>${esc(trafficFactor)}</b></span>
                 <span>· ${esc(t("eta.stopDwell"))}: <b>${esc(dwellMin)}</b></span>
                 ${hasIncident ? `<span class="durum-rozet uyari">${iconSvg("alert", 12)} ${esc(t("eta.incidentWarn"))} (+${Math.round(tEta.kazaEtkisiDk)} ${esc(minUnit)})</span>` : ""}
               </div>`
            : `<div class="alt">${esc(t("bus.passedStop"))}</div>`
        }
      </div>`;
    }

    if (s >= 0) {
      const son = liste.length - 1;
      const approxPrefix = refTrust.isLive && !refTrust.isMissing ? "" : "~";
      const satirlar = [];
      for (let i = s; i <= son && satirlar.length < 5; i++) {
        const tItem = tah(i);
        if (tItem && Number.isFinite(tItem.dakika)) {
          satirlar.push(`<div class="alt" style="justify-content:space-between;width:100%"><span>${esc(bas(liste[i].ad))}</span><b style="color:${approxPrefix ? "var(--soluk)" : "var(--yazi)"}">${approxPrefix}${saat(simdi + tItem.dakika)}</b></div>`);
        }
      }
      const yuzde = Math.round((s / Math.max(1, son)) * 100);
      kart += `
        <div class="baslik-satir" style="margin:6px 0 4px"><h3>${esc(t("bus.nextStops"))}</h3><span class="soluk">${esc(t("bus.remaining", { n: son - s + 1 }))}</span></div>
        ${satirlar.join("")}
        <div class="doluluk-bar"><span style="width:${yuzde}%;background:${esc(v.renk)}"></span></div>
        <div class="alt" style="justify-content:space-between"><span>${esc(bas(liste[0].ad))}</span><span>%${yuzde}</span></div>`;
    }

    const tracking = mc.getTakipArac() === key;
    kart += `
      <div style="display:flex;gap:8px;margin-top:10px">
        <button type="button" class="btn" style="flex:1" data-ak="takip" aria-pressed="${tracking ? "true" : "false"}">${esc(tracking ? t("bus.following") : t("bus.followMap"))}</button>
        <button type="button" class="btn birincil" style="flex:1" data-ak="hat" data-akhat="${esc(p.hat)}" data-akyon="${esc(a.yon)}">${esc(t("bus.linePage"))}</button>
      </div>
    </div>`;

    return baslik + kart;
  }

  return { renderList, renderLine, renderVehicle };
}
