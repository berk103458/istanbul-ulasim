/**
 * Notification & Alert Engine:
 * - Stop/Bus arrival alerts (`watchStopBus(hat, durakAd, thresholdMin)`)
 * - Favorite line disruption alerts
 * - Web Notification API + `#toastKutu` in-app toast banner
 */
export const NotificationEngine = (() => {
  const watches = new Map();
  const notifiedKeys = new Map();
  const seenDisruptions = new Set();
  let nextId = 1;
  let toastTimer = null;

  function showToast(title, message = "", type = "info") {
    if (typeof document === "undefined") return;
    const box = document.querySelector("#toastKutu");
    if (!box) return;

    box.dataset.type = type;
    box.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = title;
    box.appendChild(strong);
    if (message) {
      const span = document.createElement("span");
      span.textContent = " — " + message;
      box.appendChild(span);
    }
    box.classList.add("acik", "show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      box.classList.remove("acik", "show");
    }, 5500);
  }

  function fireWebNotification(title, body) {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try {
      new Notification(title, { body, tag: title });
    } catch {}
  }

  /**
   * Watches a specific bus/transit line at a stop and alerts when ETA <= `thresholdMin`.
   * @param {string} hat
   * @param {string} durakAd
   * @param {number} [thresholdMin=3]
   * @returns {string} Watch ID
   */
  function watchStopBus(hat, durakAd, thresholdMin = 3) {
    const id = "w_" + nextId++;
    watches.set(id, {
      id,
      hat: String(hat || "").trim().toUpperCase(),
      durakAd: String(durakAd || "").trim(),
      thresholdMin: Math.max(1, Number(thresholdMin) || 3),
      createdAt: Date.now(),
    });

    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    showToast("Alarm Kuruldu", `${hat} · ${durakAd} (≤ ${thresholdMin} dk)`, "info");
    return id;
  }

  function unwatch(id) {
    return watches.delete(id);
  }

  function getWatches() {
    return [...watches.values()];
  }

  function clearWatches() {
    watches.clear();
  }

  /**
   * Evaluates incoming ETAs against active watches and triggers alerts when threshold is met.
   * @param {string} hat
   * @param {string} durakAd
   * @param {Array<{ dakika: number, plaka?: string }>} etas
   */
  function checkEtas(hat, durakAd, etas = []) {
    if (!watches.size || !Array.isArray(etas) || !etas.length) return;
    const normHat = String(hat || "").trim().toUpperCase();
    const now = Date.now();

    for (const w of watches.values()) {
      if (w.hat !== normHat) continue;
      if (w.durakAd && durakAd && w.durakAd.toLowerCase() !== durakAd.toLowerCase()) continue;

      const imminent = etas.find((e) => Number.isFinite(e.dakika) && e.dakika <= w.thresholdMin);
      if (!imminent) continue;

      const cooldownKey = `${w.id}:${imminent.plaka || "next"}`;
      const last = notifiedKeys.get(cooldownKey) || 0;
      if (now - last < 90e3) continue;

      notifiedKeys.set(cooldownKey, now);
      const title = `${w.hat} Yaklaşıyor (${imminent.dakika} dk)`;
      const body = `${w.durakAd || durakAd} durağına ${imminent.dakika} dakika kaldı.`;
      showToast(title, body, "alert");
      fireWebNotification(title, body);
    }
  }

  /**
   * Checks live announcements for new disruptions affecting any favorite line.
   * @param {string[]} favoriteLines
   * @param {Array<{ hatKod?: string, hat?: string, mesaj?: string, saat?: string }>} duyurular
   */
  function checkDisruptions(favoriteLines = [], duyurular = []) {
    if (!Array.isArray(favoriteLines) || !favoriteLines.length || !Array.isArray(duyurular)) return;
    const favSet = new Set(favoriteLines.map((h) => String(h).trim().toUpperCase()));

    for (const d of duyurular) {
      const hat = String(d.hatKod || d.hat || "").trim().toUpperCase();
      if (!hat || !favSet.has(hat)) continue;
      const key = `${hat}|${d.saat || ""}|${(d.mesaj || "").slice(0, 60)}`;
      if (seenDisruptions.has(key)) continue;
      seenDisruptions.add(key);

      const title = `${hat} Hat Duyurusu`;
      const body = String(d.mesaj || "Sefer değişikliği / aksama bildirimi").slice(0, 140);
      showToast(title, body, "warning");
      fireWebNotification(title, body);
    }
  }

  return {
    watchStopBus,
    unwatch,
    getWatches,
    clearWatches,
    checkEtas,
    checkDisruptions,
    showToast,
  };
})();
