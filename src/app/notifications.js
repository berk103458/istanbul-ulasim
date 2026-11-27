import { NotificationEngine } from "../engines/notificationEngine.js";
import { t } from "../i18n/index.js";

export function ensureToastContainer() {
  if (typeof document === "undefined") return null;
  let el = document.querySelector("#toastKutu");
  if (!el) {
    el = document.createElement("div");
    el.id = "toastKutu";
    el.className = "toast-kutu";
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  return el;
}

export function toggleStopWatch(d) {
  const hat = d.bildirHat;
  const durakKod = d.bildirDurak;
  const durakAd = d.bildirAd || durakKod;
  const yon = d.bildirYon || "";
  const watches = typeof NotificationEngine?.getWatches === "function" ? NotificationEngine.getWatches() : [];
  const existing = watches.find((w) => w.hat === hat && w.durakKod === durakKod);
  if (existing) {
    NotificationEngine.unwatch?.(existing.id || `${hat}|${durakKod}`);
  } else {
    NotificationEngine.watchStopBus?.({ hat, durakKod, durakAd, yon, thresholdMin: 3 });
    NotificationEngine.notifyToast?.(`🔔 ${hat} → ${durakAd} (${t("eta.notify3m")})`);
  }
}
