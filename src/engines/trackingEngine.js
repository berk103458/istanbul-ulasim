/**
 * High-performance Fleet Tracking Engine:
 * - Viewport culling
 * - Grid-based marker clustering for zoom < 14
 * - 60 FPS requestAnimationFrame marker interpolation helper
 */
export const TrackingEngine = (() => {
  function extractBounds(bounds) {
    if (!bounds) return null;
    if (typeof bounds.getSouth === "function") {
      return {
        minLat: bounds.getSouth(),
        minLon: bounds.getWest(),
        maxLat: bounds.getNorth(),
        maxLon: bounds.getEast(),
      };
    }
    return bounds;
  }

  /**
   * Filters vehicles to only those inside the given map bounds.
   * @param {Array<{ lat: number, lon: number }>} vehicles
   * @param {object} bounds
   * @returns {Array}
   */
  function filterVisibleVehicles(vehicles, bounds) {
    if (!Array.isArray(vehicles) || !vehicles.length) return [];
    const b = extractBounds(bounds);
    if (!b) return vehicles;
    return vehicles.filter(
      (v) =>
        v &&
        Number.isFinite(v.lat) &&
        Number.isFinite(v.lon) &&
        v.lat >= b.minLat &&
        v.lat <= b.maxLat &&
        v.lon >= b.minLon &&
        v.lon <= b.maxLon
    );
  }

  /**
   * Clusters vehicles into grid cells when `zoom < 14`, or returns individual markers at `zoom >= 14`.
   * @param {Array<{ lat: number, lon: number }>} vehicles
   * @param {number} zoom
   * @param {object} [bounds]
   * @returns {Array<{ type: "cluster", lat: number, lon: number, count: number } | { type: "single", bus: object }>}
   */
  function clusterVehicles(vehicles, zoom = 14, bounds = null) {
    const visible = bounds ? filterVisibleVehicles(vehicles, bounds) : vehicles || [];
    if (!visible.length) return [];
    if (zoom >= 14) {
      return visible.map((bus) => ({ type: "single", bus }));
    }

    const cellDeg = 0.004 * Math.pow(2, Math.max(0, 13 - zoom));
    const cells = new Map();

    for (const bus of visible) {
      if (!bus || !Number.isFinite(bus.lat) || !Number.isFinite(bus.lon)) continue;
      const gx = Math.floor(bus.lat / cellDeg);
      const gy = Math.floor(bus.lon / cellDeg);
      const key = `${gx}:${gy}`;
      let bucket = cells.get(key);
      if (!bucket) {
        bucket = { sumLat: 0, sumLon: 0, items: [] };
        cells.set(key, bucket);
      }
      bucket.sumLat += bus.lat;
      bucket.sumLon += bus.lon;
      bucket.items.push(bus);
    }

    const out = [];
    for (const bucket of cells.values()) {
      const count = bucket.items.length;
      if (count === 1) {
        out.push({ type: "single", bus: bucket.items[0] });
      } else {
        out.push({
          type: "cluster",
          lat: bucket.sumLat / count,
          lon: bucket.sumLon / count,
          count,
        });
      }
    }
    return out;
  }

  /**
   * Advances smooth 60 FPS marker position interpolation for active vehicles.
   * Each entry in `aracMap` should have `{ marker, fromLat, fromLon, toLat, toLon, startMs, durationMs }`.
   * @param {Map<string, object> | Iterable<object>} aracMap
   * @param {number} [nowMs=performance.now()]
   * @returns {number} Number of animations still in progress
   */
  function stepAnimations(aracMap, nowMs = typeof performance !== "undefined" ? performance.now() : Date.now()) {
    if (!aracMap) return 0;
    const iter = typeof aracMap.values === "function" ? aracMap.values() : aracMap;
    let active = 0;

    for (const item of iter) {
      if (!item || !item.animating) continue;
      const dur = item.durationMs || 800;
      const rawT = Math.min(1, Math.max(0, (nowMs - item.startMs) / dur));
      // Ease-out cubic
      const t = 1 - Math.pow(1 - rawT, 3);
      const lat = item.fromLat + (item.toLat - item.fromLat) * t;
      const lon = item.fromLon + (item.toLon - item.fromLon) * t;

      item.lat = lat;
      item.lon = lon;
      if (item.marker && typeof item.marker.setLatLng === "function") {
        item.marker.setLatLng([lat, lon]);
      }

      if (rawT >= 1) {
        item.animating = false;
        item.fromLat = item.toLat;
        item.fromLon = item.toLon;
      } else {
        active++;
      }
    }
    return active;
  }

  return {
    filterVisibleVehicles,
    clusterVehicles,
    stepAnimations,
  };
})();
