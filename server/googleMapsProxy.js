import { gateway } from "./apiGateway.js";

/**
 * Official Google Maps Platform Server-Side Proxy:
 * Keeps GOOGLE_MAPS_SERVER_KEY strictly on the server (never leaked to client bundle).
 * Returns 503 { configured: false } cleanly when key is not configured so client fails over
 * to the open İBB + Transitous + Web Worker A* stack.
 */
export function isGoogleMapsConfigured() {
  return Boolean(process.env.GOOGLE_MAPS_SERVER_KEY);
}

export async function handleGoogleRoutes(payload) {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) {
    return {
      status: 503,
      body: { configured: false, reason: "GOOGLE_MAPS_SERVER_KEY is not set" },
    };
  }
  const t0 = performance.now();
  try {
    const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps.transitDetails,routes.legs.steps.travelMode,routes.legs.steps.staticDuration,routes.legs.steps.distanceMeters",
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    gateway.recordSuccess("google", performance.now() - t0);
    return { status: r.status, body: data };
  } catch (err) {
    gateway.recordFailure("google", performance.now() - t0);
    return { status: 502, body: { error: String(err?.message || err) } };
  }
}

export async function handleGooglePlaces(payload) {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) {
    return {
      status: 503,
      body: { configured: false, reason: "GOOGLE_MAPS_SERVER_KEY is not set" },
    };
  }
  const t0 = performance.now();
  try {
    const r = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    gateway.recordSuccess("google", performance.now() - t0);
    return { status: r.status, body: data };
  } catch (err) {
    gateway.recordFailure("google", performance.now() - t0);
    return { status: 502, body: { error: String(err?.message || err) } };
  }
}

export async function handleGoogleGeocode(address) {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) {
    return {
      status: 503,
      body: { configured: false, reason: "GOOGLE_MAPS_SERVER_KEY is not set" },
    };
  }
  const t0 = performance.now();
  try {
    const u = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      address || ""
    )}&language=tr&region=tr&key=${encodeURIComponent(key)}`;
    const r = await fetch(u);
    const data = await r.json();
    gateway.recordSuccess("google", performance.now() - t0);
    return { status: r.status, body: data };
  } catch (err) {
    gateway.recordFailure("google", performance.now() - t0);
    return { status: 502, body: { error: String(err?.message || err) } };
  }
}
