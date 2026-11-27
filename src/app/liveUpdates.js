import { DataProvider } from "../engines/dataProvider.js";
import { NotificationEngine } from "../engines/notificationEngine.js";
import { t } from "../i18n/index.js";

const CANLI_SN = 5;

export function createLiveUpdates(S, mc, { sayfa, ciz }) {
  let panelZamanlayici = null;

  function surgicalLiveUpdate() {
    const ic = document.querySelector("#icerik");
    if (!ic) return false;

    // Update live age counters in-place
    ic.querySelectorAll("[data-live-age]").forEach((el) => {
      const ms = Number(el.dataset.liveAge);
      if (!isFinite(ms) || ms <= 0) return;
      const yas = Math.max(0, Math.round((Date.now() - ms) / 1000));
      el.textContent = yas < 90 ? t("eta.secAgo", { n: yas }) : t("eta.minAgo", { n: Math.round(yas / 60) });
    });

    // Update live ETA elements in-place when order/count hasn't changed
    const etaEls = ic.querySelectorAll("[data-live-eta]");
    if (!etaEls.length) return false;

    let anyMismatch = false;
    const p = sayfa();

    etaEls.forEach((el) => {
      const key = el.dataset.liveEta;
      const [hat, kapino] = String(key || "").split("/");
      const a = S.arac.get(key);
      if (!a || !hat || !kapino) {
        anyMismatch = true;
        return;
      }
      const hd = mc.hedefDurak(hat, a.yon);
      if (!hd) return;
      const list = mc.yaklasanOtobusler(hat, a.yon, hd.i);
      const match = list.find((x) => x.bus.kapino === kapino);
      if (!match) {
        anyMismatch = true;
        return;
      }
      const dk = Math.round(match.t.dakika);
      const sureSpan = el.querySelector(".sure") || (el.classList.contains("sure") ? el : null);
      if (sureSpan) {
        sureSpan.classList.toggle("yakin", dk <= 3);
        sureSpan.textContent = dk <= 1 ? t("eta.arriving") : `~${dk} dk`;
      }
    });

    if (typeof NotificationEngine?.checkUpdates === "function") {
      NotificationEngine.checkUpdates(S, mc).catch(() => {});
    }

    return !anyMismatch && p.tur !== "hat";
  }

  function panelYenile() {
    if (surgicalLiveUpdate()) return;
    clearTimeout(panelZamanlayici);
    panelZamanlayici = setTimeout(() => ciz(false), 120);
  }

  function startTimers() {
    setInterval(() => mc.canliTur(), CANLI_SN * 1000);
    setInterval(() => {
      if (!document.hidden) {
        mc.oluHesap();
        mc.tahminiCiz();
        surgicalLiveUpdate();
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
