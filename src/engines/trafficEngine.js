import { API } from "../core/api.js";
import { Core } from "../core/geo.js";

/**
 * High-performance Traffic Engine for Istanbul:
 * - Spatial grid indexing (0.02 deg cells) for 6,000+ TKM segments
 * - 5-bucket batched polyline output (max 5 Leaflet layers for 60fps)
 * - Live TKM incident fetching & corridor speed / penalty analysis
 * - 8 major Istanbul crossings & arteries evaluator
 */
export const TrafficEngine = (() => {
  const CELL_DEG = 0.02;
  const INCIDENT_URL = "https://tkmservices.ibb.gov.tr/web/api/IntensityMap/v1/CurrentAnnouncement";

  const CORRIDORS = [
    {
      ad: "15 Temmuz Şehitler Köprüsü",
      adEn: "15 July Martyrs Bridge",
      minLat: 41.038,
      maxLat: 41.052,
      minLon: 29.018,
      maxLon: 29.048,
      km: 3.2,
    },
    {
      ad: "FSM Köprüsü",
      adEn: "FSM Bridge",
      minLat: 41.084,
      maxLat: 41.099,
      minLon: 29.042,
      maxLon: 29.076,
      km: 3.6,
    },
    {
      ad: "YSS Köprüsü",
      adEn: "Yavuz Sultan Selim Bridge",
      minLat: 41.195,
      maxLat: 41.215,
      minLon: 29.095,
      maxLon: 29.135,
      km: 4.5,
    },
    {
      ad: "Avrasya Tüneli",
      adEn: "Eurasia Tunnel",
      minLat: 40.996,
      maxLat: 41.012,
      minLon: 28.972,
      maxLon: 29.018,
      km: 5.4,
    },
    {
      ad: "D-100 Avrupa",
      adEn: "D-100 European Side",
      minLat: 40.985,
      maxLat: 41.072,
      minLon: 28.76,
      maxLon: 29.015,
      km: 24.0,
    },
    {
      ad: "D-100 Anadolu",
      adEn: "D-100 Anatolian Side",
      minLat: 40.875,
      maxLat: 41.008,
      minLon: 29.035,
      maxLon: 29.265,
      km: 26.0,
    },
    {
      ad: "TEM Avrupa",
      adEn: "TEM European Side",
      minLat: 41.06,
      maxLat: 41.115,
      minLon: 28.74,
      maxLon: 29.04,
      km: 28.0,
    },
    {
      ad: "TEM Anadolu",
      adEn: "TEM Anatolian Side",
      minLat: 40.94,
      maxLat: 41.09,
      minLon: 29.075,
      maxLon: 29.32,
      km: 25.0,
    },
  ];

  let grid = new Map();
  let segmentsById = new Map();
  let rawGeo = [];
  let cachedVeri = null;
  let cachedAna = null;
  let cachedIncidents = [];
  let incidentsFetchedAt = 0;

  function cellKey(gx, gy) {
    return `${gx}:${gy}`;
  }

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
   * Indexes `Trafik.geo` segments into 0.02° spatial grid cells.
   * @param {Array<[number, number[], number, number, number, number]>} geo
   */
  function buildSpatialIndex(geo) {
    grid = new Map();
    segmentsById = new Map();
    rawGeo = Array.isArray(geo) ? geo : [];

    for (const seg of rawGeo) {
      if (!seg || seg.length < 6) continue;
      const [id, flat, minLat, minLon, maxLat, maxLon] = seg;
      const latlngs = [];
      for (let i = 0; i < flat.length; i += 2) {
        latlngs.push([flat[i], flat[i + 1]]);
      }
      const entry = { id, latlngs, minLat, minLon, maxLat, maxLon };
      segmentsById.set(id, entry);

      const x0 = Math.floor(minLat / CELL_DEG);
      const x1 = Math.floor(maxLat / CELL_DEG);
      const y0 = Math.floor(minLon / CELL_DEG);
      const y1 = Math.floor(maxLon / CELL_DEG);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const k = cellKey(x, y);
          let list = grid.get(k);
          if (!list) {
            list = [];
            grid.set(k, list);
          }
          list.push(entry);
        }
      }
    }
  }

  /**
   * Updates stored live traffic speed/congestion map and major-road ID set.
   * @param {Map<number, [number, number]>} veri
   * @param {Set<number>} [ana]
   */
  function setTrafficData(veri, ana = null) {
    if (veri) cachedVeri = veri;
    if (ana) cachedAna = ana;
  }

  /**
   * Returns visible road polylines grouped into 5 congestion buckets (1..5),
   * reducing thousands of Leaflet layers down to at most 5 multi-polyline layers.
   * @param {object} bounds
   * @param {number} zoom
   * @param {Map} [veriOpt]
   * @param {Set} [anaOpt]
   * @returns {{ 1: Array, 2: Array, 3: Array, 4: Array, 5: Array }}
   */
  function getVisibleBatchedPolylines(bounds, zoom = 12, veriOpt = null, anaOpt = null) {
    const buckets = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    const veri = veriOpt || cachedVeri;
    const ana = anaOpt || cachedAna;
    if (!veri || !grid.size) return buckets;

    const b = extractBounds(bounds);
    if (!b) return buckets;

    const sadeceAna = zoom < 12 && ana && ana.size > 0;
    const x0 = Math.floor(b.minLat / CELL_DEG);
    const x1 = Math.floor(b.maxLat / CELL_DEG);
    const y0 = Math.floor(b.minLon / CELL_DEG);
    const y1 = Math.floor(b.maxLon / CELL_DEG);

    const seen = new Set();
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const list = grid.get(cellKey(x, y));
        if (!list) continue;
        for (const seg of list) {
          if (seen.has(seg.id)) continue;
          seen.add(seg.id);
          if (sadeceAna && !ana.has(seg.id)) continue;
          if (
            seg.maxLat < b.minLat ||
            seg.minLat > b.maxLat ||
            seg.maxLon < b.minLon ||
            seg.minLon > b.maxLon
          ) {
            continue;
          }
          const v = veri.get(seg.id);
          if (!v) continue;
          const level = Math.min(5, Math.max(1, Math.round(Number(v[0]) || 1)));
          buckets[level].push(seg.latlngs);
        }
      }
    }
    return buckets;
  }

  /**
   * Fetches live TKM traffic incidents / announcements directly.
   * @returns {Promise<Array<{ id: any, baslik: string, baslikEn: string, metin: string, metinEn: string, lat: number, lon: number, tur: string, oncelik: number, giris: string, bitis: string }>>}
   */
  async function fetchIncidents() {
    if (Date.now() - incidentsFetchedAt < 60e3 && cachedIncidents.length) {
      return cachedIncidents;
    }
    try {
      const raw = await API.http(INCIDENT_URL);
      const parsed = JSON.parse(raw || "[]");
      const list = Array.isArray(parsed) ? parsed : parsed?.Data || [];
      cachedIncidents = list
        .map((item, idx) => ({
          id: item.ID ?? item.Id ?? item.id ?? idx,
          baslik: String(item.BASLIK || item.Baslik || item.Title || "").trim(),
          baslikEn: String(item.BASLIK_EN || item.BaslikEn || item.TitleEn || "").trim(),
          metin: String(item.METIN || item.Metin || item.Description || "").trim(),
          metinEn: String(item.METIN_EN || item.MetinEn || item.DescriptionEn || "").trim(),
          lat: Number(item.LAT ?? item.LT ?? item.Enlem ?? item.Latitude),
          lon: Number(item.LON ?? item.LN ?? item.Boylam ?? item.Longitude),
          tur: String(item.TUR || item.Tur || item.Type || "Olay").trim(),
          oncelik: Number(item.ONCELIK ?? item.Oncelik ?? item.Priority ?? 1),
          giris: String(item.GIRIS_TARIHI || item.GirisTarihi || item.StartDate || "").trim(),
          bitis: String(item.BITIS_TARIHI || item.BitisTarihi || item.EndDate || "").trim(),
        }))
        .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));
      incidentsFetchedAt = Date.now();
      return cachedIncidents;
    } catch {
      return cachedIncidents;
    }
  }

  function findNearbyIncident(a, b) {
    if (!cachedIncidents.length || !a || !b) return null;
    const mid = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
    const radius = Math.max(600, Core.mesafe(a, b) * 0.6);
    let closest = null;
    let bestD = Infinity;
    for (const inc of cachedIncidents) {
      const d = Core.mesafe(mid, inc);
      if (d <= radius && d < bestD) {
        bestD = d;
        closest = inc;
      }
    }
    return closest;
  }

  /**
   * Computes live observed corridor speed and congestion level between points `a` and `b`.
   * @param {{ lat: number, lon: number }} a
   * @param {{ lat: number, lon: number }} b
   * @returns {{ speedKmH: number | null, congestionLevel: number | null, incident: object | null }}
   */
  function getCorridorSpeed(a, b) {
    const incident = findNearbyIncident(a, b);
    if (!a || !b || !cachedVeri || !grid.size) {
      return { speedKmH: null, congestionLevel: null, incident };
    }

    const pad = 0.005;
    const minLat = Math.min(a.lat, b.lat) - pad;
    const maxLat = Math.max(a.lat, b.lat) + pad;
    const minLon = Math.min(a.lon, b.lon) - pad;
    const maxLon = Math.max(a.lon, b.lon) + pad;

    const x0 = Math.floor(minLat / CELL_DEG);
    const x1 = Math.floor(maxLat / CELL_DEG);
    const y0 = Math.floor(minLon / CELL_DEG);
    const y1 = Math.floor(maxLon / CELL_DEG);

    let speedSum = 0;
    let levelSum = 0;
    let count = 0;
    const seen = new Set();

    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const list = grid.get(cellKey(x, y));
        if (!list) continue;
        for (const seg of list) {
          if (seen.has(seg.id)) continue;
          seen.add(seg.id);
          if (seg.maxLat < minLat || seg.minLat > maxLat || seg.maxLon < minLon || seg.minLon > maxLon) continue;
          const v = cachedVeri.get(seg.id);
          if (!v) continue;
          const level = Number(v[0]);
          const speed = Number(v[1]);
          if (Number.isFinite(speed) && speed > 0) {
            speedSum += speed;
            levelSum += Number.isFinite(level) ? level : 1;
            count++;
          }
        }
      }
    }

    if (!count) return { speedKmH: null, congestionLevel: null, incident };
    return {
      speedKmH: Math.round((speedSum / count) * 10) / 10,
      congestionLevel: Math.round((levelSum / count) * 10) / 10,
      incident,
    };
  }

  /**
   * Computes corridor speed, congestion level, and incident delay penalty between `a` and `b`.
   * @param {{ lat: number, lon: number }} a
   * @param {{ lat: number, lon: number }} b
   * @returns {{ speedKmH: number | null, congestionLevel: number | null, incident: object | null, penaltyMin: number }}
   */
  function getIncidentPenalty(a, b) {
    const base = getCorridorSpeed(a, b);
    let penaltyMin = 0;
    if (base.incident) {
      const p = Number(base.incident.oncelik) || 1;
      penaltyMin = p >= 3 ? 8 : p === 2 ? 5 : 3;
    }
    return { ...base, penaltyMin };
  }

  /**
   * Evaluates 8 major Istanbul crossings & arteries using live `Trafik.veri` and `Trafik.geo`.
   * @param {Map} [veriOpt]
   * @param {Array} [geoOpt]
   * @returns {Array<{ ad: string, adEn: string, ortHiz: number | null, seviye: number, tahminiDk: number | null, durum: string }>}
   */
  function analyzeCorridors(veriOpt = null, geoOpt = null) {
    const veri = veriOpt || cachedVeri;
    const geo = geoOpt || rawGeo;

    return CORRIDORS.map((c) => {
      if (!veri || !geo || !geo.length) {
        return { ad: c.ad, adEn: c.adEn, ortHiz: null, seviye: 0, tahminiDk: null, durum: "Veri Yok" };
      }

      let speedSum = 0;
      let levelSum = 0;
      let count = 0;

      for (const seg of geo) {
        const [id, , minLat, minLon, maxLat, maxLon] = seg;
        if (maxLat < c.minLat || minLat > c.maxLat || maxLon < c.minLon || minLon > c.maxLon) continue;
        const v = veri.get(id);
        if (!v) continue;
        const spd = Number(v[1]);
        const lvl = Number(v[0]);
        if (Number.isFinite(spd) && spd > 0) {
          speedSum += spd;
          levelSum += Number.isFinite(lvl) ? lvl : 1;
          count++;
        }
      }

      if (!count) {
        return { ad: c.ad, adEn: c.adEn, ortHiz: null, seviye: 0, tahminiDk: null, durum: "Veri Yok" };
      }

      const ortHiz = Math.round(speedSum / count);
      const seviye = Math.min(5, Math.max(1, Math.round(levelSum / count)));
      const tahminiDk = ortHiz > 0 ? Math.max(1, Math.round((c.km / ortHiz) * 60)) : null;
      const durum =
        seviye <= 1 ? "Akıcı" : seviye === 2 ? "Hafif Yoğun" : seviye === 3 ? "Orta Yoğun" : seviye === 4 ? "Yoğun" : "Çok Yoğun";

      return { ad: c.ad, adEn: c.adEn, ortHiz, seviye, tahminiDk, durum };
    });
  }

  return {
    buildSpatialIndex,
    setTrafficData,
    getVisibleBatchedPolylines,
    fetchIncidents,
    getCorridorSpeed,
    getIncidentPenalty,
    analyzeCorridors,
  };
})();
