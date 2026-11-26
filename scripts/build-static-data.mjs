import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "public", "data");
fs.mkdirSync(dataDir, { recursive: true });

const IETT = "https://api.ibb.gov.tr/iett";
const VAPUR = "https://sehirhatlari.istanbul";
const ISPARK = "https://api.ibb.gov.tr/ispark/Park";
const UA = "Mozilla/5.0 (Linux; Android 14; Mobile) IstanbulUlasim/4.0";

async function soap(p, method, params = {}) {
  const inner = Object.entries(params)
    .map(([k, v]) => `<${k}>${String(v).replace(/[<>&]/g, "")}</${k}>`)
    .join("");
  const body =
    '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<soap:Body><${method} xmlns="http://tempuri.org/">${inner}</${method}></soap:Body></soap:Envelope>`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(IETT + p, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `"http://tempuri.org/${method}"`,
        "User-Agent": UA,
      },
      body,
      signal: ctrl.signal,
    });
    const text = await r.text();
    const m = new RegExp(`<${method}Result[^>]*>([\\s\\S]*?)</${method}Result>`, "i").exec(text);
    return m ? m[1] : "";
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtml(s) {
  return String(s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(s) {
  return decodeHtml(String(s || "").replace(/<[^>]*>/g, " "));
}

function dkVal(s) {
  const m = /(\d{1,2})[:.](\d{2})/.exec(s || "");
  if (!m) return null;
  let v = +m[1] * 60 + +m[2];
  if (+m[1] < 4) v += 1440;
  return v;
}

console.log("1. Fetching İETT hatlar & duyurular...");
const hatlarRaw = JSON.parse((await soap("/UlasimAnaVeri/HatDurakGuzergah.asmx", "GetHat_json", { HatKodu: "" })) || "[]");
const hatlar = hatlarRaw.map((h) => ({
  kod: h.SHATKODU,
  ad: h.SHATADI,
  tarife: h.TARIFE,
  km: h.HAT_UZUNLUGU,
  dk: h.SEFER_SURESI,
}));
fs.writeFileSync(path.join(dataDir, "iett-hatlar.json"), JSON.stringify(hatlar));
console.log(`   -> ${hatlar.length} lines`);

let duyurular = [];
try {
  const dRaw = JSON.parse((await soap("/UlasimDinamikVeri/Duyurular.asmx", "GetDuyurular_json", {})) || "[]");
  duyurular = dRaw.map((d) => ({
    hat: String(d.HATKODU || "").trim(),
    hatKod: String(d.HATKODU || "").trim(),
    hatAdi: String(d.HAT || "").trim(),
    tip: String(d.TIP || "Duyuru").trim(),
    saat: String(d.GUNCELLEME_SAATI || "").trim(),
    mesaj: String(d.MESAJ || "").trim(),
  }));
} catch {}
fs.writeFileSync(path.join(dataDir, "iett-duyurular.json"), JSON.stringify(duyurular));
console.log(`   -> ${duyurular.length} announcements`);

console.log("2. Fetching full İETT bus stop network (DurakDetay_GYY)...");
const ob = { duraklar: {}, hatlar: [], zaman: Date.now() };
let hi = 0;
let hDone = 0;
async function agWorker() {
  while (hi < hatlar.length) {
    const h = hatlar[hi++];
    try {
      const xml = await soap("/ibb/ibb.asmx", "DurakDetay_GYY", { hat_kodu: h.kod });
      const yon = {};
      const rows = [];
      const tableRe = /<Table>([\s\S]*?)<\/Table>/g;
      let tm;
      while ((tm = tableRe.exec(xml))) {
        const block = tm[1];
        const tag = (name) => {
          const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
          return m ? decodeHtml(m[1]) : "";
        };
        const d = {
          sira: +tag("SIRANO"),
          kod: tag("DURAKKODU"),
          ad: tag("DURAKADI"),
          lat: +tag("YKOORDINATI"),
          lon: +tag("XKOORDINATI"),
          yon: tag("YON"),
        };
        if (!isFinite(d.lat) || !isFinite(d.lon) || !d.kod) continue;
        rows.push(d);
      }
      const byYon = {};
      for (const r of rows) (byYon[r.yon] ||= []).push(r);
      for (const [y, list] of Object.entries(byYon)) {
        list.sort((a, b) => a.sira - b.sira);
        yon[y] = list.map((d) => {
          ob.duraklar[d.kod] = [Math.round(d.lat * 1e5) / 1e5, Math.round(d.lon * 1e5) / 1e5, d.ad];
          return d.kod;
        });
      }
      if (Object.keys(yon).length) {
        ob.hatlar.push({ kod: h.kod, mb: /METROBÜS/i.test(h.tarife || ""), yon });
      }
    } catch {}
    hDone++;
    if (hDone % 150 === 0 || hDone === hatlar.length) {
      console.log(`   -> ${hDone}/${hatlar.length} lines`);
    }
  }
}
await Promise.all(Array.from({ length: 30 }, agWorker));
fs.writeFileSync(path.join(dataDir, "iett-ag.json"), JSON.stringify(ob));
console.log(`   -> Saved iett-ag.json (${ob.hatlar.length} lines, ${Object.keys(ob.duraklar).length} stops)`);

console.log("3. Fetching popular & Metrobüs timetables...");
const starterSet = new Set([
  "14BK", "18K", "500T", "15F", "19F", "11ÜS", "16D", "14R", "129T", "25G", "40", "76D", "145T", "E-10", "E-3",
  "16", "16A", "17", "19S", "20D", "20K", "130Ş", "133F", "KM10", "KM20", "KM21", "KM30", "KM40",
]);
for (const h of hatlar) {
  if (/^34/.test(h.kod) || starterSet.size < 95) starterSet.add(h.kod);
}
const popCodes = [...starterSet];
const seferPop = {};
let si = 0;
async function seferWorker() {
  while (si < popCodes.length) {
    const kod = popCodes[si++];
    try {
      const jsonStr = await soap("/UlasimAnaVeri/PlanlananSeferSaati.asmx", "GetPlanlananSeferSaati_json", { HatKodu: kod });
      const out = {};
      for (const s of JSON.parse(jsonStr || "[]")) {
        const y = s.SYON;
        const g = s.SGUNTIPI;
        if (!y || !g || !s.DT) continue;
        ((out[y] ||= {})[g] ||= []).push(s.DT);
      }
      for (const y of Object.values(out)) {
        for (const g of Object.keys(y)) {
          y[g] = [...new Set(y[g])].sort((a, b) => (dkVal(a) ?? 0) - (dkVal(b) ?? 0));
        }
      }
      if (Object.keys(out).length) seferPop[kod] = out;
    } catch {}
  }
}
await Promise.all(Array.from({ length: 25 }, seferWorker));
fs.writeFileSync(path.join(dataDir, "iett-sefer-populer.json"), JSON.stringify(seferPop));
console.log(`   -> Saved ${Object.keys(seferPop).length} line timetables`);

console.log("4. Fetching Şehir Hatları (Vapur) schedules...");
const vHtml = await (await fetch(VAPUR + "/tr/seferler", { headers: { "User-Agent": UA } })).text();
const seenV = new Set();
const vHatlar = [];
const linkRe = /<a[^>]+href="([^"]*\/seferler\/ic-hatlar\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
let lm;
while ((lm = linkRe.exec(vHtml))) {
  const href = lm[1];
  const parca = href.split("/").filter(Boolean);
  if (parca.length < 5 || seenV.has(href)) continue;
  seenV.add(href);
  const grup =
    {
      "istanbul-ici-hatlar": "İstanbul İçi",
      "bogaz-hatlari": "Boğaz",
      "adalar-hatlari": "Adalar",
    }[parca[3]] || "Diğer";
  vHatlar.push({ ad: stripTags(lm[2]), url: VAPUR + href, grup });
}
const vTarifeler = {};
let vi = 0;
async function vapurWorker() {
  while (vi < vHatlar.length) {
    const h = vHatlar[vi++];
    try {
      const html = await (await fetch(h.url, { headers: { "User-Agent": UA } })).text();
      const tablolar = [];
      let baslik = "";
      const elRe = /<(h2|table)[^>]*>([\s\S]*?)<\/\1>/gi;
      let em;
      while ((em = elRe.exec(html))) {
        if (em[1].toLowerCase() === "h2") {
          baslik = stripTags(em[2]);
          continue;
        }
        const satirlar = [];
        const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let trm;
        while ((trm = trRe.exec(em[2]))) {
          const cells = [];
          const tdRe = /<(t[dh])[^>]*>([\s\S]*?)<\/\1>/gi;
          let tdm;
          while ((tdm = tdRe.exec(trm[1]))) cells.push(stripTags(tdm[2]));
          if (cells.length) satirlar.push(cells);
        }
        if (!satirlar.length) continue;
        const ilkVeri = satirlar.findIndex((r) => r.some((c) => /^\d{1,2}[:.]\d{2}/.test(c)));
        if (ilkVeri < 0) continue;
        const ust = satirlar.slice(0, ilkVeri);
        const not = ust.filter((r) => r.length === 1).map((r) => r[0]).join(" ");
        const basliklar = ust.filter((r) => r.length > 1);
        tablolar.push({ baslik, not, basliklar, satirlar: satirlar.slice(ilkVeri) });
      }
      vTarifeler[h.url] = tablolar;
    } catch {}
  }
}
await Promise.all(Array.from({ length: 8 }, vapurWorker));
fs.writeFileSync(path.join(dataDir, "vapur.json"), JSON.stringify({ hatlar: vHatlar, tarifeler: vTarifeler }));
console.log(`   -> Saved ${vHatlar.length} ferry lines`);

console.log("5. Fetching İSPARK parking lots...");
const isparkRaw = await (await fetch(ISPARK, { headers: { "User-Agent": UA } })).json();
const ispark = (Array.isArray(isparkRaw) ? isparkRaw : [])
  .map((p) => ({
    id: p.parkID,
    ad: p.parkName,
    lat: +p.lat,
    lon: +p.lng,
    kapasite: +p.capacity || 0,
    bos: Math.max(0, +p.emptyCapacity || 0),
    saat: p.workHours || "",
    tip: p.parkType || "",
    ilce: p.district || "",
    ucretsizDk: +p.freeTime || 0,
  }))
  .filter((p) => isFinite(p.lat) && isFinite(p.lon) && p.lat > 40 && p.lon > 27);
fs.writeFileSync(path.join(dataDir, "ispark.json"), JSON.stringify(ispark));
console.log(`   -> Saved ${ispark.length} İSPARK lots`);
console.log("Static data build complete!");
