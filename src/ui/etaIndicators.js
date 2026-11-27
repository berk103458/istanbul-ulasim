/**
 * İstanbul Ulaşım — ETA Confidence, Freshness & Status Indicators
 * Maps EtaEngine (durumKod, guven, sonGuncellemeSn) and schedule/fallback data
 * to honest, unambiguous UI badges and pills.
 */
import { t } from "../i18n/index.js";
import { parseIettGpsTimestamp, STALE_GPS_SEC } from "../engines/etaEngine.js";

export { parseIettGpsTimestamp as parseGpsTimestampMs, STALE_GPS_SEC };
export const FRESH_GPS_SEC = 60;

const VALID_DURUM = new Set(["ON_TIME", "DELAYED", "OFF_ROUTE", "STALE", "AT_TERMINAL"]);
const VALID_GUVEN = new Set(["high", "medium", "low"]);

function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

/**
 * Compute GPS signal age in seconds from a raw timestamp, or null when missing/invalid.
 * @param {string|number|null|undefined} zaman
 * @param {number} [nowMs=Date.now()]
 * @returns {number|null}
 */
export function parseGpsAgeSec(zaman, nowMs = Date.now()) {
  const ms = parseIettGpsTimestamp(zaman, nowMs);
  if (ms == null) return null;
  return Math.round((nowMs - ms) / 1000);
}

/**
 * Format GPS age in seconds into localized text.
 * @param {number|null|undefined} ageSec
 * @param {{ includePrefix?: boolean }} [opts]
 * @returns {string}
 */
export function formatGpsAge(ageSec, { includePrefix = false } = {}) {
  if (ageSec == null || !Number.isFinite(ageSec)) {
    return t("eta.gpsUnknown");
  }
  const sec = Math.max(0, Math.round(ageSec));
  let rel;
  if (sec < 90) {
    rel = t("eta.secAgo", { n: sec });
  } else if (sec < 3600) {
    rel = t("eta.minAgo", { n: Math.round(sec / 60) });
  } else {
    rel = t("eta.hourAgo", { n: Math.round(sec / 3600) });
  }
  return includePrefix ? t("eta.gpsAge", { age: rel }) : rel;
}

function classifyGpsTier(ageSec) {
  if (ageSec == null || !Number.isFinite(ageSec)) return "missing";
  if (ageSec > STALE_GPS_SEC) return "stale";
  if (ageSec <= FRESH_GPS_SEC) return "fresh";
  return "aging";
}

/**
 * Normalize an ETA object (from EtaEngine, Core fallback, or schedule feed) into a UI trust model.
 * Guarantees:
 * - Schedule estimates are never marked live.
 * - Stale signals (>240s or durumKod === "STALE") are separated from live estimates.
 * - Missing GPS age or missing engine metadata never shows "high" confidence or live "arriving".
 * @param {object|null|undefined} eta
 * @param {{ scheduled?: boolean, fallbackAgeSec?: number|null, saatStr?: string, realtimeFeed?: boolean }} [opts]
 */
export function describeEtaTrust(eta, opts = {}) {
  const isScheduled = Boolean(
    opts.scheduled ||
      eta?.scheduled ||
      eta?.tarife ||
      eta?.kaynak === "tarife" ||
      eta?.kaynak === "schedule" ||
      eta?.durumKod === "SCHEDULED"
  );

  const rawDakika = Number.isFinite(eta?.dakika) ? Math.max(0, Math.round(eta.dakika)) : null;

  if (isScheduled) {
    let pillText = opts.saatStr || "–";
    if (rawDakika != null) {
      pillText = rawDakika <= 1 ? opts.saatStr || t("eta.schedSoon") : t("eta.min", { n: rawDakika });
    }
    return {
      mode: "schedule",
      isLive: false,
      isScheduled: true,
      isStale: false,
      isOffRoute: false,
      isMissing: false,
      durumKod: "SCHEDULED",
      guven: null,
      sonGuncellemeSn: null,
      gpsTier: "none",
      dakika: rawDakika,
      pillClass: "sure tarife",
      pillText,
      rowClass: "eta-tarife",
      cardClass: "eksik-kart",
      canSurgicalUpdate: false,
      notice: "",
    };
  }

  const ageSec = Number.isFinite(eta?.sonGuncellemeSn)
    ? Math.max(0, Math.round(eta.sonGuncellemeSn))
    : Number.isFinite(opts.fallbackAgeSec)
    ? Math.max(0, Math.round(opts.fallbackAgeSec))
    : null;
  const gpsTier = classifyGpsTier(ageSec);
  const rawDurum = VALID_DURUM.has(eta?.durumKod) ? eta.durumKod : null;
  const rawGuven = VALID_GUVEN.has(eta?.guven) ? eta.guven : null;

  // Missing ETA value completely
  if (!eta || rawDakika == null) {
    return {
      mode: "missing",
      isLive: false,
      isScheduled: false,
      isStale: false,
      isOffRoute: false,
      isMissing: true,
      durumKod: rawDurum,
      guven: null,
      sonGuncellemeSn: ageSec,
      gpsTier,
      dakika: null,
      pillClass: "sure eksik",
      pillText: "–",
      rowClass: "eta-eksik",
      cardClass: "eksik-kart",
      canSurgicalUpdate: false,
      notice: t("eta.dataMissing"),
    };
  }

  // Off-route vehicle
  if (rawDurum === "OFF_ROUTE") {
    return {
      mode: "off_route",
      isLive: false,
      isScheduled: false,
      isStale: gpsTier === "stale",
      isOffRoute: true,
      isMissing: false,
      durumKod: "OFF_ROUTE",
      guven: "low",
      sonGuncellemeSn: ageSec,
      gpsTier,
      dakika: rawDakika,
      pillClass: "sure eski",
      pillText: t("eta.approxMin", { n: Math.max(1, rawDakika) }),
      rowClass: "eta-uyari",
      cardClass: "uyari-kart",
      canSurgicalUpdate: false,
      notice: t("eta.offRouteNotice"),
    };
  }

  // The engine also returns STALE when the timestamp is missing.
  if (ageSec != null && (rawDurum === "STALE" || ageSec > STALE_GPS_SEC)) {
    return {
      mode: "stale",
      isLive: false,
      isScheduled: false,
      isStale: true,
      isOffRoute: false,
      isMissing: false,
      durumKod: "STALE",
      guven: "low",
      sonGuncellemeSn: ageSec,
      gpsTier: "stale",
      dakika: rawDakika,
      pillClass: "sure eski",
      pillText: t("eta.approxMin", { n: Math.max(1, rawDakika) }),
      rowClass: "eta-eski",
      cardClass: "eski-kart",
      canSurgicalUpdate: false,
      notice: t("eta.staleNotice", { age: formatGpsAge(ageSec) }),
    };
  }

  // Real-time feed (e.g. Transitous GTFS-RT) that lacks per-vehicle GPS timestamp
  if (opts.realtimeFeed && ageSec == null && !rawDurum) {
    return {
      mode: "rt_feed",
      isLive: true,
      isScheduled: false,
      isStale: false,
      isOffRoute: false,
      isMissing: true,
      durumKod: null,
      guven: "unknown",
      sonGuncellemeSn: null,
      gpsTier: "missing",
      dakika: rawDakika,
      pillClass: "sure",
      pillText: t("eta.min", { n: Math.max(1, rawDakika) }),
      rowClass: "",
      cardClass: "eksik-kart",
      canSurgicalUpdate: false,
      notice: t("eta.missingGpsNotice"),
    };
  }

  // Missing GPS timestamp or missing EtaEngine metadata -> do not present false precision/high confidence
  if (ageSec == null || !rawDurum) {
    const guven = ageSec != null && rawGuven === "low" ? "low" : "unknown";
    return {
      mode: "missing",
      isLive: false,
      isScheduled: false,
      isStale: false,
      isOffRoute: false,
      isMissing: true,
      durumKod: rawDurum === "STALE" ? null : rawDurum,
      guven,
      sonGuncellemeSn: ageSec,
      gpsTier,
      dakika: rawDakika,
      pillClass: "sure eksik",
      pillText: t("eta.min", { n: Math.max(1, rawDakika) }),
      rowClass: "eta-eksik",
      cardClass: "eksik-kart",
      canSurgicalUpdate: false,
      notice: t("eta.missingGpsNotice"),
    };
  }

  // Fresh, verified live telemetry (ON_TIME | DELAYED | AT_TERMINAL)
  const guven = rawGuven || "unknown";
  const allowArriving = rawDurum !== "AT_TERMINAL" && guven !== "low" && guven !== "unknown";
  const pillClass =
    guven === "low"
      ? "sure eski"
      : allowArriving && rawDakika <= 3
      ? "sure yakin"
      : "sure";
  const pillText =
    allowArriving && rawDakika <= 1
      ? t("eta.arriving")
      : guven === "low"
      ? t("eta.approxMin", { n: Math.max(1, rawDakika) })
      : t("eta.min", { n: Math.max(1, rawDakika) });

  return {
    mode: rawDurum === "DELAYED" ? "delayed" : rawDurum === "AT_TERMINAL" ? "terminal" : "live",
    isLive: true,
    isScheduled: false,
    isStale: false,
    isOffRoute: false,
    isMissing: false,
    durumKod: rawDurum,
    guven,
    sonGuncellemeSn: ageSec,
    gpsTier,
    dakika: rawDakika,
    pillClass,
    pillText,
    rowClass: "",
    cardClass: "canli-kart",
    canSurgicalUpdate: allowArriving,
    notice: rawDurum === "AT_TERMINAL" ? t("eta.terminalNotice") : "",
  };
}

/**
 * Render status, live/schedule, and confidence badges HTML.
 * @param {ReturnType<typeof describeEtaTrust>} info
 * @param {{ compact?: boolean, showLive?: boolean, showOnTime?: boolean }} [opts]
 * @returns {string}
 */
export function renderTrustBadgesHTML(info, { compact = false, showLive = true, showOnTime = false } = {}) {
  if (!info) return "";
  const out = [];

  if (info.isScheduled) {
    out.push(`<span class="durum-rozet tarife">${escHtml(t("eta.sourceSchedule"))}</span>`);
    return out.join("");
  }

  if (showLive && info.isLive) {
    out.push(`<span class="canli">${escHtml(t("common.live"))}</span>`);
  }

  if (info.durumKod === "STALE") {
    out.push(`<span class="durum-rozet eski">${escHtml(t("eta.status.STALE"))}</span>`);
  } else if (info.durumKod === "OFF_ROUTE") {
    out.push(`<span class="durum-rozet hata">${escHtml(t("eta.status.OFF_ROUTE"))}</span>`);
  } else if (info.durumKod === "DELAYED") {
    out.push(`<span class="durum-rozet uyari">${escHtml(t("eta.status.DELAYED"))}</span>`);
  } else if (info.durumKod === "AT_TERMINAL") {
    out.push(`<span class="durum-rozet bilgi">${escHtml(t("eta.status.AT_TERMINAL"))}</span>`);
  } else if (info.durumKod === "ON_TIME" && showOnTime && !compact && !info.isMissing) {
    out.push(`<span class="durum-rozet iyi">${escHtml(t("eta.status.ON_TIME"))}</span>`);
  }

  if (info.guven === "high") {
    out.push(`<span class="durum-rozet iyi eta-guven">${escHtml(t("eta.conf.high"))}</span>`);
  } else if (info.guven === "medium") {
    out.push(`<span class="durum-rozet uyari eta-guven">${escHtml(t("eta.conf.medium"))}</span>`);
  } else if (info.guven === "low") {
    out.push(`<span class="durum-rozet hata eta-guven">${escHtml(t("eta.conf.low"))}</span>`);
  } else if (info.guven === "unknown") {
    out.push(`<span class="durum-rozet soluk eta-guven">${escHtml(t("eta.conf.unknown"))}</span>`);
  } else if (info.isMissing && info.dakika == null) {
    out.push(`<span class="durum-rozet soluk">${escHtml(t("eta.dataMissing"))}</span>`);
  }

  return out.join("");
}

/**
 * Render GPS age span HTML.
 * @param {ReturnType<typeof describeEtaTrust>} info
 * @param {{ prefix?: boolean, liveMs?: number|null }} [opts]
 * @returns {string}
 */
export function renderGpsAgeHTML(info, { prefix = true, liveMs = null } = {}) {
  if (!info || info.isScheduled) return "";
  const cls =
    info.gpsTier === "fresh"
      ? "taze"
      : info.gpsTier === "stale"
      ? "eski"
      : info.gpsTier === "aging"
      ? "orta"
      : "eksik";

  if (info.sonGuncellemeSn == null) {
    return `<span class="gps-yas ${cls}">${escHtml(t("eta.gpsUnknown"))}</span>`;
  }

  const ageOnly = formatGpsAge(info.sonGuncellemeSn, { includePrefix: false });
  const liveAttr =
    liveMs != null && Number.isFinite(liveMs) && liveMs > 0
      ? ` data-live-age="${Math.round(liveMs)}"`
      : "";

  if (!prefix) {
    return `<span class="gps-yas ${cls}"${liveAttr}>${escHtml(ageOnly)}</span>`;
  }

  if (liveAttr) {
    const inner = `<span${liveAttr}>${escHtml(ageOnly)}</span>`;
    const wrapped = escHtml(t("eta.gpsAge", { age: "__AGE__" })).replace("__AGE__", inner);
    return `<span class="gps-yas ${cls}">${wrapped}</span>`;
  }

  return `<span class="gps-yas ${cls}">${escHtml(formatGpsAge(info.sonGuncellemeSn, { includePrefix: true }))}</span>`;
}

/**
 * Render ETA time pill HTML.
 * @param {ReturnType<typeof describeEtaTrust>} info
 * @returns {string}
 */
export function renderEtaPillHTML(info) {
  if (!info) return `<span class="sure eksik">–</span>`;
  const titleAttr = info.notice ? ` title="${escHtml(info.notice)}"` : "";
  return `<span class="${escHtml(info.pillClass)}"${titleAttr}>${escHtml(info.pillText)}</span>`;
}

/**
 * Summarize GPS freshness across a line's active vehicles for the line header.
 * @param {Array<{ zaman?: string|number }>} vehicles
 * @param {number} [nowMs=Date.now()]
 * @returns {{ state: "none"|"live"|"stale"|"missing", freshestSec: number|null, freshestMs: number|null }}
 */
export function summarizeVehiclesFreshness(vehicles, nowMs = Date.now()) {
  const list = Array.isArray(vehicles) ? vehicles : [];
  if (!list.length) return { state: "none", freshestSec: null, freshestMs: null };

  let freshestMs = null;
  for (const v of list) {
    const ms = parseIettGpsTimestamp(v?.zaman, nowMs);
    if (ms != null && (freshestMs == null || ms > freshestMs)) freshestMs = ms;
  }
  if (freshestMs == null) return { state: "missing", freshestSec: null, freshestMs: null };
  const freshestSec = Math.round((nowMs - freshestMs) / 1000);
  return { state: freshestSec > STALE_GPS_SEC ? "stale" : "live", freshestSec, freshestMs };
}
