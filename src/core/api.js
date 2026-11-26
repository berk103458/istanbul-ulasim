import { Bridge } from "./bridge.js";
import { KV } from "./storage.js";
import { Zaman } from "./time.js";

const IETT = "https://api.ibb.gov.tr/iett";
const METRO = "https://api.ibb.gov.tr/MetroIstanbul/api/MetroMobile/V2/";
const VAPUR = "https://sehirhatlari.istanbul";
const TKM = "https://tkmservices.ibb.gov.tr/web/api/";
const TR = "https://api.transitous.org/api/v1/";
const ISPARK_URL = "https://api.ibb.gov.tr/ispark/Park";
const GUN = 864e5;
const mem = new Map();

export const MARMARAY_STATIONS = [
  ["Gebze", 40.78425, 29.40956, 0, []],
  ["Darıca", 40.79142, 29.39184, 2.8, []],
  ["Osmangazi", 40.79927, 29.38001, 4.8, []],
  ["Fatih", 40.80763, 29.36393, 7.3, []],
  ["Çayırova", 40.8105, 29.34751, 9.4, []],
  ["Tuzla", 40.82995, 29.32236, 13.9, []],
  ["İçmeler", 40.84565, 29.30006, 17.6, []],
  ["Aydıntepe", 40.85229, 29.29317, 19.1, []],
  ["Güzelyalı", 40.85685, 29.2835, 20.7, []],
  ["Tersane", 40.86098, 29.27336, 22.4, []],
  ["Kaynarca", 40.8713, 29.25603, 25.1, []],
  ["Pendik", 40.88021, 29.23167, 28.6, ["YHT"]],
  ["Yunus", 40.8845, 29.21054, 31.3, []],
  ["Kartal", 40.88861, 29.19119, 33.9, []],
  ["Başak", 40.89056, 29.17735, 36.1, []],
  ["Atalar", 40.89859, 29.16945, 37.9, []],
  ["Cevizli", 40.91002, 29.15605, 40.4, []],
  ["Maltepe", 40.92065, 29.13353, 43.6, []],
  ["Süreyya Plajı", 40.92683, 29.1242, 45.3, []],
  ["İdealtepe", 40.93781, 29.11426, 47.5, []],
  ["Küçükyalı", 40.94626, 29.10682, 49.5, []],
  ["Bostancı", 40.9538, 29.09506, 51.6, ["M8", "İDO"]],
  ["Suadiye", 40.96048, 29.08442, 53.6, []],
  ["Erenköy", 40.97141, 29.07647, 55.9, []],
  ["Göztepe", 40.97916, 29.06256, 58.3, []],
  ["Feneryolu", 40.9787, 29.04901, 60.1, []],
  ["Söğütlüçeşme", 40.9909, 29.03763, 62.6, ["Metrobüs", "YHT"]],
  ["Ayrılık Çeşmesi", 41.00014, 29.03014, 64.6, ["M4"]],
  ["Üsküdar", 41.02576, 29.01379, 70, ["M5", "Vapur"]],
  ["Sirkeci", 41.01355, 28.97705, 74.8, ["T1", "Vapur"]],
  ["Yenikapı", 41.00478, 28.94958, 78.5, ["M1A", "M1B", "M2"]],
  ["Kazlıçeşme", 40.99269, 28.91688, 83.2, []],
  ["Zeytinburnu", 40.98587, 28.90545, 85.2, []],
  ["Yenimahalle", 40.98174, 28.88105, 88.4, []],
  ["Bakırköy", 40.98027, 28.87232, 89.7, ["M3", "YHT"]],
  ["Ataköy", 40.98022, 28.85623, 91.7, ["M9"]],
  ["Yeşilyurt", 40.96548, 28.83728, 95.4, []],
  ["Yeşilköy", 40.96266, 28.82488, 97.1, []],
  ["Florya Akvaryum", 40.96777, 28.79705, 100.7, []],
  ["Florya", 40.97296, 28.78748, 102.3, []],
  ["Küçükçekmece", 40.98853, 28.77295, 105.8, ["Metrobüs"]],
  ["Mustafa Kemal", 41.00628, 28.77395, 109.1, []],
  ["Halkalı", 41.01784, 28.76644, 111.6, ["YHT"]],
];

async function http(url, opt = {}) {
  const r = await Bridge.http({ url, ...opt });
  if (!r || (r.status >= 400 && r.status !== 500)) {
    throw new Error(`Sunucu hatası (${r && r.status})`);
  }
  return r.text;
}

function extractTagText(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = re.exec(xml);
  return m ? m[1] : "";
}

async function soap(path, method, params = {}) {
  const inner = Object.entries(params)
    .map(([k, v]) => `<${k}>${String(v).replace(/[<>&]/g, "")}</${k}>`)
    .join("");
  const body =
    '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<soap:Body><${method} xmlns="http://tempuri.org/">${inner}</${method}></soap:Body></soap:Envelope>`;
  const text = await http(IETT + path, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"http://tempuri.org/${method}"`,
    },
    body,
  });

  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(text, "text/xml");
    const node = doc.getElementsByTagName(method + "Result")[0];
    if (!node) {
      const f = doc.getElementsByTagName("faultstring")[0];
      throw new Error("İETT: " + (f ? f.textContent : "beklenmeyen cevap"));
    }
    return { node, text: node.textContent || "" };
  }

  const raw = extractTagText(text, method + "Result");
  if (!raw) throw new Error("İETT: beklenmeyen cevap");
  return { node: null, text: raw };
}

const staticMem = new Map();
async function fetchStaticJson(relPath) {
  if (typeof fetch !== "function" || typeof window === "undefined" || window.__SCRIPTABLE__) return null;
  if (staticMem.has(relPath)) return staticMem.get(relPath);
  const p = fetch("./data/" + relPath)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  staticMem.set(relPath, p);
  return p;
}

async function cached(key, maxAge, fn) {
  const m = mem.get(key);
  if (m && Date.now() - m.t < maxAge) return m.d;
  let d = await KV.get(key, maxAge);
  if (d == null) {
    d = await fn();
    KV.set(key, d);
  }
  mem.set(key, { t: Date.now(), d });
  return d;
}

const iett = {
  hatlar: () =>
    cached("iett.hatlar", GUN, async () => {
      try {
        const res = await soap("/UlasimAnaVeri/HatDurakGuzergah.asmx", "GetHat_json", { HatKodu: "" });
        return JSON.parse(res.text || "[]").map((h) => ({
          kod: h.SHATKODU,
          ad: h.SHATADI,
          tarife: h.TARIFE,
          km: h.HAT_UZUNLUGU,
          dk: h.SEFER_SURESI,
        }));
      } catch (e) {
        const st = await fetchStaticJson("iett-hatlar.json");
        if (st && st.length) return st;
        throw e;
      }
    }),

  async hat(kod) {
    return (await iett.hatlar()).find((h) => h.kod === kod) || null;
  },

  konum: async (kod) => {
    try {
      const res = await soap("/FiloDurum/SeferGerceklesme.asmx", "GetHatOtoKonum_json", { HatKodu: kod });
      return JSON.parse(res.text || "[]")
        .map((b) => ({
          kapino: b.kapino,
          lat: +b.enlem,
          lon: +b.boylam,
          yon: (b.guzergahkodu || "").split("_")[1] || "",
          yonAdi: b.yon,
          zaman: b.son_konum_zamani,
          yakinDurak: b.yakinDurakKodu,
        }))
        .filter((b) => isFinite(b.lat) && isFinite(b.lon));
    } catch {
      return [];
    }
  },

  duraklar: (kod) =>
    cached("iett.durak." + kod, 7 * GUN, async () => {
      try {
        const res = await soap("/ibb/ibb.asmx", "DurakDetay_GYY", { hat_kodu: kod });
        const yon = {};
        if (res.node) {
          for (const t of res.node.getElementsByTagName("Table")) {
            const g = (x) => (t.getElementsByTagName(x)[0]?.textContent || "").trim();
            const d = {
              sira: +g("SIRANO"),
              kod: g("DURAKKODU"),
              ad: g("DURAKADI"),
              lat: +g("YKOORDINATI"),
              lon: +g("XKOORDINATI"),
            };
            if (!isFinite(d.lat) || !isFinite(d.lon)) continue;
            (yon[g("YON")] ||= []).push(d);
          }
        }
        Object.values(yon).forEach((l) => l.sort((a, b) => a.sira - b.sira));
        return yon;
      } catch (e) {
        const agData = await fetchStaticJson("iett-ag.json");
        const h = agData?.hatlar?.find((x) => x.kod === kod);
        if (h && agData.duraklar) {
          const yon = {};
          for (const [y, codes] of Object.entries(h.yon || {})) {
            yon[y] = codes
              .map((k, idx) => {
                const info = agData.duraklar[k];
                return info ? { sira: idx + 1, kod: k, ad: info[2], lat: info[0], lon: info[1] } : null;
              })
              .filter(Boolean);
          }
          if (Object.keys(yon).length) return yon;
        }
        throw e;
      }
    }),

  seferler: (kod) =>
    cached("iett.sefer." + kod, GUN, async () => {
      try {
        const res = await soap("/UlasimAnaVeri/PlanlananSeferSaati.asmx", "GetPlanlananSeferSaati_json", {
          HatKodu: kod,
        });
        const out = {};
        for (const s of JSON.parse(res.text || "[]")) {
          const y = s.SYON;
          const g = s.SGUNTIPI;
          if (!y || !g || !s.DT) continue;
          ((out[y] ||= {})[g] ||= []).push(s.DT);
        }
        for (const y of Object.values(out)) {
          for (const g of Object.keys(y)) {
            y[g] = [...new Set(y[g])].sort(Zaman.siraKarsilastir);
          }
        }
        return out;
      } catch {
        const pop = await fetchStaticJson("iett-sefer-populer.json");
        if (pop && pop[kod]) return pop[kod];
        // Query Transitous near the first stop of each direction, or synthesize daytime fallback
        try {
          const dr = await iett.duraklar(kod);
          const out = {};
          for (const [y, list] of Object.entries(dr || {})) {
            if (!list?.length) continue;
            const stops = await transitous.yakinDuraklar(list[0].lat, list[0].lon, 150).catch(() => []);
            const match = stops.find((s) => s.kod === list[0].kod) || stops[0];
            if (match) {
              const st = await transitous.durakSaatleri(match.stopId, 40).catch(() => []);
              const times = st
                .filter((x) => x.hat === kod && x.kalkisISO)
                .map((x) => {
                  const d = new Date(x.kalkisISO);
                  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
                });
              if (times.length) {
                const uniq = [...new Set(times)].sort(Zaman.siraKarsilastir);
                out[y] = { I: uniq, C: uniq, P: uniq };
              }
            }
          }
          if (Object.keys(out).length) return out;
        } catch {}
        return {};
      }
    }),

  duyurular: () =>
    cached("iett.duyurular", 3 * 60e3, async () => {
      try {
        const res = await soap("/UlasimDinamikVeri/Duyurular.asmx", "GetDuyurular_json", {});
        return JSON.parse(res.text || "[]").map((d) => ({
          hat: String(d.HATKODU || "").trim(),
          hatKod: String(d.HATKODU || "").trim(),
          hatAdi: String(d.HAT || "").trim(),
          tip: String(d.TIP || "Duyuru").trim(),
          saat: String(d.GUNCELLEME_SAATI || "").trim(),
          mesaj: String(d.MESAJ || "").trim(),
        }));
      } catch {
        return (await fetchStaticJson("iett-duyurular.json")) || [];
      }
    }),

  async hatDuyurulari(kod) {
    const all = await iett.duyurular();
    const k = String(kod || "").trim().toUpperCase();
    return all.filter((d) => d.hatKod.toUpperCase() === k);
  },
};

async function metroGet(p) {
  const j = JSON.parse(await http(METRO + p));
  if (!j.Success) throw new Error("Metro İstanbul: " + (j.Error?.Message || "hata"));
  return j.Data;
}

const metro = {
  hatlar: () =>
    cached("metro.hatlar", GUN, async () =>
      (await metroGet("GetLines"))
        .filter((l) => l.IsActive !== false)
        .map((l) => ({
          id: l.Id,
          ad: l.Name,
          uzun: (l.LongDescription || l.ShortDescription || "").trim(),
          sira: l.Order,
          renk: l.Color ? `rgb(${l.Color.Color_R},${l.Color.Color_G},${l.Color.Color_B})` : "#666",
          ilk: l.FirstTime,
          son: l.LastTime,
        }))
        .sort((a, b) => a.sira - b.sira)
    ),

  istasyonlar: () =>
    cached("metro.istasyonlar.2", GUN, async () =>
      (await metroGet("GetStations"))
        .map((s) => {
          const EK = { 253: [40.9792, 29.2445], 254: [40.9727, 29.2566], 255: [40.9655, 29.269] };
          let lat = +s.DetailInfo?.Latitude;
          let lon = +s.DetailInfo?.Longitude;
          if ((!lat || !lon) && EK[s.Id]) [lat, lon] = EK[s.Id];
          return {
            id: s.Id,
            ad: s.Description || s.Name,
            hatId: s.LineId,
            hat: s.LineName,
            sira: s.Order,
            lat,
            lon,
          };
        })
        .filter((s) => isFinite(s.lat) && isFinite(s.lon) && s.lat && s.lon)
    ),

  yonler: (hatId) =>
    cached("metro.yon." + hatId, GUN, async () =>
      (await metroGet("GetDirectionById/" + hatId)).map((d) => ({
        id: d.DirectionId,
        ad: d.DirectionName,
      }))
    ),

  async saatler(istId, hatId, yonId) {
    const j = JSON.parse(
      await http(METRO + "GetTimeTable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          BoardingStationId: istId,
          LineId: hatId,
          DirectionId: yonId,
          DateTime: Zaman.yerelISO(),
        }),
      })
    );
    if (!j.Success) throw new Error("Metro İstanbul: " + (j.Error?.Message || "hata"));
    const d = (j.Data || [])[0];
    return d ? { hedef: d.LastStation, saatler: d.TimeInfos?.Times || [] } : { hedef: "", saatler: [] };
  },

  durum: async () => {
    try {
      return (await metroGet("GetServiceStatuses"))
        .filter((s) => s.IsActive)
        .map((s) => ({ hatId: s.LineId, hat: s.LineName, metin: (s.Description || "").trim() }));
    } catch {
      return [];
    }
  },
};

const marmaray = {
  hatBilgi() {
    return {
      id: "MR",
      ad: "Marmaray",
      uzun: "Gebze – Halkalı Banliyö Hattı",
      renk: "#0ea5e9",
      ilk: "05:58",
      son: "00:00",
    };
  },

  async istasyonlar() {
    return MARMARAY_STATIONS.map(([ad, lat, lon, dk, aktarmalar], idx) => ({
      id: "mr:" + idx,
      idx,
      ad,
      lat,
      lon,
      hat: "Marmaray",
      hatId: "MR",
      sira: idx + 1,
      dk,
      aktarmalar,
    }));
  },

  saatler(istIdx, simdiDk = Zaman.simdi()) {
    const idx = Math.max(0, Math.min(MARMARAY_STATIONS.length - 1, Number(istIdx) || 0));
    const pendikIdx = 11;
    const atakoyIdx = 35;
    const toplam = MARMARAY_STATIONS[MARMARAY_STATIONS.length - 1][3];
    const istDk = MARMARAY_STATIONS[idx][3];
    const inner = idx >= pendikIdx && idx <= atakoyIdx;

    const genTimes = (dir) => {
      const out = [];
      const start = 360; // 06:00
      const end = 1438; // 23:58
      const step = inner ? 8 : 15;
      for (let dep = start; dep <= end; dep += step) {
        const isFull = (dep - start) % 15 === 0;
        if (!inner && !isFull) continue;
        let pass;
        if (dir === "halkali") {
          const originDk = isFull ? 0 : MARMARAY_STATIONS[pendikIdx][3];
          pass = dep + (istDk - originDk);
        } else {
          const originDk = isFull ? toplam : MARMARAY_STATIONS[atakoyIdx][3];
          pass = dep + (originDk - istDk);
        }
        if (pass >= simdiDk - 1 && pass <= simdiDk + 180) {
          out.push(Zaman.saatFormat(pass));
        }
      }
      return [...new Set(out)].slice(0, 12);
    };

    return [
      {
        hedef: idx === MARMARAY_STATIONS.length - 1 ? "Halkalı (Son Durak)" : "Halkalı Yönü",
        saatler: idx === MARMARAY_STATIONS.length - 1 ? [] : genTimes("halkali"),
      },
      {
        hedef: idx === 0 ? "Gebze (Son Durak)" : "Gebze Yönü",
        saatler: idx === 0 ? [] : genTimes("gebze"),
      },
    ];
  },

  aktifTrenler(simdiDk = Zaman.simdi()) {
    const seferler = [];
    const pendikIdx = 11;
    const atakoyIdx = 35;
    const fullStations = MARMARAY_STATIONS.map(([ad, lat, lon]) => ({ ad, lat, lon }));
    const fullT = MARMARAY_STATIONS.map((s) => s[3]);
    const innerStations = fullStations.slice(pendikIdx, atakoyIdx + 1);
    const innerT = fullT.slice(pendikIdx, atakoyIdx + 1).map((x) => x - fullT[pendikIdx]);

    const addTrips = (prefix, hedef, d, t, step, originStart, originEnd) => {
      const dur = t[t.length - 1];
      for (let dep = Math.max(originStart, Math.floor((simdiDk - dur) / step) * step); dep <= Math.min(originEnd, simdiDk + 15); dep += step) {
        if (simdiDk < dep || simdiDk > dep + dur) continue;
        seferler.push({
          key: `${prefix}@${dep}`,
          hat: "Marmaray",
          renk: "#0ea5e9",
          tur: "marmaray",
          hedef,
          d,
          t: t.map((x) => dep + x),
        });
      }
    };

    addTrips("MR-H", "Halkalı", fullStations, fullT, 15, 360, 1425);
    addTrips("MR-G", "Gebze", fullStations.slice().reverse(), fullT.slice().reverse().map((x) => fullT[fullT.length - 1] - x), 15, 360, 1425);
    addTrips("MR-A", "Ataköy", innerStations, innerT, 16, 368, 1400);
    addTrips("MR-P", "Pendik", innerStations.slice().reverse(), innerT.slice().reverse().map((x) => innerT[innerT.length - 1] - x), 16, 368, 1400);
    return seferler;
  },
};

const vapur = {
  hatlar: () =>
    cached("vapur.hatlar", GUN, async () => {
      try {
        const doc = new DOMParser().parseFromString(await http(VAPUR + "/tr/seferler"), "text/html");
        const seen = new Set();
        const out = [];
        for (const a of doc.querySelectorAll('a[href*="/seferler/ic-hatlar/"]')) {
          const href = a.getAttribute("href");
          const parca = href.split("/").filter(Boolean);
          if (parca.length < 5 || seen.has(href)) continue;
          seen.add(href);
          const grup =
            {
              "istanbul-ici-hatlar": "İstanbul İçi",
              "bogaz-hatlari": "Boğaz",
              "adalar-hatlari": "Adalar",
            }[parca[3]] || "Diğer";
          out.push({ ad: a.textContent.trim().replace(/\s+/g, " "), url: VAPUR + href, grup });
        }
        return out;
      } catch (e) {
        const st = await fetchStaticJson("vapur.json");
        if (st?.hatlar?.length) return st.hatlar;
        throw e;
      }
    }),

  tarife: (url) =>
    cached("vapur.t." + url, 6 * 36e5, async () => {
      try {
        const doc = new DOMParser().parseFromString(await http(url), "text/html");
        const tablolar = [];
        let baslik = "";
        for (const el of doc.querySelectorAll("h2, table")) {
          if (el.tagName === "H2") {
            baslik = el.textContent.trim().replace(/\s+/g, " ");
            continue;
          }
          const satirlar = [...el.querySelectorAll("tr")].map((tr) =>
            [...tr.children].map((c) => c.textContent.trim().replace(/\s+/g, " "))
          );
          if (!satirlar.length) continue;
          const ilkVeri = satirlar.findIndex((r) => r.some((c) => /^\d{1,2}[:.]\d{2}/.test(c)));
          if (ilkVeri < 0) continue;
          const ust = satirlar.slice(0, ilkVeri);
          const not = ust
            .filter((r) => r.length === 1)
            .map((r) => r[0])
            .join(" ");
          const basliklar = ust.filter((r) => r.length > 1);
          tablolar.push({ baslik, not, basliklar, satirlar: satirlar.slice(ilkVeri) });
        }
        return tablolar;
      } catch (e) {
        const st = await fetchStaticJson("vapur.json");
        if (st?.tarifeler?.[url]) return st.tarifeler[url];
        throw e;
      }
    }),

  async tumu() {
    const hatlar = await vapur.hatlar();
    const out = new Array(hatlar.length);
    let i = 0;
    async function isci() {
      while (i < hatlar.length) {
        const k = i++;
        try {
          out[k] = { ad: hatlar[k].ad, tablolar: await vapur.tarife(hatlar[k].url) };
        } catch {
          out[k] = null;
        }
      }
    }
    await Promise.all([isci(), isci(), isci(), isci()]);
    return out.filter(Boolean);
  },
};

const trafik = {
  geometri: (seviye) =>
    cached("trafik.geo." + seviye, 7 * GUN, async () => {
      const l = JSON.parse(await http(TKM + "TrafficData/v3/Segments/" + seviye));
      return l
        .map((s) => {
          let g;
          try {
            g = JSON.parse(s.G);
          } catch {
            return null;
          }
          const duz = [];
          let a = 90;
          let b = 180;
          let c = -90;
          let d = -180;
          for (const [la, lo] of g) {
            duz.push(Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5);
            if (la < a) a = la;
            if (lo < b) b = lo;
            if (la > c) c = la;
            if (lo > d) d = lo;
          }
          return [s.S, duz, a, b, c, d];
        })
        .filter(Boolean);
    }),

  async veri() {
    const m = mem.get("trafik.veri");
    if (m && Date.now() - m.t < 90e3) return m.d;
    const j = JSON.parse(await http(TKM + "TrafficData/v4/SegmentData"));
    const d = new Map((j.Data || []).map((x) => [x.S, [x.C, x.V]]));
    mem.set("trafik.veri", { t: Date.now(), d });
    return d;
  },

  async indeks() {
    try {
      return JSON.parse(await http(TKM + "TrafficData/v1/TrafficIndex_Sc1_Cont"));
    } catch {
      return null;
    }
  },
};

const iskeleler = () =>
  cached("iskeleler", 30 * GUN, async () =>
    JSON.parse(await http(TKM + "IntensityMap/v2/Piers"))
      .map((p) => ({ ad: p.NM, lat: +p.LT, lon: +p.LN, op: p.OP }))
      .filter((p) => p.lat && p.lon)
  );

const ispark = {
  liste: () =>
    cached("ispark.liste", 2 * 60e3, async () => {
      try {
        const l = JSON.parse(await http(ISPARK_URL));
        return (Array.isArray(l) ? l : [])
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
      } catch (e) {
        const st = await fetchStaticJson("ispark.json");
        if (st && st.length) return st;
        throw e;
      }
    }),

  async yakinlar(pt, maxM = 1500) {
    const list = await ispark.liste();
    const rad = (d) => (d * Math.PI) / 180;
    const dist = (a, b) => {
      const dLat = rad(b.lat - a.lat);
      const dLon = rad(b.lon - a.lon);
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
      return 2 * 6371000 * Math.asin(Math.sqrt(h));
    };
    return list
      .map((p) => ({ ...p, metre: dist(pt, p) }))
      .filter((p) => p.metre <= maxM)
      .sort((a, b) => a.metre - b.metre);
  },
};

const transitous = {
  async plan(a, b, zamanISO) {
    const u = `${TR}plan?fromPlace=${a.lat},${a.lon}&toPlace=${b.lat},${b.lon}&time=${encodeURIComponent(
      zamanISO
    )}&numItineraries=5&maxPreTransitTime=1200&maxPostTransitTime=1200`;
    const j = JSON.parse(await http(u));
    return j.itineraries || [];
  },

  async yerAra(metin, yakin) {
    const u =
      `${TR}geocode?text=${encodeURIComponent(metin)}&language=tr` +
      (yakin ? `&place=${yakin.lat},${yakin.lon}` : "&place=41.01,28.98");
    const l = JSON.parse(await http(u));
    return l
      .filter((x) => x.lat > 40.7 && x.lat < 41.4 && x.lon > 27.9 && x.lon < 29.95)
      .map((x) => ({
        ad: x.name,
        alt: x.type === "STOP" ? "Durak" : x.type === "ADDRESS" ? "Adres" : "Yer",
        lat: x.lat,
        lon: x.lon,
        tur: x.type === "STOP" ? "durak" : "yer",
      }));
  },

  async yakinDuraklar(lat, lon, yaricapM = 650) {
    const dLat = yaricapM / 111000;
    const dLon = yaricapM / (111000 * Math.cos((lat * Math.PI) / 180));
    const min = `${(lat - dLat).toFixed(5)},${(lon - dLon).toFixed(5)}`;
    const max = `${(lat + dLat).toFixed(5)},${(lon + dLon).toFixed(5)}`;
    const l = JSON.parse(await http(`${TR}map/stops?min=${min}&max=${max}`));
    const rad = (d) => (d * Math.PI) / 180;
    const dist = (aLat, aLon) => {
      const la = rad(aLat - lat);
      const lo = rad(aLon - lon);
      const h =
        Math.sin(la / 2) ** 2 +
        Math.cos(rad(lat)) * Math.cos(rad(aLat)) * Math.sin(lo / 2) ** 2;
      return 2 * 6371000 * Math.asin(Math.sqrt(h));
    };
    return (Array.isArray(l) ? l : [])
      .map((s) => ({
        stopId: s.stopId,
        kod: s.stopCode || "",
        ad: s.name,
        lat: s.lat,
        lon: s.lon,
        yonBilgi: (s.description || "").replace(/^direction:\s*/i, "").trim(),
        modlar: s.modes || [],
        metre: Math.round(dist(s.lat, s.lon)),
      }))
      .filter((s) => s.metre <= yaricapM)
      .sort((a, b) => a.metre - b.metre);
  },

  async durakSaatleri(stopId, adet = 12) {
    const j = JSON.parse(await http(`${TR}stoptimes?stopId=${encodeURIComponent(stopId)}&n=${adet}`));
    return (j.stopTimes || []).map((st) => ({
      hat: st.routeShortName || st.displayName || "",
      yon: st.headsign || st.tripTo?.name || "",
      kalkisISO: st.place?.departure || st.place?.scheduledDeparture || "",
      canli: !!st.realTime,
      mod: st.mode || "BUS",
    }));
  },
};

const ag = {
  async temel() {
    const [hatlar, istasyonlar, mb, isk] = await Promise.all([
      metro.hatlar(),
      metro.istasyonlar(),
      iett.duraklar("34G").catch(() => ({})),
      iskeleler().catch(() => []),
    ]);
    return { hatlar, istasyonlar, metrobus: mb, iskeleler: isk };
  },

  async otobus(ilerleme, zorla) {
    const ANAHTAR = "iett.ag.v1";
    if (!zorla) {
      const c = await KV.get(ANAHTAR, 7 * GUN);
      if (c && c.hatlar && c.hatlar.length > 100) return c;
      const st = await fetchStaticJson("iett-ag.json");
      if (st && st.hatlar && st.hatlar.length > 100) {
        KV.set(ANAHTAR, st);
        return st;
      }
    }
    const hatlar = await iett.hatlar();
    const ob = { duraklar: {}, hatlar: [], zaman: Date.now() };
    let i = 0;
    let bitti = 0;
    async function isci() {
      while (i < hatlar.length) {
        const h = hatlar[i++];
        try {
          const yonler = await iett.duraklar(h.kod);
          const yon = {};
          for (const [y, l] of Object.entries(yonler)) {
            yon[y] = l.map((d) => {
              ob.duraklar[d.kod] = [Math.round(d.lat * 1e5) / 1e5, Math.round(d.lon * 1e5) / 1e5, d.ad];
              return d.kod;
            });
          }
          if (Object.keys(yon).length) {
            ob.hatlar.push({ kod: h.kod, mb: /METROBÜS/i.test(h.tarife || ""), yon });
          }
        } catch {}
        bitti++;
        if (ilerleme && (bitti % 10 === 0 || bitti === hatlar.length)) {
          ilerleme(bitti, hatlar.length, ob);
        }
      }
    }
    await Promise.all(Array.from({ length: 6 }, isci));
    if (ob.hatlar.length > 100) KV.set(ANAHTAR, ob);
    return ob;
  },
};

export const API = { iett, metro, marmaray, vapur, trafik, iskeleler, ispark, transitous, ag, http };
