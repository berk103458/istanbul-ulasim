import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createServer } from "../server.js";
import { Zaman } from "../src/core/time.js";
import { Core } from "../src/core/geo.js";
import { API } from "../src/core/api.js";
import { Plan } from "../src/core/router.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

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

  console.log("2. Server & Proxy integration tests...");
  const server = createServer();
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    for (const p of ["/", "/manifest.webmanifest", "/sw.js", "/icons/icon-512.png", "/health"]) {
      const r = await fetch(base + p);
      assert.equal(r.status, 200, `GET ${p} should be 200`);
    }

    // SSRF allowlist check
    const bad = await fetch(base + "/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/secret" }),
    });
    assert.equal(bad.status, 403, "Disallowed host must return 403");

    // Live proxy check: İETT Duyurular + Şehir Hatları + İSPARK
    const soapBody =
      '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetDuyurular_json xmlns="http://tempuri.org/"/></soap:Body></soap:Envelope>';
    const iettRes = await fetch(base + "/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://api.ibb.gov.tr/iett/UlasimDinamikVeri/Duyurular.asmx",
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '"http://tempuri.org/GetDuyurular_json"' },
        body: soapBody,
      }),
    });
    assert.equal(iettRes.status, 200, "IETT Duyurular proxy should return 200");
    const iettTxt = await iettRes.text();
    assert.ok(iettTxt.includes("GetDuyurular_jsonResult"));

    const vapurRes = await fetch(base + "/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://sehirhatlari.istanbul/tr/seferler", method: "GET" }),
    });
    assert.equal(vapurRes.status, 200, "Sehir Hatlari proxy should return 200");

    const isparkRes = await fetch(base + "/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://api.ibb.gov.tr/ispark/Park", method: "GET" }),
    });
    assert.equal(isparkRes.status, 200, "ISPARK proxy should return 200");
    const isparkJson = await isparkRes.json();
    assert.ok(Array.isArray(isparkJson) && isparkJson.length > 50, "ISPARK should return lots");
  } finally {
    server.close();
  }

  console.log("3. Release artifacts verification...");
  const scriptablePath = path.join(root, "releases", "Istanbul-Ulasim-v4.0-iOS-Scriptable.js");
  assert.ok(fs.existsSync(scriptablePath), "Scriptable bundle must exist");
  execSync(`node --check "${scriptablePath}"`, { stdio: "inherit" });

  const apkPath = path.join(root, "releases", "Istanbul-Ulasim-v4.0-Android.apk");
  assert.ok(fs.existsSync(apkPath), "Android APK must exist at releases/Istanbul-Ulasim-v4.0-Android.apk");
  const stat = fs.statSync(apkPath);
  assert.ok(stat.size > 2 * 1024 * 1024, `APK size should be > 2MB (got ${stat.size})`);
  const hdr = fs.readFileSync(apkPath, { length: 4 }).subarray(0, 2).toString("ascii");
  assert.equal(hdr, "PK", "APK must have valid ZIP/PK header");

  console.log("ALL VERIFICATION CHECKS PASSED!");
}

runTests().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
