import { Bridge } from "../core/bridge.js";
import { KV } from "../core/storage.js";

/**
 * High-performance Data Provider with in-flight request deduplication,
 * <100ms Memory + IndexedDB Stale-While-Revalidate (SWR) caching,
 * provider health tracking, SSE live streaming, and fleet bbox queries.
 */
export const DataProvider = (() => {
  const inflight = new Map();
  const memCache = new Map();

  const health = {
    iett: "unknown",
    metro: "unknown",
    tkm: "unknown",
    vapur: "unknown",
    ispark: "unknown",
    transitous: "unknown",
    google: "unknown",
    sse: "unknown",
  };

  let proxyProbePromise = null;
  let proxyAvailable = null;

  /**
   * Deduplicates concurrent in-flight async calls sharing the same key.
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  function coalesce(key, fn) {
    if (inflight.has(key)) return inflight.get(key);
    const p = Promise.resolve()
      .then(fn)
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, p);
    return p;
  }

  /**
   * Stale-While-Revalidate cache backed by in-memory Map (<1ms) and IndexedDB (KV).
   * Returns cached data immediately if available and triggers background refresh when stale.
   * @template T
   * @param {string} key
   * @param {number} maxAgeMs
   * @param {() => Promise<T>} fn
   * @param {(fresh: T) => void} [onUpdate]
   * @returns {Promise<T>}
   */
  async function swr(key, maxAgeMs, fn, onUpdate) {
    const now = Date.now();
    const m = memCache.get(key);
    if (m) {
      if (now - m.t < maxAgeMs) return m.d;
      // Stale in memory: refresh in background
      coalesce("swr:" + key, async () => {
        const fresh = await fn();
        memCache.set(key, { t: Date.now(), d: fresh });
        KV.set(key, fresh);
        if (onUpdate) onUpdate(fresh);
        return fresh;
      }).catch(() => {});
      return m.d;
    }

    // Check IndexedDB without maxAge first so we can serve stale immediately
    const stored = await KV.get(key);
    if (stored != null) {
      memCache.set(key, { t: now - maxAgeMs - 1, d: stored });
      coalesce("swr:" + key, async () => {
        const fresh = await fn();
        memCache.set(key, { t: Date.now(), d: fresh });
        KV.set(key, fresh);
        if (onUpdate) onUpdate(fresh);
        return fresh;
      }).catch(() => {});
      return stored;
    }

    return coalesce("swr:" + key, async () => {
      const fresh = await fn();
      memCache.set(key, { t: Date.now(), d: fresh });
      KV.set(key, fresh);
      return fresh;
    });
  }

  /**
   * Updates health status for a named transit/data provider.
   * @param {keyof typeof health} provider
   * @param {"ok"|"degraded"|"down"|"unknown"} status
   */
  function markHealth(provider, status) {
    if (provider in health) {
      health[provider] = status;
    }
  }

  /**
   * Returns a snapshot of all provider health states.
   * @returns {{ iett: string, metro: string, tkm: string, vapur: string, ispark: string, transitous: string, google: string, sse: string }}
   */
  function getHealth() {
    return { ...health };
  }

  /**
   * Probes whether the optional backend proxy server is present.
   * Auto-disables proxy-only endpoints on static hosting (404).
   * @returns {Promise<boolean>}
   */
  async function hasBackendProxy() {
    if (proxyAvailable !== null) return proxyAvailable;
    if (typeof fetch !== "function") {
      proxyAvailable = false;
      return false;
    }
    if (!proxyProbePromise) {
      const base = Bridge.getProxyUrl();
      const url = base ? `${base}/api/health` : "./api/health";
      proxyProbePromise = fetch(url, { method: "GET" })
        .then((r) => {
          proxyAvailable = r.ok;
          return proxyAvailable;
        })
        .catch(() => {
          proxyAvailable = false;
          return false;
        });
    }
    return proxyProbePromise;
  }

  /**
   * Connects to `./api/stream` SSE endpoint when backend proxy is available.
   * Automatically disables itself on 404/static hosting.
   * @param {string[]} lines
   * @param {boolean} traffic
   * @param {(ev: { type: string, data: any }) => void} onEvent
   * @returns {() => void} Unsubscribe function
   */
  function connectStream(lines = [], traffic = false, onEvent = () => {}) {
    let closed = false;
    let es = null;

    if (typeof EventSource === "undefined") {
      markHealth("sse", "down");
      return () => {};
    }

    hasBackendProxy().then((ok) => {
      if (closed) return;
      if (!ok) {
        markHealth("sse", "down");
        return;
      }

      const params = new URLSearchParams();
      if (lines && lines.length) params.set("lines", lines.join(","));
      if (traffic) params.set("traffic", "1");
      const base = Bridge.getProxyUrl();
      const streamUrl = `${base ? base : "."}/api/stream?${params.toString()}`;

      try {
        es = new EventSource(streamUrl);
        es.onopen = () => markHealth("sse", "ok");

        const handleTyped = (type) => (msg) => {
          try {
            const data = JSON.parse(msg.data);
            onEvent({ type, data });
          } catch {
            onEvent({ type, data: msg.data });
          }
        };

        es.onmessage = handleTyped("message");
        es.addEventListener("fleet", handleTyped("fleet"));
        es.addEventListener("traffic", handleTyped("traffic"));
        es.addEventListener("incident", handleTyped("incident"));

        es.onerror = () => {
          if (es && es.readyState === EventSource.CLOSED) {
            markHealth("sse", "down");
            es.close();
          } else {
            markHealth("sse", "degraded");
          }
        };
      } catch {
        markHealth("sse", "down");
      }
    });

    return () => {
      closed = true;
      if (es) es.close();
    };
  }

  /**
   * Queries live fleet vehicles inside the given bounding box via `./api/fleet?bbox=...`.
   * Gracefully returns `[]` on static hosting or when proxy is unavailable.
   * @param {{ minLat: number, minLon: number, maxLat: number, maxLon: number } | object} bounds
   * @returns {Promise<Array>}
   */
  async function fetchFleetBbox(bounds) {
    if (!bounds) return [];
    const ok = await hasBackendProxy();
    if (!ok) return [];

    let minLat, minLon, maxLat, maxLon;
    if (typeof bounds.getSouth === "function") {
      minLat = bounds.getSouth();
      minLon = bounds.getWest();
      maxLat = bounds.getNorth();
      maxLon = bounds.getEast();
    } else {
      ({ minLat, minLon, maxLat, maxLon } = bounds);
    }
    if (![minLat, minLon, maxLat, maxLon].every(Number.isFinite)) return [];

    const bbox = `${minLat.toFixed(5)},${minLon.toFixed(5)},${maxLat.toFixed(5)},${maxLon.toFixed(5)}`;
    const base = Bridge.getProxyUrl();
    const url = `${base ? base : "."}/api/fleet?bbox=${encodeURIComponent(bbox)}`;

    return coalesce("fleet:" + bbox, async () => {
      try {
        const res = await fetch(url);
        if (res.status === 404 || res.status === 405) {
          proxyAvailable = false;
          return [];
        }
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : data?.vehicles || [];
      } catch {
        return [];
      }
    });
  }

  return {
    coalesce,
    swr,
    markHealth,
    getHealth,
    connectStream,
    fetchFleetBbox,
  };
})();
