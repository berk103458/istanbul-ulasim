import { Core } from "../core/geo.js";

const DAY_MS = 86_400_000;
const TURKEY_OFFSET_MS = 3 * 3_600_000;
export const STALE_GPS_SEC = 240;

// İETT sends contemporary Türkiye wall time when the feed omits an offset.
export function parseIettGpsTimestamp(value, now = Date.now()) {
  let timestamp = value;
  if (typeof value === "string") {
    const input = value.trim();
    const clock = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(input);
    if (clock) {
      const [, hour, minute, second = "00"] = clock;
      if (+hour > 23 || +minute > 59 || +second > 59) return null;
      const today = Math.floor((now + TURKEY_OFFSET_MS) / DAY_MS) * DAY_MS - TURKEY_OFFSET_MS;
      timestamp = today + (+hour * 3600 + +minute * 60 + +second) * 1000;
      // Resolve clock-only updates to the nearest day, including just after midnight.
      if (timestamp - now > DAY_MS / 2) timestamp -= DAY_MS;
    } else {
      const date = /^(\d{4}-\d{2}-\d{2})[T ]((?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?$/i.exec(input);
      if (!date) return null;
      const [, day, time, offset] = date;
      const localMs = Date.parse(`${day}T${time}Z`);
      if (!Number.isFinite(localMs) || new Date(localMs).toISOString().slice(0, 10) !== day) return null;
      timestamp = offset ? Date.parse(`${day}T${time}${offset}`) : localMs - TURKEY_OFFSET_MS;
    }
  }
  return Number.isFinite(timestamp) && timestamp > 0 && timestamp <= now ? timestamp : null;
}

/**
 * 9-Factor Dynamic Bus & Metrobus ETA Prediction Engine.
 * Distinguishes live GPS telemetry from scheduled/corridor estimates and detects anomalies honestly.
 */
export const EtaEngine = (() => {
  const YOL_KATSAYISI = 1.15;
  const OFF_ROUTE_M = 450;

  /**
   * Predicts dynamic ETA for `bus` arriving at `duraklar[hedefIndex]`.
   * @param {Array} duraklar
   * @param {object} bus
   * @param {number} hedefIndex
   * @param {object} [ctx]
   * @returns {{
   *   durakSayisi: number,
   *   metre: number,
   *   dakika: number,
   *   saniye: number,
   *   hizKmSa: number,
   *   trafikEtkisiDk: number,
   *   trafficFactored: boolean,
   *   kazaEtkisiDk: number,
   *   duraklamaDk: number,
   *   gecikmeDk: number,
   *   durumKod: "ON_TIME"|"DELAYED"|"OFF_ROUTE"|"STALE"|"AT_TERMINAL",
   *   durumEtiket: string,
   *   guven: "high"|"medium"|"low",
   *   sonGuncellemeSn: number | null,
   *   plaka: string,
   *   operator: string
   * } | null}
   */
  function predict(duraklar, bus, hedefIndex, ctx = {}) {
    if (!Array.isArray(duraklar) || !Core.gecerliKonum(bus) || Math.abs(bus.lat) > 90 || Math.abs(bus.lon) > 180 ||
        !Number.isInteger(hedefIndex) || hedefIndex < 0 || hedefIndex >= duraklar.length) {
      return null;
    }
    for (const durak of duraklar) {
      if (!Core.gecerliKonum(durak)) return null;
    }
    ctx ??= {};

    const now = Date.now();
    const gpsMs = parseIettGpsTimestamp(ctx.fleetItem?.zaman ?? bus.zaman, now);
    const sonGuncellemeSn = gpsMs == null ? null : Math.round((now - gpsMs) / 1000);
    const freshGps = sonGuncellemeSn != null && sonGuncellemeSn <= STALE_GPS_SEC;

    const nearest = Core.enYakinIndex(duraklar, bus);
    const siradaki = Core.siradakiDurak(duraklar, bus);
    if (siradaki < 0 || siradaki > hedefIndex) return null;

    // 1. Remaining route distance
    let metre = Core.mesafe(bus, duraklar[siradaki]);
    for (let k = siradaki; k < hedefIndex; k++) {
      metre += Core.mesafe(duraklar[k], duraklar[k + 1]);
    }
    metre = Math.round(metre * YOL_KATSAYISI);
    const durakSayisi = Math.max(0, hedefIndex - siradaki);

    // 2. Base speed & live telemetry speed
    const hat = ctx.hatBilgi;
    const schedSpeed = Core.ortalamaHiz({
      uzunlukKm: hat?.uzunlukKm ?? hat?.km,
      seferSuresiDk: hat?.seferSuresiDk ?? hat?.dk,
    });
    const fleetSpeed = Number(ctx.fleetItem?.hiz ?? bus.hiz ?? NaN);
    const obsSpeed = Number(ctx.observedSpeedKmH ?? NaN);
    let hizKmSa = schedSpeed;
    if (freshGps && Number.isFinite(obsSpeed) && obsSpeed >= 4) {
      hizKmSa = obsSpeed;
    } else if (freshGps && Number.isFinite(fleetSpeed) && fleetSpeed >= 4) {
      hizKmSa = fleetSpeed * 0.6 + schedSpeed * 0.4;
    }

    // 3. Corridor traffic speed
    let trafikEtkisiDk = 0;
    const te = ctx.trafficEngine;
    const targetStop = duraklar[hedefIndex];
    const corridor = te && typeof te.getCorridorSpeed === "function" ? te.getCorridorSpeed(bus, targetStop) : null;
    const hasCorridorSpeed = Number.isFinite(corridor?.speedKmH) && corridor.speedKmH > 2;
    if (hasCorridorSpeed) {
      const effectiveSpeed = Math.min(35, Math.max(5, corridor.speedKmH * 0.72));
      const baseTravelDk = (metre / 1000 / hizKmSa) * 60;
      const trafficTravelDk = (metre / 1000 / effectiveSpeed) * 60;
      trafikEtkisiDk = Math.max(0, Math.round((trafficTravelDk - baseTravelDk) * 10) / 10);
      hizKmSa = Math.round(((hizKmSa + effectiveSpeed) / 2) * 10) / 10;
    }

    // 4. Incident penalty
    let kazaEtkisiDk = 0;
    if (te && typeof te.getIncidentPenalty === "function") {
      const incRes = te.getIncidentPenalty(bus, targetStop);
      if (Number.isFinite(incRes?.penaltyMin)) kazaEtkisiDk = incRes.penaltyMin;
    } else if (Array.isArray(ctx.incidents) && ctx.incidents.length) {
      const mid = { lat: (bus.lat + targetStop.lat) / 2, lon: (bus.lon + targetStop.lon) / 2 };
      const hasNear = ctx.incidents.some((i) => Core.gecerliKonum(i) && Core.mesafe(mid, i) <= 750);
      if (hasNear) kazaEtkisiDk = 4;
    }

    // 5. Stop dwell time (~21s per intermediate stop)
    const duraklamaDk = Math.round(durakSayisi * 0.35 * 10) / 10;

    // 6. Total dynamic ETA vs scheduled ETA
    const baseRunDk = (metre / 1000 / Math.max(5, hizKmSa)) * 60;
    const offset = Number(ctx.scheduledOffsetMin);
    const schedOffset = Number.isFinite(offset) ? offset : 0;
    const totalDk = Math.max(0, baseRunDk + duraklamaDk + trafikEtkisiDk + kazaEtkisiDk + schedOffset);
    const scheduledDk = Math.max(0.5, (metre / 1000 / Math.max(8, schedSpeed)) * 60 + duraklamaDk);
    const gecikmeDk = Math.max(0, Math.round((totalDk - scheduledDk) * 10) / 10);

    // 7. GPS freshness & anomaly detection
    const isTerminal = nearest.index <= 1 || nearest.index >= duraklar.length - 2;
    const rawSpeed = Number.isFinite(obsSpeed) && obsSpeed >= 0 ? obsSpeed : fleetSpeed;

    let durumKod = "ON_TIME";
    let durumEtiket = "Zamanında";
    let guven = "high";

    if (nearest.metre > OFF_ROUTE_M) {
      durumKod = "OFF_ROUTE";
      durumEtiket = "Güzergâh Dışı / Sapma";
      guven = "low";
    } else if (!freshGps) {
      durumKod = "STALE";
      durumEtiket = sonGuncellemeSn == null ? "GPS Zamanı Yok" : "Sinyal Gecikmeli";
      guven = "low";
    } else if (Number.isFinite(rawSpeed) && rawSpeed >= 0 && rawSpeed < 2 && isTerminal) {
      durumKod = "AT_TERMINAL";
      durumEtiket = "Sefer Başı Bekleme";
      guven = "medium";
    } else if (totalDk > scheduledDk * 1.2 && gecikmeDk >= 2) {
      durumKod = "DELAYED";
      durumEtiket = "Gecikmeli";
      guven = "medium";
    }

    const saniye = Math.max(0, Math.round(totalDk * 60));
    const dakika = Math.max(0, Math.round(totalDk));

    return {
      durakSayisi,
      metre,
      dakika,
      saniye,
      hizKmSa: Math.round(hizKmSa * 10) / 10,
      trafikEtkisiDk,
      trafficFactored: hasCorridorSpeed || kazaEtkisiDk > 0,
      kazaEtkisiDk,
      duraklamaDk,
      gecikmeDk,
      durumKod,
      durumEtiket,
      guven,
      sonGuncellemeSn,
      plaka: String(ctx.fleetItem?.plaka || bus.plaka || "").trim(),
      operator: String(ctx.fleetItem?.operator || bus.operator || "İETT").trim(),
    };
  }

  return { predict };
})();
