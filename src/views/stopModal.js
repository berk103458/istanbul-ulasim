/**
 * İstanbul Ulaşım v5.0 — Slide-up Modal (Stop Departure Board, Favorite Stops, Settings & Provider Health)
 */
import { Zaman } from "../core/time.js";
import { Core } from "../core/geo.js";
import { KV } from "../core/storage.js";
import { applyMapStyle, saveProxyUrl } from "../app/settings.js";
import { API } from "../core/api.js";
import { iconSvg } from "../ui/icons.js";
import { t, getLang, setLang } from "../i18n/index.js";
import { DataProvider } from "../engines/dataProvider.js";
import { GoogleMapsService } from "../services/googleMapsService.js";
import { esc, bas, metre, saat, renkKod, sureEtiket, hataMesaji } from "../map/mapController.js";
import { accessibleBadgeStyle, bindKeyboardActivators } from "./a11y.js";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const BACKGROUND_REGIONS = ["#harita", ".harita-ust-sol", ".harita-ust-sag", "#secimBandi", "#panel", "#sekmeler"];

export function createStopModal(S, mc, callbacks) {
  bindKeyboardActivators();
  const modalEl = () => document.querySelector("#altModal");
  let previousFocus = null;

  function setBackgroundHidden(hidden) {
    for (const sel of BACKGROUND_REGIONS) {
      const node = document.querySelector(sel);
      if (!node) continue;
      if (hidden) node.setAttribute("aria-hidden", "true");
      else node.removeAttribute("aria-hidden");
    }
  }

  function getFocusable(container) {
    if (!container) return [];
    return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter((el) => {
      if (el.hasAttribute("hidden")) return false;
      const style = window.getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    });
  }

  function isOpen() {
    const el = modalEl();
    return Boolean(el && !el.hasAttribute("hidden"));
  }

  function close() {
    const el = modalEl();
    if (!el) return;
    const wasOpen = !el.hasAttribute("hidden");
    el.setAttribute("hidden", "");
    el.innerHTML = "";
    setBackgroundHidden(false);
    if (wasOpen && previousFocus && typeof previousFocus.focus === "function" && previousFocus.isConnected) {
      previousFocus.focus();
    }
    previousFocus = null;
  }

  function renderBox(html) {
    const el = modalEl();
    if (!el) return;
    const alreadyOpen = !el.hasAttribute("hidden");
    if (!alreadyOpen && document.activeElement instanceof HTMLElement) {
      previousFocus = document.activeElement;
    }
    el.innerHTML = `<div class="alt-modal-kutu" role="dialog" aria-modal="true" aria-labelledby="modalBaslik" tabindex="-1">${html}</div>`;
    el.removeAttribute("hidden");
    setBackgroundHidden(true);

    const dialog = el.querySelector(".alt-modal-kutu");
    const focusables = getFocusable(dialog);
    if (focusables.length) focusables[0].focus();
    else dialog?.focus();
  }

  // Backdrop click closes modal
  document.addEventListener("click", (e) => {
    const el = modalEl();
    if (!el || el.hasAttribute("hidden")) return;
    if (e.target === el || e.target.closest("[data-modal-kapat]")) {
      close();
    }
  });

  // Escape key & Tab focus trap while modal is open
  document.addEventListener("keydown", (e) => {
    const el = modalEl();
    if (!el || el.hasAttribute("hidden")) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }

    if (e.key !== "Tab") return;
    const dialog = el.querySelector(".alt-modal-kutu");
    if (!dialog) return;
    const focusables = getFocusable(dialog);
    if (!focusables.length) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;

    if (e.shiftKey) {
      if (active === first || active === dialog || !dialog.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !dialog.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  });

  // Keep focus trapped if external focus event escapes the open dialog
  document.addEventListener("focusin", (e) => {
    const el = modalEl();
    if (!el || el.hasAttribute("hidden")) return;
    const dialog = el.querySelector(".alt-modal-kutu");
    if (!dialog || dialog.contains(e.target)) return;
    const focusables = getFocusable(dialog);
    if (focusables.length) focusables[0].focus();
    else dialog.focus();
  });

  // ---------------- 1) Durak Kalkış Panosu ----------------
  function isFavStop(stop) {
    const list = S.favoriDuraklar || [];
    return list.some(
      (d) =>
        (stop.kod && d.kod === stop.kod) ||
        (stop.stopId && d.stopId === stop.stopId) ||
        (d.ad === stop.ad && Core.mesafe(d, stop) < 40)
    );
  }

  async function openStopBoard(stop) {
    const baslikAd = esc(bas(stop.ad || t("common.stop")));
    const mesafeYazi = S.ben && stop.lat ? ` · ${metre(Core.mesafe(S.ben, stop))}` : "";
    const favStop = isFavStop(stop);
    const favLabel = favStop ? t("modal.favStopRemove") : t("modal.favStopAdd");

    renderBox(`
      <div class="modal-baslik">
        <div style="min-width:0;flex:1">
          <h3 id="modalBaslik">${iconSvg("busStop", 18)} ${baslikAd}</h3>
          <div class="alt">${stop.kod ? esc(t("common.stopCode", { kod: stop.kod })) : esc(t("modal.stopBoard"))}${mesafeYazi}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <button type="button" class="btn kucuk ${favStop ? "birincil" : ""}" id="favDurakBtn" title="${esc(favLabel)}" aria-label="${esc(favLabel)}" aria-pressed="${favStop ? "true" : "false"}">
            ${iconSvg(favStop ? "starFill" : "star", 15)}
          </button>
          <button type="button" class="btn ikon" data-modal-kapat aria-label="${esc(t("common.close"))}">${iconSvg("close", 18)}</button>
        </div>
      </div>
      <div id="modalGovde">
        <div class="skeleton skeleton-kart"></div>
        <div class="skeleton skeleton-kart"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button type="button" class="btn" style="flex:1" data-durak-rota="nereden">${iconSvg("rota", 16)} ${esc(t("modal.routeFrom"))}</button>
        <button type="button" class="btn birincil" style="flex:1" data-durak-rota="nereye">${iconSvg("konum", 16)} ${esc(t("modal.routeTo"))}</button>
      </div>
    `);

    const favBtn = document.querySelector("#favDurakBtn");
    favBtn?.addEventListener("click", () => {
      S.favoriDuraklar = S.favoriDuraklar || [];
      const idx = S.favoriDuraklar.findIndex(
        (d) =>
          (stop.kod && d.kod === stop.kod) ||
          (stop.stopId && d.stopId === stop.stopId) ||
          (d.ad === stop.ad && Core.mesafe(d, stop) < 40)
      );
      if (idx >= 0) S.favoriDuraklar.splice(idx, 1);
      else S.favoriDuraklar.unshift({ kod: stop.kod || "", stopId: stop.stopId || "", ad: bas(stop.ad), lat: stop.lat, lon: stop.lon, tur: stop.tur || "otobus" });
      KV.set("favoriDuraklar", S.favoriDuraklar);
      const nowFav = idx < 0;
      const nextLabel = nowFav ? t("modal.favStopRemove") : t("modal.favStopAdd");
      favBtn.classList.toggle("birincil", nowFav);
      favBtn.setAttribute("aria-pressed", nowFav ? "true" : "false");
      favBtn.setAttribute("aria-label", nextLabel);
      favBtn.title = nextLabel;
      favBtn.innerHTML = iconSvg(nowFav ? "starFill" : "star", 15);
      if (callbacks.sayfa().tur === "yakin") callbacks.panelYenile();
    });

    const box = modalEl();
    box.querySelectorAll("[data-durak-rota]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const alan = btn.dataset.durakRota;
        const yer = {
          ad: bas(stop.ad),
          alt: stop.kod ? t("common.stopCode", { kod: stop.kod }) : t("common.stop"),
          lat: stop.lat,
          lon: stop.lon,
          tur: stop.tur || "durak",
          durak: true,
          kod: stop.kod,
        };
        close();
        callbacks.setRoutePlace(alan, yer);
      });
    });

    const govde = document.querySelector("#modalGovde");
    if (!govde) return;

    try {
      const kalkislar = [];
      const simdi = Zaman.simdi();

      // 1) Transitous stop times if available (scheduled + RT)
      const trStopId = stop.stopId || stop.id;
      if (trStopId && typeof API.transitous?.durakSaatleri === "function") {
        try {
          const st = await API.transitous.durakSaatleri(trStopId);
          for (const item of st || []) {
            const isoRaw = item.kalkisISO || item.iso || item.scheduledTime || item.realTimeDeparture;
            let dk = item.zaman ? Zaman.dk(item.zaman) : null;
            if (dk == null && isoRaw) {
              const parsed = new Date(isoRaw).getTime();
              if (isFinite(parsed)) dk = Math.round((parsed - Date.now()) / 60000 + simdi);
            }
            const kalan = dk != null ? dk - simdi : item.kalanDk;
            if (kalan != null && kalan >= -1 && kalan <= 180) {
              kalkislar.push({
                hat: item.hat || item.routeShortName || "?",
                yon: item.yon || item.headsign || "",
                kalan: Math.max(0, Math.round(kalan)),
                saatStr: dk != null ? saat(dk) : "",
                canli: Boolean(item.canli || item.realTime),
                renk: renkKod(item.hat || item.routeShortName || ""),
              });
            }
          }
        } catch {
          // ignore Transitous stop board errors
        }
      }

      // 2) Fast <50ms lookup via S.stopLinesIndex (fallback to S.ag)
      const hatlar = new Set(stop.hatlar || []);
      if (stop.kod && S.stopLinesIndex) {
        const indexed = typeof S.stopLinesIndex.get === "function" ? S.stopLinesIndex.get(stop.kod) : S.stopLinesIndex[stop.kod];
        if (indexed) {
          for (const h of indexed) hatlar.add(h);
        }
      } else if (S.ag && stop.kod) {
        const idx = S.ag.duraklar.findIndex((d) => d.kod === stop.kod);
        if (idx >= 0) {
          const dd = S.ag.desenDurak[idx] || [];
          for (let q = 0; q < dd.length; q += 2) {
            const p = S.ag.desenler[dd[q]];
            if (p?.hat) hatlar.add(p.hat);
          }
        }
      }

      const hatList = [...hatlar].slice(0, 6);
      await Promise.all(
        hatList.map(async (hat) => {
          try {
            const v = await mc.hatHazirla(hat);
            if (!v.zaman || Date.now() - v.zaman > 20e3) {
              mc.konumIsle(hat, await API.iett.konum(hat));
            }
            for (const [yon, liste] of Object.entries(v.duraklar || {})) {
              const i = stop.kod
                ? liste.findIndex((d) => d.kod === stop.kod)
                : Core.enYakinIndex(liste, stop).metre < 120
                ? Core.enYakinIndex(liste, stop).index
                : -1;
              if (i < 0) continue;
              const gel = mc.yaklasanOtobusler(hat, yon, i).slice(0, 2);
              for (const g of gel) {
                kalkislar.push({
                  hat,
                  yon: bas(liste[liste.length - 1]?.ad || g.bus.yonAdi || ""),
                  kalan: g.t.dakika,
                  saatStr: saat(simdi + g.t.dakika),
                  canli: true,
                  kapino: g.bus.kapino,
                  renk: v.renk || renkKod(hat),
                });
              }
            }
          } catch {
            // ignore line error
          }
        })
      );

      if (!document.querySelector("#modalGovde")) return;

      kalkislar.sort((a, b) => a.kalan - b.kalan);
      const tekil = [];
      const gor = new Set();
      for (const k of kalkislar) {
        const key = `${k.hat}|${k.kapino || k.saatStr}`;
        if (gor.has(key)) continue;
        gor.add(key);
        tekil.push(k);
      }

      if (!tekil.length) {
        govde.innerHTML = `<div class="bos">${esc(t("modal.noDepartures"))}</div>`;
        return;
      }

      govde.innerHTML = `<div class="liste">${tekil
        .slice(0, 15)
        .map(
          (k) => `
          <div class="kart satir tik" role="button" tabindex="0" data-modal-hat="${esc(k.hat)}" ${k.kapino ? `data-modal-arac="${esc(k.kapino)}"` : ""}>
            <div class="kart-sol">
              <div class="bas">
                <span class="rozet" style="${accessibleBadgeStyle(k.renk)}">${esc(k.hat)}</span>
                <span>→ ${esc(k.yon || t("modal.center"))}</span>
              </div>
              <div class="alt">
                ${k.canli ? `<span class="canli">${esc(t("common.live"))}</span>` : `<span class="rozet soluk">${esc(t("common.schedule"))}</span>`}
                ${k.kapino ? `<span>${esc(k.kapino)}</span>` : ""}
                ${k.saatStr ? `<span>· ${esc(k.saatStr)}</span>` : ""}
              </div>
            </div>
            <div class="kart-sag">${sureEtiket(k.kalan)}</div>
          </div>`
        )
        .join("")}</div>`;

      govde.querySelectorAll("[data-modal-hat]").forEach((row) => {
        row.addEventListener("click", () => {
          const hat = row.dataset.modalHat;
          const kapino = row.dataset.modalArac;
          close();
          if (kapino) mc.aracOdakla(hat, kapino);
          else callbacks.git({ tur: "hat", hat });
        });
      });
    } catch (e) {
      if (govde) govde.innerHTML = `<div class="duyuru hata"><span class="duyuru-ikon">${iconSvg("alert", 18)}</span><span>${esc(hataMesaji(e))}</span></div>`;
    }
  }

  // ---------------- 2) İSPARK Detay ----------------
  function openIspark(park) {
    const kap = Math.max(1, park.kapasite || 0);
    const bos = Math.max(0, park.bos || 0);
    const doluOran = Math.min(100, Math.max(0, Math.round(((kap - bos) / kap) * 100)));
    const bosOran = park.kapasite > 0 ? bos / park.kapasite : 0;
    const barRenk = bosOran > 0.3 ? "var(--iyi)" : bosOran >= 0.1 ? "var(--uyari)" : "var(--hata)";
    const mesafeYazi = S.ben ? ` · ${metre(Core.mesafe(S.ben, park))}` : "";

    renderBox(`
      <div class="modal-baslik">
        <div>
          <h3 id="modalBaslik">${iconSvg("ispark", 18)} ${esc(bas(park.ad))}</h3>
          <div class="alt">${esc(park.ilce || "İstanbul")}${park.tip ? ` · ${esc(park.tip)}` : ""}${mesafeYazi}</div>
        </div>
        <button type="button" class="btn ikon" data-modal-kapat aria-label="${esc(t("common.close"))}">${iconSvg("close", 18)}</button>
      </div>
      <div class="kart">
        <div class="bas" style="justify-content:space-between">
          <span>${esc(t("modal.isparkEmpty"))}</span>
          <span class="sure ${bosOran > 0.3 ? "yakin" : ""}">${esc(t("modal.isparkSpaces", { empty: bos, cap: park.kapasite || "–" }))}</span>
        </div>
        <div class="doluluk-bar"><span style="width:${doluOran}%;background:${barRenk}"></span></div>
        <div class="alt" style="justify-content:space-between;margin-top:4px">
          <span>${esc(t("modal.isparkOccupancy", { pct: doluOran }))}</span>
          <span>${esc(park.isOpen ? t("modal.isparkOpen") : t("modal.isparkClosed"))}</span>
        </div>
      </div>
      <div class="kart">
        <div class="alt">${iconSvg("clock", 14)} ${esc(t("modal.isparkHours"))}: <b style="color:var(--yazi)">${esc(park.saatler || t("modal.ispark24h"))}</b></div>
        ${park.ucretsizDk ? `<div class="alt">${esc(t("modal.isparkFree"))}: <b style="color:var(--yazi)">${esc(t("modal.isparkFirstMin", { n: park.ucretsizDk }))}</b></div>` : ""}
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button type="button" class="btn birincil" style="flex:1" id="isparkRotaBtn">${iconSvg("rota", 16)} ${esc(t("modal.isparkRoute"))}</button>
      </div>
    `);

    document.querySelector("#isparkRotaBtn")?.addEventListener("click", () => {
      close();
      callbacks.setRoutePlace("nereye", {
        ad: bas(park.ad),
        alt: t("modal.isparkParking"),
        lat: park.lat,
        lon: park.lon,
        tur: "yer",
      });
    });
  }

  // ---------------- 3) Görünüm & Ayarlar ----------------
  function renderHealthRows(health, gmaps) {
    const providers = [
      { key: "iett", label: "İETT" },
      { key: "metro", label: "Metro İstanbul" },
      { key: "tkm", label: "İBB Trafik (TKM)" },
      { key: "vapur", label: "Şehir Hatları / Vapur" },
      { key: "ispark", label: "İSPARK" },
      { key: "transitous", label: "Transitous / MOTIS" },
      { key: "sse", label: "SSE Live Stream" },
    ];

    const badge = (status) => {
      if (status === "ok" || status === "healthy" || status === true) {
        return `<span class="durum-rozet iyi">${esc(t("settings.statusOk"))}</span>`;
      }
      if (status === "degraded" || status === "warn" || status === "fallback") {
        return `<span class="durum-rozet uyari">${esc(t("settings.statusWarn"))}</span>`;
      }
      if (status === "unconfigured") {
        return `<span class="durum-rozet soluk">${esc(t("settings.statusUnconfigured"))}</span>`;
      }
      return `<span class="durum-rozet hata">${esc(t("settings.statusDown"))}</span>`;
    };

    const rows = providers.map((p) => {
      const info = health?.[p.key] || health?.providers?.[p.key];
      const st = info?.status ?? (info?.ok === true ? "ok" : info?.ok === false ? "down" : "ok");
      const lat = info?.latencyMs != null ? `<span class="alt">${Math.round(info.latencyMs)} ms</span>` : "";
      return `<div class="saglik-satir"><span>${esc(p.label)}</span><span style="display:flex;align-items:center;gap:6px">${lat}${badge(st)}</span></div>`;
    });

    const gmStatus = gmaps?.available ? "ok" : gmaps?.configured === false ? "unconfigured" : "down";
    rows.push(`<div class="saglik-satir"><span>Google Maps Platform</span><span>${badge(gmStatus)}</span></div>`);
    return rows.join("");
  }

  function openSettings() {
    const tema = S.theme || "system";
    const stil = S.mapStyle || "standart";
    const proxy = S.proxyUrl || "";
    const lang = getLang();

    renderBox(`
      <div class="modal-baslik">
        <h3 id="modalBaslik">${iconSvg("settings", 18)} ${esc(t("settings.title"))}</h3>
        <button type="button" class="btn ikon" data-modal-kapat aria-label="${esc(t("common.close"))}">${iconSvg("close", 18)}</button>
      </div>

      <div class="baslik-satir"><h3>${esc(t("settings.language"))}</h3></div>
      <div class="segment" id="langSegment" role="group" aria-label="${esc(t("settings.language"))}">
        <button type="button" data-lang="tr" class="${lang === "tr" ? "aktif" : ""}" aria-pressed="${lang === "tr" ? "true" : "false"}">Türkçe</button>
        <button type="button" data-lang="en" class="${lang === "en" ? "aktif" : ""}" aria-pressed="${lang === "en" ? "true" : "false"}">English</button>
      </div>

      <div class="baslik-satir"><h3>${esc(t("settings.theme"))}</h3></div>
      <div class="segment" id="temaSegment" role="group" aria-label="${esc(t("settings.theme"))}">
        <button type="button" data-tema="system" class="${tema === "system" ? "aktif" : ""}" aria-pressed="${tema === "system" ? "true" : "false"}">${esc(t("settings.themeSystem"))}</button>
        <button type="button" data-tema="light" class="${tema === "light" ? "aktif" : ""}" aria-pressed="${tema === "light" ? "true" : "false"}">${iconSvg("sun", 15)} ${esc(t("settings.themeLight"))}</button>
        <button type="button" data-tema="dark" class="${tema === "dark" ? "aktif" : ""}" aria-pressed="${tema === "dark" ? "true" : "false"}">${iconSvg("moon", 15)} ${esc(t("settings.themeDark"))}</button>
      </div>

      <div class="baslik-satir"><h3>${esc(t("settings.mapStyle"))}</h3></div>
      <div class="segment" id="haritaStilSegment" role="group" aria-label="${esc(t("settings.mapStyle"))}">
        <button type="button" data-stil="standart" class="${stil === "standart" ? "aktif" : ""}" aria-pressed="${stil === "standart" ? "true" : "false"}">${esc(t("settings.styleStandard"))}</button>
        <button type="button" data-stil="sade" class="${stil === "sade" ? "aktif" : ""}" aria-pressed="${stil === "sade" ? "true" : "false"}">${esc(t("settings.styleClean"))}</button>
        <button type="button" data-stil="osm" class="${stil === "osm" ? "aktif" : ""}" aria-pressed="${stil === "osm" ? "true" : "false"}">${esc(t("settings.styleOsm"))}</button>
      </div>

      <div class="baslik-satir"><h3>${esc(t("settings.providerHealth"))}</h3></div>
      <div class="kart" id="providerHealthBox" style="margin-bottom:10px">
        ${renderHealthRows(null, null)}
      </div>

      <div class="baslik-satir"><h3>${esc(t("settings.proxy"))}</h3></div>
      <div class="kart" style="margin-bottom:10px">
        <label class="alt" for="proxyInput">${esc(t("settings.proxyHint"))}</label>
        <div style="display:flex;gap:8px">
          <input class="giris" id="proxyInput" type="url" placeholder="https://ornek.pages.dev" value="${esc(proxy)}">
          <button type="button" class="btn" id="proxyKaydetBtn">${esc(t("common.save"))}</button>
        </div>
      </div>

      <button type="button" class="ayar-satir tik" id="cacheTemizleBtn">
        <span class="ayar-bilgi">
          <span class="ayar-baslik">${esc(t("settings.clearCache"))}</span>
          <span class="ayar-alt">${esc(t("settings.clearCacheDesc"))}</span>
        </span>
        <span class="btn kucuk" aria-hidden="true">${iconSvg("refresh", 14)} ${esc(t("common.clear"))}</span>
      </button>

      <div class="kart" style="margin-top:12px">
        <div class="bas">İstanbul Ulaşım v5.0</div>
        <div class="alt">İETT · Metro İstanbul · TCDD Marmaray · Şehir Hatları · İSPARK · TKM · Transitous</div>
      </div>
    `);

    // Populate live provider health asynchronously without blocking modal open
    Promise.all([
      typeof DataProvider?.getHealth === "function"
        ? Promise.resolve().then(() => DataProvider.getHealth()).catch(() => null)
        : Promise.resolve(null),
      typeof GoogleMapsService?.checkAvailability === "function" ? GoogleMapsService.checkAvailability().catch(() => null) : Promise.resolve(null),
    ]).then(([health, gmaps]) => {
      const box = document.querySelector("#providerHealthBox");
      if (box) box.innerHTML = renderHealthRows(health, gmaps);
    });

    document.querySelectorAll("#langSegment button").forEach((b) => {
      b.addEventListener("click", () => {
        const nextLang = b.dataset.lang;
        setLang(nextLang);
        KV.set("lang", nextLang);
        openSettings();
        callbacks.ciz(false);
      });
    });

    document.querySelectorAll("#temaSegment button").forEach((b) => {
      b.addEventListener("click", () => {
        callbacks.applyTheme(b.dataset.tema);
        document.querySelectorAll("#temaSegment button").forEach((x) => {
          const active = x === b;
          x.classList.toggle("aktif", active);
          x.setAttribute("aria-pressed", active ? "true" : "false");
        });
      });
    });

    document.querySelectorAll("#haritaStilSegment button").forEach((b) => {
      b.addEventListener("click", () => {
        applyMapStyle(S, mc, b.dataset.stil);
        document.querySelectorAll("#haritaStilSegment button").forEach((x) => {
          const active = x === b;
          x.classList.toggle("aktif", active);
          x.setAttribute("aria-pressed", active ? "true" : "false");
        });
      });
    });

    document.querySelector("#proxyKaydetBtn")?.addEventListener("click", () => {
      const val = document.querySelector("#proxyInput")?.value.trim() || "";
      saveProxyUrl(S, val);
      const btn = document.querySelector("#proxyKaydetBtn");
      if (btn) btn.textContent = t("common.saved");
    });

    document.querySelector("#cacheTemizleBtn")?.addEventListener("click", async () => {
      try {
        if (typeof KV.clear === "function") await KV.clear();
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith("ulasim.") && k !== "ulasim.lang") localStorage.removeItem(k);
        }
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
        const alt = document.querySelector("#cacheTemizleBtn .ayar-alt");
        if (alt) alt.textContent = t("settings.clearCacheDone");
      } catch {
        // ignore
      }
    });
  }

  return {
    isOpen,
    close,
    openStopBoard,
    openIspark,
    openSettings,
  };
}
