import { DataProvider } from "../engines/dataProvider.js";
import { NotificationEngine } from "../engines/notificationEngine.js";
import { formatGpsAge, FRESH_GPS_SEC, STALE_GPS_SEC } from "../ui/etaIndicators.js";

const CANLI_SN = 5;

export function createLiveUpdates(S, mc, { sayfa, ciz }) {
  let panelZamanlayici = null;

  function refreshLiveAges() {
    const ic = document.querySelector("#icerik");
    if (!ic) return;

    const now = Date.now();
    let becameStale = false;
    ic.querySelectorAll("[data-live-age]").forEach((el) => {
      const ms = Number(el.dataset.liveAge);
      if (!Number.isFinite(ms) || ms <= 0) return;
      const age = Math.round((now - ms) / 1000);
      el.textContent = formatGpsAge(age);
      const badge = el.closest(".gps-yas");
      if (age > STALE_GPS_SEC && badge?.matches(".taze, .orta")) becameStale = true;
      else if (age > FRESH_GPS_SEC) badge?.classList.replace("taze", "orta");
    });
    if (becameStale) panelYenile();

    if (!becameStale && ic.querySelector("[data-live-eta]") && typeof NotificationEngine?.checkUpdates === "function") {
      NotificationEngine.checkUpdates(S, mc).catch(() => {});
    }
  }

  function panelYenile() {
    clearTimeout(panelZamanlayici);
    panelZamanlayici = setTimeout(() => ciz(false), 120);
  }

  function startTimers() {
    setInterval(() => mc.canliTur(), CANLI_SN * 1000);
    setInterval(() => {
      if (!document.hidden) {
        mc.oluHesap();
        mc.tahminiCiz();
        refreshLiveAges();
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
  }

  function connectStream() {
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
  }

  return { panelYenile, startTimers, connectStream };
}
