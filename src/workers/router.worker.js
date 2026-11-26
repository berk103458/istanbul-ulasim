import { Plan } from "../core/router.js";

let workerAg = null;

/**
 * Merges direct transit results with multi-leg A* alternatives, deduplicated by route signature.
 * @param {Array} direk
 * @param {Array} altSonuc
 * @param {number} adet
 * @returns {Array}
 */
function mergeRoutes(direk, altSonuc, adet = 4) {
  const seen = new Set();
  const merged = [];
  for (const r of [...(altSonuc || []), ...(direk || [])]) {
    if (!r || seen.has(r.imza)) continue;
    seen.add(r.imza);
    merged.push(r);
  }
  merged.sort((a, b) => (a.varis ?? Infinity) - (b.varis ?? Infinity));
  return merged.slice(0, Math.max(adet, (altSonuc || []).length));
}

self.onmessage = (event) => {
  const { id, type, payload = {} } = event.data || {};
  try {
    if (type === "INIT_GRAPH") {
      const t0 = performance.now();
      workerAg = Plan.kur(payload);
      const stopLinesIndex = Plan.buildStopLinesIndex(workerAg);
      const buildMs = Math.round(performance.now() - t0);
      self.postMessage({
        id,
        type,
        ok: true,
        durakCount: workerAg.duraklar.length,
        desenCount: workerAg.desenler.length,
        stopLinesIndex,
        buildMs,
      });
      return;
    }

    if (type === "COMPUTE") {
      if (!workerAg) {
        self.postMessage({ id, type, ok: false, error: "Transit graph not initialized" });
        return;
      }
      const t0 = performance.now();
      const opt = payload.opt || {};
      const adet = payload.adet ?? 4;
      const direk = Plan.direkler(workerAg, payload.a, payload.b, payload.t0, opt);
      const alt = Plan.alternatifler(workerAg, payload.a, payload.b, payload.t0, opt, adet);
      const sonuc = mergeRoutes(direk, alt.sonuc, adet);
      const computeMs = Math.round(performance.now() - t0);
      self.postMessage({
        id,
        type,
        ok: true,
        sonuc,
        computeMs,
      });
      return;
    }

    if (type === "SEARCH_PLACES") {
      if (!workerAg) {
        self.postMessage({ id, type, ok: true, places: [] });
        return;
      }
      const places = Plan.yerAra(workerAg, payload.q || "", payload.adet ?? 8);
      self.postMessage({ id, type, ok: true, places });
      return;
    }

    self.postMessage({ id, type, ok: false, error: `Unknown message type: ${type}` });
  } catch (err) {
    self.postMessage({
      id,
      type,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
