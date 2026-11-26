import { Plan } from "../core/router.js";

/**
 * Web Worker Route Engine with automatic main-thread fallback.
 * Offloads transit graph construction, A* multi-modal routing, and place search off the UI thread.
 */
export const RouteEngine = (() => {
  let worker = null;
  let workerFailed = false;
  let mainThreadAg = null;
  let reqSeq = 0;
  const pending = new Map();

  function ensureWorker() {
    if (workerFailed || typeof Worker === "undefined") return null;
    if (worker) return worker;

    try {
      worker = new Worker(new URL("../workers/router.worker.js", import.meta.url), { type: "module" });
      worker.onmessage = (event) => {
        const { id, ok, error, ...rest } = event.data || {};
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        if (ok) p.resolve(rest);
        else p.reject(new Error(error || "Worker error"));
      };
      worker.onerror = () => {
        workerFailed = true;
        for (const p of pending.values()) {
          p.reject(new Error("Worker failed"));
        }
        pending.clear();
        try {
          worker.terminate();
        } catch {}
        worker = null;
      };
      return worker;
    } catch {
      workerFailed = true;
      return null;
    }
  }

  function callWorker(type, payload) {
    const w = ensureWorker();
    if (!w) return Promise.reject(new Error("Worker unavailable"));
    return new Promise((resolve, reject) => {
      const id = ++reqSeq;
      pending.set(id, { resolve, reject });
      w.postMessage({ id, type, payload });
    });
  }

  /**
   * Builds the multi-modal transit graph in the Web Worker (or main thread fallback).
   * @param {object} data
   * @returns {Promise<{ durakCount: number, desenCount: number, stopLinesIndex: Object<string, string[]>, buildMs: number }>}
   */
  async function initGraph(data) {
    try {
      const res = await callWorker("INIT_GRAPH", data);
      return {
        durakCount: res.durakCount,
        desenCount: res.desenCount,
        stopLinesIndex: res.stopLinesIndex || {},
        buildMs: res.buildMs,
      };
    } catch {
      workerFailed = true;
      const t0 = performance.now();
      mainThreadAg = Plan.kur(data || {});
      const stopLinesIndex = Plan.buildStopLinesIndex(mainThreadAg);
      return {
        durakCount: mainThreadAg.duraklar.length,
        desenCount: mainThreadAg.desenler.length,
        stopLinesIndex,
        buildMs: Math.round(performance.now() - t0),
      };
    }
  }

  /**
   * Computes optimal & alternative multi-modal routes between `a` and `b`.
   * @param {object} a
   * @param {object} b
   * @param {number} t0
   * @param {object} [opt]
   * @param {number} [adet=4]
   * @returns {Promise<{ sonuc: Array, computeMs: number }>}
   */
  async function compute(a, b, t0, opt = {}, adet = 4) {
    if (!workerFailed) {
      try {
        const res = await callWorker("COMPUTE", { a, b, t0, opt, adet });
        return { sonuc: res.sonuc || [], computeMs: res.computeMs || 0 };
      } catch {
        workerFailed = true;
      }
    }

    if (!mainThreadAg) return { sonuc: [], computeMs: 0 };
    const start = performance.now();
    const direk = Plan.direkler(mainThreadAg, a, b, t0, opt);
    const alt = Plan.alternatifler(mainThreadAg, a, b, t0, opt, adet);
    const seen = new Set();
    const merged = [];
    for (const r of [...(alt.sonuc || []), ...(direk || [])]) {
      if (!r || seen.has(r.imza)) continue;
      seen.add(r.imza);
      merged.push(r);
    }
    merged.sort((x, y) => (x.varis ?? Infinity) - (y.varis ?? Infinity));
    return {
      sonuc: merged.slice(0, Math.max(adet, (alt.sonuc || []).length)),
      computeMs: Math.round(performance.now() - start),
    };
  }

  /**
   * Searches transit stops/stations matching query `q`.
   * @param {string} q
   * @param {number} [adet=8]
   * @returns {Promise<Array>}
   */
  async function searchPlaces(q, adet = 8) {
    if (!workerFailed) {
      try {
        const res = await callWorker("SEARCH_PLACES", { q, adet });
        return res.places || [];
      } catch {
        workerFailed = true;
      }
    }
    return mainThreadAg ? Plan.yerAra(mainThreadAg, q, adet) : [];
  }

  /**
   * Checks a computed route against live announcements and traffic conditions
   * to suggest auto-rerouting if a leg is disrupted or heavily congested.
   * @param {object} route
   * @param {Array} [duyurular]
   * @param {object} [trafficEngine]
   * @returns {{ hasDelay: boolean, reason: string, level: "none"|"minor"|"major" }}
   */
  function checkRouteDelays(route, duyurular = [], trafficEngine = null) {
    if (!route || !Array.isArray(route.bacaklar)) {
      return { hasDelay: false, reason: "", level: "none" };
    }

    const legLines = new Set(
      route.bacaklar.filter((b) => b.tur && b.tur !== "yuru" && b.hat).map((b) => String(b.hat).toUpperCase())
    );

    if (Array.isArray(duyurular) && duyurular.length) {
      for (const d of duyurular) {
        const hat = String(d.hatKod || d.hat || "").trim().toUpperCase();
        if (!hat || !legLines.has(hat)) continue;
        const msg = `${d.tip || ""} ${d.mesaj || ""}`.trim();
        const isMajor = /iptal|kapalı|kesinti|aksama|değişiklik|arıza/i.test(msg);
        return {
          hasDelay: true,
          reason: `${hat}: ${msg.slice(0, 120)}`,
          level: isMajor ? "major" : "minor",
        };
      }
    }

    if (trafficEngine) {
      for (const b of route.bacaklar) {
        if (b.tur !== "otobus" || !b.from || !b.to) continue;
        const inc = typeof trafficEngine.getIncidentPenalty === "function"
          ? trafficEngine.getIncidentPenalty(b.from, b.to)
          : null;
        if (inc && inc.incident) {
          return {
            hasDelay: true,
            reason: `${b.hat} güzergahında trafik olayı: ${inc.incident.baslik || "Yoğunluk"}`,
            level: inc.penaltyMin >= 5 ? "major" : "minor",
          };
        }
        if (inc && inc.congestionLevel != null && inc.congestionLevel >= 4.2) {
          return {
            hasDelay: true,
            reason: `${b.hat} güzergahında yoğun trafik (~${inc.speedKmH ?? "?"} km/sa)`,
            level: "minor",
          };
        }
      }
    }

    return { hasDelay: false, reason: "", level: "none" };
  }

  return {
    initGraph,
    compute,
    searchPlaces,
    checkRouteDelays,
  };
})();
