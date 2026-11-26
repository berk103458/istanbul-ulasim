import { Bridge } from "../core/bridge.js";

/**
 * Optional Google Maps Routes & Places Client Adapter.
 * Communicates with the backend proxy (`./api/health`, `./api/google/routes`, `./api/google/places`)
 * and gracefully reports `{ configured: false }` on static hosting or when no API key is configured.
 */
export const GoogleMapsService = (() => {
  let cachedStatus = null;
  let availabilityPromise = null;

  function apiBase() {
    const custom = Bridge.getProxyUrl();
    return custom ? custom : ".";
  }

  /**
   * Checks `./api/health` for `googleMapsConfigured`. Caches the result.
   * @param {boolean} [force=false]
   * @returns {Promise<{ configured: boolean, reason?: string }>}
   */
  async function checkAvailability(force = false) {
    if (cachedStatus && !force) return cachedStatus;
    if (Bridge.runtime === "scriptable" || typeof fetch !== "function") {
      cachedStatus = { configured: false, reason: "static_or_scriptable" };
      return cachedStatus;
    }

    if (!availabilityPromise || force) {
      availabilityPromise = fetch(`${apiBase()}/api/health`, { method: "GET" })
        .then(async (res) => {
          if (!res.ok) {
            cachedStatus = { configured: false, reason: `http_${res.status}` };
            return cachedStatus;
          }
          const json = await res.json().catch(() => ({}));
          if (json && json.googleMapsConfigured) {
            cachedStatus = { configured: true };
          } else {
            cachedStatus = { configured: false, reason: "missing_api_key" };
          }
          return cachedStatus;
        })
        .catch(() => {
          cachedStatus = { configured: false, reason: "proxy_unreachable" };
          return cachedStatus;
        });
    }
    return availabilityPromise;
  }

  /**
   * Computes routes via `POST ./api/google/routes` if Google Maps is configured.
   * @param {{ lat: number, lon: number }} origin
   * @param {{ lat: number, lon: number }} dest
   * @param {"TRANSIT"|"DRIVE"|"WALK"} [mode="TRANSIT"]
   * @returns {Promise<{ configured: boolean, routes?: Array, error?: string }>}
   */
  async function computeRoutes(origin, dest, mode = "TRANSIT") {
    const avail = await checkAvailability();
    if (!avail.configured) return { configured: false, reason: avail.reason };

    try {
      const res = await fetch(`${apiBase()}/api/google/routes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin, dest, mode }),
      });
      if (!res.ok) {
        return { configured: true, routes: [], error: `HTTP ${res.status}` };
      }
      const data = await res.json();
      return { configured: true, ...(typeof data === "object" && data ? data : { routes: [] }) };
    } catch (err) {
      return { configured: true, routes: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Fetches place autocomplete suggestions via `POST ./api/google/places` if configured.
   * @param {string} input
   * @returns {Promise<{ configured: boolean, predictions?: Array, error?: string }>}
   */
  async function autocomplete(input) {
    const q = String(input || "").trim();
    if (q.length < 2) return { configured: Boolean(cachedStatus?.configured), predictions: [] };

    const avail = await checkAvailability();
    if (!avail.configured) return { configured: false, predictions: [], reason: avail.reason };

    try {
      const res = await fetch(`${apiBase()}/api/google/places`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: q }),
      });
      if (!res.ok) {
        return { configured: true, predictions: [], error: `HTTP ${res.status}` };
      }
      const data = await res.json();
      return { configured: true, ...(typeof data === "object" && data ? data : { predictions: [] }) };
    } catch (err) {
      return { configured: true, predictions: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  return {
    checkAvailability,
    computeRoutes,
    autocomplete,
  };
})();
