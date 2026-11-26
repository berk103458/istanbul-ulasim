import { Core } from "../core/geo.js";

/**
 * 9-Factor Dynamic Bus & Metrobus ETA Prediction Engine.
 * Distinguishes live GPS telemetry from scheduled/corridor estimates and detects anomalies honestly.
 */
export const EtaEngine = (() => {
  const YOL_KATSAYISI = 1.15;
  const OFF_ROUTE_M = 450;
  const STALE_GPS_SEC = 240;

  function parseGpsAgeSec(zamanStr) {
    if (!zamanStr) return null;
    if (typeof zamanStr === "number" && Number.isFinite(zamanStr)) {
      return Math.max(0, Math.round((Date.now() - zamanStr) / 1000));
    }
    const s = String(zamanStr).trim();
    const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
    if (m) {
      const now = new Date();
      const dt = new Date(now);
      dt.setHours(Number(m[1]), Number(m[2]), Number(m[3] || 0), 0);
      let diff = Math.round((now.getTime() - dt.getTime()) / 1000);
      if (diff < -43200) diff += 86400;
      if (diff > 43200) diff -= 86400;
      return Math.max(0, diff);
    }
    const parsed = Date.parse(s);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.round((Date.now() - parsed) / 1000));
    }
    return null;
  }

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
    if (!Array.isArray(duraklar) || !Core.gecerliKonum(bus) ||
        !Number.isInteger(hedefIndex) || hedefIndex < 0 || hedefIndex >= duraklar.length) {
      return null;
    }
    for (const durak of duraklar) {
      if (!Core.gecerliKonum(durak)) return null;
    }
    ctx ??= {};

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
    const fleetSpeed = Number(ctx.fleetItem?.hiz ?? bus.hiz);
    const obsSpeed = Number(ctx.observedSpeedKmH);
    let hizKmSa = schedSpeed;
    if (Number.isFinite(obsSpeed) && obsSpeed >= 4) {
      hizKmSa = obsSpeed;
    } else if (Number.isFinite(fleetSpeed) && fleetSpeed >= 4) {
      hizKmSa = fleetSpeed * 0.6 + schedSpeed * 0.4;
    }

    // 3. Corridor traffic speed
    let trafikEtkisiDk = 0;
    const te = ctx.trafficEngine;
    const targetStop = duraklar[hedefIndex];
    const corridor = te && typeof te.getCorridorSpeed === "function" ? te.getCorridorSpeed(bus, targetStop) : null;
    if (corridor && Number.isFinite(corridor.speedKmH) && corridor.speedKmH > 2) {
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
    const sonGuncellemeSn = parseGpsAgeSec(ctx.fleetItem?.zaman ?? bus.zaman);
    const isTerminal = nearest.index <= 1 || nearest.index >= duraklar.length - 2;
    const rawSpeed = Number.isFinite(fleetSpeed) ? fleetSpeed : null;

    let durumKod = "ON_TIME";
    let durumEtiket = "Zamanında";
    let guven = "high";

    if (nearest.metre > OFF_ROUTE_M) {
      durumKod = "OFF_ROUTE";
      durumEtiket = "Güzergâh Dışı / Sapma";
      guven = "low";
    } else if (sonGuncellemeSn != null && sonGuncellemeSn > STALE_GPS_SEC) {
      durumKod = "STALE";
      durumEtiket = "Sinyal Gecikmeli";
      guven = "low";
    } else if (rawSpeed != null && rawSpeed < 2 && isTerminal) {
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
