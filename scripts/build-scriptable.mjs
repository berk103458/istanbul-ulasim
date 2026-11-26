import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist");
const outDir = path.join(root, "releases");
fs.mkdirSync(outDir, { recursive: true });

const indexPath = path.join(distDir, "index.html");
if (!fs.existsSync(indexPath)) {
  console.error("dist/index.html not found. Run `npm.cmd run build` first.");
  process.exit(1);
}

let html = fs.readFileSync(indexPath, "utf8");

// Inline CSS files referenced by <link rel="stylesheet" href="./assets/...">
html = html.replace(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/gi, (m, href) => {
  if (href.startsWith("http")) return m;
  const rel = href.replace(/^\.\//, "").replace(/^\//, "");
  const p = path.join(distDir, rel);
  if (fs.existsSync(p)) {
    const css = fs.readFileSync(p, "utf8");
    return `<style>\n${css}\n</style>`;
  }
  return m;
});

// Inline JS modules referenced by <script type="module" ... src="...">
html = html.replace(/<script[^>]+src="([^"]+)"[^>]*><\/script>/gi, (m, src) => {
  if (src.startsWith("http")) return m;
  const rel = src.replace(/^\.\//, "").replace(/^\//, "");
  const p = path.join(distDir, rel);
  if (fs.existsSync(p)) {
    const js = fs.readFileSync(p, "utf8");
    // Strip ES module import/export if bundled, wrap safely
    return `<script type="module">\n${js}\n</script>`;
  }
  return m;
});

// Strip PWA manifest / SW registration tags that aren't needed in Scriptable WebView
html = html.replace(/<link[^>]+rel="manifest"[^>]*>/gi, "");

const scriptableCode = `// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: bus;

// İstanbul Ulaşım v4.0 — iOS Scriptable Uygulaması + Ana Ekran Widget'ı
// Veriler: İETT (+Duyurular), Metro İstanbul, Marmaray, Şehir Hatları, TKM Trafik, İSPARK, Transitous.
// Tüm istekler doğrudan iPhone/iPad üzerinden yapılır; sunucu gerekmez.

const SURUM = "4.0";

// ---- Kalıcı kayıt: her anahtar ayrı dosya ----
const fm = FileManager.local();
const klasor = fm.joinPath(fm.documentsDirectory(), "istanbul-ulasim-v4");
if (!fm.fileExists(klasor)) fm.createDirectory(klasor, true);

function dosyaAdi(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return key.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60) + "-" + h.toString(36) + ".json";
}

function kvOku(key) {
  const yol = fm.joinPath(klasor, dosyaAdi(key));
  try {
    return fm.fileExists(yol) ? JSON.parse(fm.readString(yol)) : null;
  } catch (e) {
    return null;
  }
}

function kvYaz(key, value) {
  try {
    fm.writeString(fm.joinPath(klasor, dosyaAdi(key)), JSON.stringify(value));
  } catch (e) {
    console.error(e);
  }
}

// ---- iOS Ana Ekran Widget Desteği ----
async function buildWidget() {
  const w = new ListWidget();
  const bg = new LinearGradient();
  bg.colors = [new Color("#0b1936"), new Color("#0f2c66")];
  bg.locations = [0, 1];
  w.backgroundGradient = bg;
  w.setPadding(14, 16, 14, 16);

  const head = w.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  const title = head.addText("İstanbul Ulaşım");
  title.font = Font.boldSystemFont(14);
  title.textColor = Color.white();
  head.addSpacer();

  let trafik = null;
  try {
    const r = new Request("https://tkmservices.ibb.gov.tr/web/api/TrafficData/v1/TrafficIndex_Sc1_Cont");
    r.timeoutInterval = 8;
    trafik = await r.loadJSON();
  } catch {}

  const badge = head.addStack();
  badge.backgroundColor = new Color(trafik && trafik.TI >= 70 ? "#dc2626" : trafik && trafik.TI >= 45 ? "#d97706" : "#0d9448");
  badge.cornerRadius = 8;
  badge.setPadding(3, 7, 3, 7);
  const bTxt = badge.addText(trafik ? "Trafik %" + trafik.TI : "Canlı");
  bTxt.font = Font.boldSystemFont(11);
  bTxt.textColor = Color.white();

  w.addSpacer(8);

  if (trafik) {
    const sub = w.addText("Avrupa %" + trafik.TI_Av + "  ·  Anadolu %" + trafik.TI_An);
    sub.font = Font.mediumSystemFont(12);
    sub.textColor = new Color("#cbd5e1");
    w.addSpacer(6);
  }

  const fav = kvOku("favoriler");
  const favList = Array.isArray(fav && fav.d) && fav.d.length ? fav.d.slice(0, 3) : ["14BK", "500T"];
  const favRow = w.addText("Favoriler: " + favList.join(" · "));
  favRow.font = Font.semiboldSystemFont(12);
  favRow.textColor = new Color("#93c5fd");

  w.addSpacer();
  const foot = w.addText("Dokunup canlı haritayı açın · v" + SURUM);
  foot.font = Font.systemFont(10);
  foot.textColor = new Color("#94a3b8");
  return w;
}

if (config.runsInWidget) {
  const widget = await buildWidget();
  Script.setWidget(widget);
  Script.complete();
} else {
  const HTML = ${JSON.stringify(html)};

  async function karsila(kind, a) {
    switch (kind) {
      case "http": {
        const r = new Request(a.url);
        r.method = a.method || "GET";
        r.timeoutInterval = 25;
        r.headers = Object.assign(
          { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) IstanbulUlasim/" + SURUM },
          a.headers || {}
        );
        if (a.body != null) r.body = a.body;
        const text = await r.loadString();
        const status = (r.response && r.response.statusCode) || 0;
        return { status, text };
      }
      case "kvget":
        return kvOku(a.key);
      case "kvset":
        kvYaz(a.key, a.value);
        return true;
      case "location": {
        Location.setAccuracyToBest();
        const l = await Location.current();
        return { lat: l.latitude, lon: l.longitude, acc: l.horizontalAccuracy };
      }
      case "open":
        Safari.open(a.url);
        return true;
      default:
        throw new Error("Bilinmeyen istek: " + kind);
    }
  }

  const bekle = (ms) => new Promise((res) => Timer.schedule(ms, false, res));
  const wv = new WebView();
  await wv.loadHTML(
    HTML.replace("<head>", "<head><script>window.__SCRIPTABLE__=true;</script>"),
    "https://istanbul-ulasim.app/"
  );

  let kapandi = false;
  const sunum = wv.present(true).then(() => {
    kapandi = true;
  });

  const giden = [];
  let bosTur = 0;
  while (!kapandi) {
    let istekler = [];
    try {
      const s = await wv.evaluateJavaScript("typeof __bridgeTake==='function' ? __bridgeTake() : '[]'", false);
      istekler = JSON.parse(s || "[]");
    } catch (e) {
      istekler = [];
    }

    for (const q of istekler) {
      karsila(q.kind, q.args || {}).then(
        (data) => giden.push({ id: q.id, ok: true, data }),
        (err) => giden.push({ id: q.id, ok: false, data: String((err && err.message) || err) })
      );
    }

    if (giden.length) {
      const paket = giden.splice(0);
      try {
        await wv.evaluateJavaScript("__bridgeDeliver(" + JSON.stringify(paket) + ");0", false);
      } catch (e) {
        console.error(e);
      }
    }

    bosTur = istekler.length || giden.length ? 0 : bosTur + 1;
    await bekle(bosTur > 50 ? 300 : 120);
  }

  await sunum;
  Script.complete();
}
`;

const outPath = path.join(outDir, "Istanbul-Ulasim-v4.0-iOS-Scriptable.js");
fs.writeFileSync(outPath, scriptableCode, "utf8");
console.log("Built Scriptable bundle:", outPath, Math.round(scriptableCode.length / 1024) + " KB");
