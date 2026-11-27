import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { Zaman } from "../src/core/time.js";
import { Core } from "../src/core/geo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const live = process.argv.includes("--live");
const requireApk = process.argv.includes("--require-apk");

// Run the integration suite with the in-memory cache and without browser storage.
delete process.env.REDIS_URL;
delete globalThis.localStorage;
const { createServer } = await import("../server/localServer.js");
const { API } = await import("../src/core/api.js");
const { Plan } = await import("../src/core/router.js");

const soapBody =
  '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetDuyurular_json xmlns="http://tempuri.org/"/></soap:Body></soap:Envelope>';
const upstreamCases = [
  {
    name: "İETT Duyurular",
    payload: {
      url: "https://api.ibb.gov.tr/iett/UlasimDinamikVeri/Duyurular.asmx",
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '"http://tempuri.org/GetDuyurular_json"' },
      body: soapBody,
    },
    fixture: () => new Response("<GetDuyurular_jsonResult>[]</GetDuyurular_jsonResult>", {
      headers: { "Content-Type": "text/xml" },
    }),
    verify: (text) => assert.ok(text.includes("GetDuyurular_jsonResult"), "İETT SOAP result missing"),
  },
  {
    name: "Şehir Hatları",
    payload: { url: "https://sehirhatlari.istanbul/tr/seferler", method: "GET" },
    fixture: () => new Response("<html><body>Seferler</body></html>", {
      headers: { "Content-Type": "text/html" },
    }),
    verify: (text) => assert.ok(text.trim().length > 0, "Şehir Hatları response is empty"),
  },
  {
    name: "İSPARK",
    payload: { url: "https://api.ibb.gov.tr/ispark/Park", method: "GET" },
    fixture: () => Response.json([{ parkID: 1, parkName: "Test Otoparkı" }]),
    verify: (text) => {
      const parks = JSON.parse(text);
      assert.ok(Array.isArray(parks) && parks.length > 0, "İSPARK park list is empty");
    },
  },
];

async function verifyServer() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const realFetch = globalThis.fetch;
  const request = (pathname, options) =>
    realFetch(base + pathname, { ...options, signal: AbortSignal.timeout(30000) });
  const postProxy = (payload) => request("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  try {
    for (const [pathname, type] of [
      ["/", "text/html"],
      ["/manifest.webmanifest", "application/manifest+json"],
      ["/sw.js", "application/javascript"],
      ["/icons/icon-512.png", "image/png"],
    ]) {
      const response = await request(pathname);
      assert.equal(response.status, 200, `GET ${pathname} should return 200`);
      assert.ok(response.headers.get("content-type")?.startsWith(type), `GET ${pathname} should serve ${type}`);
      await response.arrayBuffer();
    }

    const health = await request("/health");
    assert.equal(health.status, 200);
    assert.equal((await health.json()).version, version);

    if (!live) {
      globalThis.fetch = async (url, options) => {
        const testCase = upstreamCases.find(({ payload }) => payload.url === url);
        assert.ok(testCase, `Unexpected upstream request: ${url}`);
        assert.equal(options.method, testCase.payload.method);
        assert.equal(options.body, testCase.payload.body);
        return testCase.fixture();
      };
    }

    const forbidden = await postProxy({ url: "https://example.com/secret" });
    assert.equal(forbidden.status, 403, "Disallowed host must return 403");
    await forbidden.arrayBuffer();

    const results = await Promise.allSettled(upstreamCases.map(async ({ name, payload, verify }) => {
      const response = await postProxy(payload);
      const body = await response.text();
      assert.equal(response.status, 200, `${name} proxy returned ${response.status}: ${body.slice(0, 160)}`);
      verify(body);
    }));
    const errors = results.flatMap((result, index) => result.status === "rejected"
      ? [new Error(upstreamCases[index].name, { cause: result.reason })]
      : []);
    if (errors.length) throw new AggregateError(errors, "Proxy verification failed");
  } finally {
    globalThis.fetch = realFetch;
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

function verifyReleaseArtifacts() {
  const scriptablePath = path.join(root, "releases", "Istanbul-Ulasim-v4.0-iOS-Scriptable.js");
  assert.ok(fs.existsSync(scriptablePath), "Scriptable bundle must exist");
  execFileSync(process.execPath, ["--check", scriptablePath], { stdio: "inherit", timeout: 10000 });

  const apkName = "Istanbul-Ulasim-v4.0-Android.apk";
  const apkPath = path.join(root, "releases", apkName);
  if (!fs.existsSync(apkPath)) {
    assert.ok(!requireApk, `Android APK must exist at releases/${apkName}`);
    console.log(`   Android check skipped: releases/${apkName} is absent (use --require-apk to require it).`);
    return;
  }

  const stat = fs.statSync(apkPath);
  assert.ok(stat.size > 2 * 1024 * 1024, `APK size should be > 2MB (got ${stat.size})`);
  const fd = fs.openSync(apkPath, "r");
  try {
    const header = Buffer.alloc(4);
    fs.readSync(fd, header, 0, header.length, 0);
    assert.equal(header.toString("hex"), "504b0304", "APK must start with a ZIP local file header");
  } finally {
    fs.closeSync(fd);
  }
}

async function runTests() {
  console.log("1. Unit tests: Zaman, Core, Marmaray, Plan...");
  assert.equal(Zaman.dk("06:15 *"), 375);
  assert.equal(Zaman.dk("00:30"), 1470);
  assert.equal(Zaman.saatFormat(1470), "00:30");
  assert.equal(Zaman.kalanYazi(0), "şimdi");
  assert.equal(Zaman.kalanYazi(75), "1 sa 15 dk");

  const dKadikoyTaksim = Core.mesafe({ lat: 40.9909, lon: 29.0235 }, { lat: 41.0369, lon: 28.9851 });
  assert.ok(dKadikoyTaksim > 5000 && dKadikoyTaksim < 7500, "Distance sanity");

  const mrStations = await API.marmaray.istasyonlar();
  assert.equal(mrStations.length, 43, "Marmaray should have 43 stations");
  const mrTimes = API.marmaray.saatler(28, 720); // Üsküdar at 12:00
  assert.equal(mrTimes.length, 2);
  assert.ok(mrTimes[0].saatler.length > 0 && mrTimes[1].saatler.length > 0);
  const mrTrains = API.marmaray.aktifTrenler(720);
  assert.ok(mrTrains.length >= 4, "Marmaray should have active estimated trains at 12:00");

  // Routing sanity on Marmaray-only graph
  const testAg = Plan.kur({ hatlar: [], istasyonlar: [], marmaray: true, gun: 3, saat: 720 });
  const rMr = Plan.ara(testAg, { lat: 41.02576, lon: 29.01379, ad: "Üsküdar" }, { lat: 41.00478, lon: 28.94958, ad: "Yenikapı" }, 720);
  assert.ok(rMr.enIyi, "Marmaray route Uskudar -> Yenikapi should succeed");
  assert.ok(rMr.enIyi.bacaklar.some((b) => b.tur === "marmaray"));

  console.log(`2. Server & Proxy integration tests (${live ? "live upstreams" : "local fixtures"})...`);
  await verifyServer();
  if (!live) console.log("   Live checks for İETT, Şehir Hatları and İSPARK: npm test -- --live");

  console.log("3. Release artifacts verification...");
  verifyReleaseArtifacts();

  console.log("4. Proxy contract tests...");
  execFileSync(process.execPath, ["--test", "tests/proxy.test.mjs"], {
    cwd: root,
    stdio: "inherit",
    timeout: 60000,
  });

  console.log("5. Engine tests...");
  execFileSync(process.execPath, ["--test", "tests/engines/"], {
    cwd: root,
    stdio: "inherit",
    timeout: 60000,
  });

  console.log("6. App tests...");
  execFileSync(process.execPath, ["--test", "tests/app/"], {
    cwd: root,
    stdio: "inherit",
    timeout: 60000,
  });

  console.log("ALL VERIFICATION CHECKS PASSED!");
}

runTests().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
