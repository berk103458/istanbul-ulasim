import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { handleProxyRequest, CORS_HEADERS } from "./server/proxyCore.js";
import { sharedCache } from "./server/cacheLayer.js";
import { gateway } from "./server/apiGateway.js";
import { handleSseConnection, getFleetInBbox } from "./server/sseHub.js";
import {
  isGoogleMapsConfigured,
  handleGoogleRoutes,
  handleGooglePlaces,
  handleGoogleGeocode,
} from "./server/googleMapsProxy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { version } = createRequire(import.meta.url)("./package.json");
const DIST_DIR = path.join(__dirname, "dist");
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".webmanifest", ".svg"]);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendCompressed(req, res, status, headers, bodyBuf, ext = ".json") {
  const ae = String(req.headers["accept-encoding"] || "");
  if (COMPRESSIBLE.has(ext) && ae.includes("gzip") && bodyBuf.length > 512) {
    zlib.gzip(bodyBuf, (err, gz) => {
      if (err) {
        res.writeHead(status, headers);
        res.end(bodyBuf);
        return;
      }
      res.writeHead(status, { ...headers, "Content-Encoding": "gzip", Vary: "Accept-Encoding" });
      res.end(gz);
    });
    return;
  }
  res.writeHead(status, headers);
  res.end(bodyBuf);
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";

    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    if (reqUrl.pathname.startsWith("/api/")) {
      const rl = gateway.checkRateLimit(String(ip));
      if (!rl.allowed) {
        res.writeHead(429, {
          ...CORS_HEADERS,
          "Content-Type": "application/json; charset=utf-8",
          "Retry-After": String(rl.retryAfterSec),
        });
        res.end(JSON.stringify({ error: "Rate limit exceeded", retryAfterSec: rl.retryAfterSec }));
        return;
      }
    }

    if (reqUrl.pathname === "/api/stream") {
      return handleSseConnection(req, res, reqUrl);
    }

    if (reqUrl.pathname === "/api/fleet") {
      try {
        const bbox = reqUrl.searchParams.get("bbox") || "";
        const buses = await getFleetInBbox(bbox);
        sendCompressed(
          req,
          res,
          200,
          { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=5" },
          Buffer.from(JSON.stringify({ ts: Date.now(), count: buses.length, buses }), "utf8"),
          ".json"
        );
      } catch (e) {
        res.writeHead(502, { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: String(e?.message || e) }));
      }
      return;
    }

    if (reqUrl.pathname === "/api/google/routes" && req.method === "POST") {
      const raw = await readBody(req).catch(() => "{}");
      const out = await handleGoogleRoutes(JSON.parse(raw || "{}"));
      res.writeHead(out.status, { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(out.body));
      return;
    }

    if (reqUrl.pathname === "/api/google/places" && req.method === "POST") {
      const raw = await readBody(req).catch(() => "{}");
      const out = await handleGooglePlaces(JSON.parse(raw || "{}"));
      res.writeHead(out.status, { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(out.body));
      return;
    }

    if (reqUrl.pathname === "/api/google/geocode" && req.method === "GET") {
      const out = await handleGoogleGeocode(reqUrl.searchParams.get("address") || "");
      res.writeHead(out.status, { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(out.body));
      return;
    }

    if (reqUrl.pathname === "/api/metrics") {
      const m = gateway.getMetrics(sharedCache.getMetrics());
      res.writeHead(200, { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(m));
      return;
    }

    if (reqUrl.pathname === "/api/health" || reqUrl.pathname === "/health") {
      const m = gateway.getMetrics(sharedCache.getMetrics());
      res.writeHead(200, { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          ok: true,
          service: "istanbul-ulasim",
          version,
          googleMapsConfigured: isGoogleMapsConfigured(),
          redis: m.cache.redis,
          providers: m.providers,
          uptimeSec: m.uptimeSec,
        })
      );
      return;
    }

    if (reqUrl.pathname === "/api/proxy") {
      try {
        let payload;
        if (req.method === "GET") {
          payload = { url: reqUrl.searchParams.get("url") || "", method: "GET" };
        } else if (req.method === "POST") {
          const raw = await readBody(req);
          payload = JSON.parse(raw || "{}");
        } else {
          res.writeHead(405, CORS_HEADERS);
          res.end("Method Not Allowed");
          return;
        }
        const result = await handleProxyRequest(payload);
        sendCompressed(
          req,
          res,
          result.status,
          { ...CORS_HEADERS, ...result.headers },
          Buffer.from(result.text, "utf8"),
          ".json"
        );
      } catch (e) {
        res.writeHead(400, { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: String(e?.message || e) }));
      }
      return;
    }

    const baseDir = fs.existsSync(DIST_DIR) ? DIST_DIR : PUBLIC_DIR;
    let relPath = decodeURIComponent(reqUrl.pathname);
    if (relPath === "/") relPath = "/index.html";
    const safePath = path.normalize(relPath).replace(/^(\.\.[/\\])+/, "");
    let filePath = path.join(baseDir, safePath);

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(baseDir, "index.html");
    }
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";
    const cacheHeader =
      safePath.includes("sw.js") || ext === ".html"
        ? "no-cache"
        : safePath.includes("assets")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600";

    const buf = fs.readFileSync(filePath);
    sendCompressed(req, res, 200, { "Content-Type": mime, "Cache-Control": cacheHeader }, buf, ext);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 4173;
  const server = createServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(`Istanbul Ulasim v${version} server listening on http://localhost:${port}`);
  });
}
