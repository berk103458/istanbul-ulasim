import { Core } from "./geo.js";
import { Zaman } from "./time.js";
import { MARMARAY_STATIONS } from "./api.js";

// ---- Rota planlayıcı v5: otobüs + metrobüs + metro/tramvay/füniküler/teleferik + Marmaray + vapur ----
export const Plan = (() => {
  const YURUME_M_DK = 80;
  const YURUME_SAPMA = 1.25;
  const ERISIM_M = 1200;
  const ERISIM_GENIS_M = 2500;
  const ERISIM_MAX_DURAK = 40;
  const AKTARMA_RAYLI_M = 600;
  const AKTARMA_OTOBUS_M = 350;
  const BINIS_CEZASI = 10;
  const TUR_HIZ = { metro: 34, tram: 16, fun: 12, tf: 10, vapur: 20 };
  const TUR_ARALIK = { metro: 6, tram: 6, fun: 5, tf: 4 };
  const TUR_ADI = {
    metro: "Metro",
    marmaray: "Marmaray",
    tram: "Tramvay",
    fun: "Füniküler",
    tf: "Teleferik",
    mb: "Metrobüs",
    vapur: "Vapur",
    otobus: "Otobüs",
    yuru: "Yürüme",
  };
  const HAT_TOPLAM = { M1A: 33, M1B: 22, M2: 29, M4: 46, M5: 43, M6: 6, M7: 32, M8: 24, T1: 60, T4: 42, T5: 34, F1: 2.5, F4: 2.5 };
  const HAT_RENK = {
    M1A: "#e11d48",
    M1B: "#e11d48",
    M2: "#16a34a",
    M3: "#0284c7",
    M4: "#db2777",
    M5: "#7e22ce",
    M6: "#b45309",
    M7: "#ec4899",
    M8: "#2563eb",
    M9: "#ca8a04",
    M11: "#9333ea",
    Marmaray: "#0ea5e9",
    Metrobüs: "#ea580c",
    Vapur: "#0d9488",
  };
  const MARMARAY = MARMARAY_STATIONS;
  const MARMARAY_RENK = "#0ea5e9";
  const METROBUS_RENK = "#ea580c";

  const yurume = (m) => (m * YURUME_SAPMA) / YURUME_M_DK;
  const yurumeMaliyet = (w) =>
    w <= 3 ? w * 1.2 : w <= 8 ? 3.6 + (w - 3) * 2.2 : 14.6 + (w - 8) * 3.5;

  const norm = (s) =>
    String(s || "")
      .toLocaleLowerCase("tr")
      .replace(/\(.*?\)/g, "")
      .replace(/iskelesi|i̇do|\bido\b|terminali|\(eski\)/g, "")
      .replace(/[^a-zçğıöşü0-9]/g, "");

  const ISKELE_TAKMA = { eyupsultan: "eyüp", ahisari: "anadoluhisarı", ahisarı: "anadoluhisarı" };
  const EK_ISKELE = [
    { ad: "Hasköy", lat: 41.0399, lon: 28.9493 },
    { ad: "Aşiyan", lat: 41.0818, lon: 29.0546 },
    { ad: "Küçüksu", lat: 41.0786, lon: 29.0661 },
    { ad: "Sedef Adası", lat: 40.8516, lon: 29.1414 },
  ];

  const bas = (s) =>
    String(s || "")
      .toLocaleLowerCase("tr")
      .replace(/(^|[\s/(.\-])(\S)/g, (m, a, b) => a + b.toLocaleUpperCase("tr"))
      .replace(/\s*Hattı$/i, "")
      .trim();

  function turOf(hatAd) {
    if (/^TF/.test(hatAd)) return "tf";
    if (/^T\d/.test(hatAd)) return "tram";
    if (/^F\d/.test(hatAd)) return "fun";
    return "metro";
  }

  function otobusHiz(dk, gun) {
    const s = (((dk % 1440) + 1440) % 1440) / 60;
    const hi = gun >= 1 && gun <= 5;
    if (s >= 23 || s < 6) return { sehir: 24, yol: 60 };
    if (hi && ((s >= 7 && s < 10) || (s >= 17 && s < 20))) return { sehir: 15, yol: 32 };
    if (s >= 21) return { sehir: 21, yol: 52 };
    return { sehir: 18, yol: 42 };
  }

  function calismaSaatleri(ilk, son) {
    const a = Zaman.dk(ilk);
    const b = Zaman.dk(son);
    if (a == null || b == null) return null;
    const ia = a >= 1440 ? a - 1440 : a;
    return [ia, b <= ia ? b + 1440 : b];
  }

  function bekleHesap(p, i, t, opt) {
    const ozel = opt && opt.bekleme ? opt.bekleme(p, i, t) : undefined;
    if (ozel !== undefined) return ozel;
    const ort = p.aralik / 2;
    if (!p.saatler) return ort;
    const [ilk, son] = p.saatler;
    const bas0 = t - p.t[i];
    for (const g of [-1440, 0, 1440]) {
      if (bas0 >= ilk + g && bas0 <= son + g) return ort;
    }
    let en = Infinity;
    for (const g of [0, 1440, 2880]) {
      const v = ilk + g + p.t[i];
      if (v >= t && v < en) en = v;
    }
    return en - t;
  }

  function otobusAralik(dk) {
    const s = (((dk % 1440) + 1440) % 1440) / 60;
    return s >= 23 || s < 6 ? 25 : s >= 21 ? 18 : 12;
  }

  function bugunYapilmayanIsaretler(not, gun = new Date().getDay()) {
    const out = new Set();
    const re = /(\*+)\s*([^*]+)/g;
    let m;
    while ((m = re.exec(not || ""))) {
      const t = m[2].toLocaleUpperCase("tr");
      if (!/YAPILMAZ/.test(t)) continue;
      if ((gun === 6 && /C\.?TES|CUMARTES/.test(t)) || (gun === 0 && /PAZAR/.test(t))) out.add(m[1]);
    }
    return out;
  }

  function tabloGunUygun(not, gun = new Date().getDay()) {
    const t = (not || "").toLocaleUpperCase("tr");
    const hi = /HAFTA ?İÇİ/.test(t);
    const ct = /CUMARTES|C\.?TES/.test(t);
    const pz = /PAZAR/.test(t);
    if (/YAPILMAZ/.test(t) || (!hi && !ct && !pz) || /HER GÜN/.test(t)) return true;
    return (gun >= 1 && gun <= 5 && hi) || (gun === 6 && ct) || (gun === 0 && pz);
  }

  const satirYok = (r, yok) =>
    r.some((c) => {
      const m = /\d(\*+)\s*$/.exec(String(c).replace(/\s+/g, ""));
      return m && yok.has(m[1]);
    });

  const dizi = (deger) => Array.isArray(deger) ? deger : [];

  function kur(g) {
    g ??= {};
    const duraklar = [];
    const idx = new Map();
    const desenler = [];
    const seferler = [];
    const ekle = (key, o) => {
      if (idx.has(key)) return idx.get(key);
      const i = duraklar.length;
      duraklar.push({ ...o, key });
      idx.set(key, i);
      return i;
    };
    const gun = Number.isFinite(g.gun) ? g.gun : new Date().getDay();
    const saat = Number.isFinite(g.saat) ? g.saat : Zaman.simdi();

    // Raylı sistem
    const hatById = new Map();
    for (const h of dizi(g.hatlar)) {
      if (h?.id != null && typeof h.ad === "string" && h.ad.trim()) hatById.set(h.id, h);
    }
    const hatIst = new Map();
    for (const s of dizi(g.istasyonlar)) {
      if (!Core.gecerliKonum(s) || s.id == null || !hatById.has(s.hatId)) continue;
      (hatIst.get(s.hatId) || hatIst.set(s.hatId, []).get(s.hatId)).push(s);
    }
    for (const [hatId, liste] of hatIst) {
      const h = hatById.get(hatId);
      liste.sort((a, b) => a.sira - b.sira);
      const tur = turOf(h.ad);
      const di = liste.map((s) =>
        ekle("m:" + s.id, { ad: s.ad, lat: s.lat, lon: s.lon, tur, hat: h.ad, istId: s.id, hatId, kod: s.kod })
      );
      const sure = (a, b) =>
        Math.max(
          tur === "tf" ? 4 : 1.5,
          (Core.mesafe(a, b) / 1000 / TUR_HIZ[tur]) * 60 + (tur === "metro" ? 0.5 : 0.3)
        );
      const yap = (sira, yon, dIdx) => {
        let t = [0];
        for (let k = 1; k < sira.length; k++) t.push(t[k - 1] + sure(sira[k - 1], sira[k]));
        const resmi = HAT_TOPLAM[h.ad];
        if (resmi && t[t.length - 1] > 0) {
          const k = resmi / t[t.length - 1];
          t = t.map((x) => x * k);
        }
        desenler.push({
          id: `${h.ad}:${yon}`,
          hat: h.ad,
          hatId,
          renk: h.renk,
          tur,
          d: dIdx,
          t,
          aralik: TUR_ARALIK[tur],
          ad: sira[sira.length - 1].ad,
          saatler: calismaSaatleri(h.ilk, h.son),
        });
      };
      yap(liste, "i", di);
      if (hatId !== 12) yap(liste.slice().reverse(), "g", di.slice().reverse());
    }

    // Marmaray
    if (g.marmaray !== false && (Array.isArray(g.hatlar) || Array.isArray(g.otobus?.hatlar))) {
      const di = MARMARAY.map(([ad, lat, lon]) =>
        ekle("r:" + ad, { ad, lat, lon, tur: "marmaray", hat: "Marmaray" })
      );
      const t = MARMARAY.map((x) => x[3]);
      const yap = (b, s, aralik, ek) => {
        const d = di.slice(b, s + 1);
        const tt = t.slice(b, s + 1).map((x) => x - t[b]);
        const top = tt[tt.length - 1];
        desenler.push({
          id: "MR:i" + ek,
          hat: "Marmaray",
          renk: MARMARAY_RENK,
          tur: "marmaray",
          d,
          t: tt,
          aralik,
          ad: MARMARAY[s][0],
          saatler: [355, 1440],
        });
        desenler.push({
          id: "MR:g" + ek,
          hat: "Marmaray",
          renk: MARMARAY_RENK,
          tur: "marmaray",
          d: d.slice().reverse(),
          t: tt.slice().reverse().map((x) => top - x),
          aralik,
          ad: MARMARAY[b][0],
          saatler: [355, 1440],
        });
      };
      yap(0, MARMARAY.length - 1, 15, "");
      yap(
        MARMARAY.findIndex((x) => x[0] === "Pendik"),
        MARMARAY.findIndex((x) => x[0] === "Ataköy"),
        8,
        "k"
      );
    }

    // İETT otobüs + metrobüs
    const ob = g.otobus;
    const otobusHatlari = dizi(ob?.hatlar).filter((h) => h?.kod != null && h.kod !== "");
    if (otobusHatlari.length) {
      const hiz = otobusHiz(saat, gun);
      const durakIdx = (kod) => {
        const d = ob.duraklar?.[kod];
        if (!Array.isArray(d) || !Number.isFinite(d[0]) || !Number.isFinite(d[1])) return -1;
        return ekle("b:" + kod, { ad: bas(d[2]), lat: d[0], lon: d[1], tur: "otobus", kod });
      };
      for (const h of otobusHatlari) {
        const mb = !!h.mb;
        for (const [yon, kodlar] of Object.entries(h.yon || {})) {
          const di = dizi(kodlar).map(durakIdx).filter((x) => x >= 0);
          if (di.length < 2) continue;
          const t = [0];
          for (let k = 1; k < di.length; k++) {
            const m = Core.mesafe(duraklar[di[k - 1]], duraklar[di[k]]) * 1.15;
            const sehir = mb ? 32 : hiz.sehir;
            const yol = mb ? 50 : hiz.yol;
            const dk =
              (Math.min(m, 900) / 1000 / sehir + Math.max(0, m - 900) / 1000 / yol) * 60 +
              (mb ? 0.5 : 0.35);
            t.push(t[k - 1] + dk);
          }
          if (mb) di.forEach((i) => { duraklar[i].tur = "mb"; });
          desenler.push({
            id: `${h.kod}:${yon}`,
            hat: h.kod,
            tur: mb ? "mb" : "otobus",
            renk: mb ? METROBUS_RENK : null,
            d: di,
            t,
            aralik: Number.isFinite(h.aralik) && h.aralik > 0 ? h.aralik : (mb ? 3 : otobusAralik(saat)),
            ad: duraklar[di[di.length - 1]].ad,
            iett: true,
            yon,
          });
        }
      }
    } else if (g.metrobus) {
      for (const [yon, durakListesi] of Object.entries(g.metrobus)) {
        const l = dizi(durakListesi).filter((d) => Core.gecerliKonum(d) && d.kod != null && d.kod !== "");
        if (l.length < 2) continue;
        const di = l.map((d) =>
          ekle("b:" + d.kod, { ad: bas(d.ad), lat: d.lat, lon: d.lon, tur: "mb", kod: d.kod })
        );
        const t = [0];
        for (let k = 1; k < l.length; k++) {
          t.push(t[k - 1] + Math.max(1.5, (Core.mesafe(l[k - 1], l[k]) / 1000 / 30) * 60 + 0.5));
        }
        desenler.push({
          id: "MB:" + yon,
          hat: "Metrobüs",
          renk: METROBUS_RENK,
          tur: "mb",
          d: di,
          t,
          aralik: 3,
          ad: bas(l[l.length - 1].ad),
        });
      }
    }

    // Vapur
    const iskeleBul = new Map();
    for (const p of dizi(g.iskeleler).concat(EK_ISKELE)) {
      if (!Core.gecerliKonum(p) || typeof p.ad !== "string") continue;
      const n = norm(p.ad);
      if (n && !iskeleBul.has(n)) iskeleBul.set(n, p);
    }
    const iskele = (ad) => {
      let n = norm(ad);
      n = ISKELE_TAKMA[n] || n;
      if (!n) return -1;
      const p =
        iskeleBul.get(n) ||
        [...iskeleBul.entries()].find(([k]) => k.startsWith(n) || n.startsWith(k))?.[1];
      if (!p) return -1;
      return ekle("v:" + norm(p.ad), {
        ad: p.ad.replace(/^İDO\s+/, "").replace(/\s*(Terminali|iskelesi)$/i, ""),
        lat: p.lat,
        lon: p.lon,
        tur: "vapur",
        hat: "Vapur",
      });
    };
    let sId = 0;
    for (const vh of dizi(g.vapur)) {
      if (typeof vh?.ad !== "string" || !vh.ad.trim()) continue;
      const uclar = vh.ad
        .split(/\s+-\s+|-/)
        .map((x) => x.replace(/HATTI$/i, "").trim())
        .filter(Boolean);
      for (const tb of dizi(vh.tablolar)) {
        if (!Array.isArray(tb?.satirlar)) continue;
        const not = typeof tb.not === "string" ? tb.not : "";
        if (!tabloGunUygun(not, gun)) continue;
        const yok = bugunYapilmayanIsaretler(not, gun);
        const sutun = dizi(tb.basliklar).find(
          (r) => Array.isArray(r) && r.length > 1 && !r.every((c) => /Kalkış|Varış/i.test(c))
        );
        let sutunIdx;
        if (sutun) sutunIdx = sutun.map(iskele);
        else {
          const b0 = typeof tb.baslik === "string" ? tb.baslik.split("|")[0].trim() : "";
          if (!b0) continue;
          const diger = uclar.find((u) => norm(u) !== norm(b0)) || "";
          sutunIdx = [iskele(b0), iskele(diger)];
        }
        if (sutunIdx.filter((x) => x >= 0).length < 2) continue;
        for (const r of tb.satirlar) {
          if (!Array.isArray(r) || satirYok(r, yok)) continue;
          const d = [];
          const t = [];
          if (!sutun) {
            const k = Zaman.dk(r[0]);
            if (k == null) continue;
            const a = duraklar[sutunIdx[0]];
            const b = duraklar[sutunIdx[1]];
            d.push(sutunIdx[0], sutunIdx[1]);
            t.push(k, k + 2 + (Core.mesafe(a, b) / 1000 / TUR_HIZ.vapur) * 60);
          } else {
            r.forEach((c, i) => {
              const k = Zaman.dk(c);
              if (k != null && sutunIdx[i] >= 0) {
                if (t.length && k < t[t.length - 1]) return;
                d.push(sutunIdx[i]);
                t.push(k);
              }
            });
          }
          if (d.length >= 2) seferler.push({ id: ++sId, hat: bas(vh.ad), d, t, grup: vh.ad + "|" + tb.baslik });
        }
      }
    }

    // Dizinler
    const N = duraklar.length;
    const desenDurak = Array.from({ length: N }, () => []);
    const ofset = new Int32Array(desenler.length + 1);
    desenler.forEach((p, pi) => {
      ofset[pi + 1] = ofset[pi] + p.d.length;
      p.d.forEach((s, i) => desenDurak[s].push(pi, i));
    });
    const seferDurak = Array.from({ length: N }, () => []);
    seferler.forEach((s, si) => s.d.forEach((d, i) => seferDurak[d].push([si, i])));
    for (const l of seferDurak) l.sort((a, b) => seferler[a[0]].t[a[1]] - seferler[b[0]].t[b[1]]);

    const G = 0.006;
    const izg = new Map();
    const hk = (a, b) => a + ":" + b;
    duraklar.forEach((d, i) => {
      const k = hk(Math.floor(d.lat / G), Math.floor(d.lon / G));
      (izg.get(k) || izg.set(k, []).get(k)).push(i);
    });
    const yakin = new Array(N);
    for (let i = 0; i < N; i++) {
      const d = duraklar[i];
      const a = Math.floor(d.lat / G);
      const b = Math.floor(d.lon / G);
      const out = [];
      const rayliMi = d.tur !== "otobus";
      for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
          for (const j of izg.get(hk(a + x, b + y)) || []) {
            if (j === i) continue;
            const sinir = rayliMi || duraklar[j].tur !== "otobus" ? AKTARMA_RAYLI_M : AKTARMA_OTOBUS_M;
            const m = Core.mesafe(d, duraklar[j]);
            if (m <= sinir) out.push(j, m);
          }
        }
      }
      yakin[i] = out;
    }

    return {
      duraklar,
      desenler,
      seferler,
      desenDurak,
      seferDurak,
      yakin,
      ofset,
      izg,
      G,
      hk,
      otobusHatSayisi: otobusHatlari.length,
    };
  }

  function yakinDuraklar(ag, p, maxM, adet) {
    const out = [];
    const r = Math.ceil(maxM / 500) + 1;
    const a = Math.floor(p.lat / ag.G);
    const b = Math.floor(p.lon / ag.G);
    for (let x = -r; x <= r; x++) {
      for (let y = -r; y <= r; y++) {
        for (const i of ag.izg.get(ag.hk(a + x, b + y)) || []) {
          const m = Core.mesafe(p, ag.duraklar[i]);
          if (m <= maxM) out.push([i, m]);
        }
      }
    }
    out.sort((x, y) => x[1] - y[1]);
    const sec = out.slice(0, adet);
    for (const e of out.slice(adet)) {
      if (ag.duraklar[e[0]].tur !== "otobus" && sec.length < adet + 10) sec.push(e);
    }
    return sec;
  }

  function durakKumesi(ag, p) {
    if (!p || !p.durak) return null;
    if (p.kod) {
      const i = ag.duraklar.findIndex((d) => d.kod === p.kod);
      if (i >= 0) return [[i, 0]];
    }
    const n = norm(p.ad);
    const l = yakinDuraklar(ag, p, 250, 20).filter(
      ([i, m]) =>
        m <= 60 ||
        ((norm(ag.duraklar[i].ad) === n ||
          n.includes(norm(ag.duraklar[i].ad)) ||
          norm(ag.duraklar[i].ad).includes(n)) &&
          m <= 250)
    );
    return l.length ? l : null;
  }

  function direkler(ag, nereden, nereye, t0, opt = {}) {
    const bas0 = durakKumesi(ag, nereden) || yakinDuraklar(ag, nereden, 900, 60);
    const hedefKume = durakKumesi(ag, nereye);
    const son = hedefKume || yakinDuraklar(ag, nereye, 900, 60);
    const sonMap = new Map(son.map(([i, m]) => [i, hedefKume ? 0 : m]));
    const enIyi = new Map();
    for (const [s, m0] of bas0) {
      const w0 = nereden.durak && m0 <= 250 ? 0 : yurume(m0);
      const dd = ag.desenDurak[s];
      for (let q = 0; q < dd.length; q += 2) {
        const pi = dd[q];
        const i = dd[q + 1];
        const p = ag.desenler[pi];
        if (opt.yasakHat?.has(p.hat)) continue;
        const tb = t0 + w0;
        const bek = bekleHesap(p, i, tb, opt);
        if (bek == null || !isFinite(bek)) continue;
        for (let j = i + 1; j < p.d.length; j++) {
          if (!sonMap.has(p.d[j])) continue;
          const m1 = sonMap.get(p.d[j]);
          const w1 = yurume(m1);
          const varis = tb + bek + p.t[j] - p.t[i] + w1;
          const maliyet = varis - t0 + yurumeMaliyet(w0) - w0 + yurumeMaliyet(w1) - w1;
          const k = p.hat + "|" + (p.yon || p.id);
          const e = enIyi.get(k);
          if (!e || maliyet < e.maliyet) {
            enIyi.set(k, {
              maliyet,
              bacaklar: [
                { tur: "yuru", m: m0, kalkis: t0, varis: tb, from: nereden, to: ag.duraklar[s] },
                {
                  tur: p.tur,
                  desen: pi,
                  hat: p.hat,
                  renk: p.renk,
                  yonAd: p.ad,
                  i,
                  j,
                  bekleme: bek,
                  kalkis: tb + bek,
                  varis: tb + bek + p.t[j] - p.t[i],
                  from: ag.duraklar[s],
                  to: ag.duraklar[p.d[j]],
                  iett: !!p.iett,
                  yon: p.yon,
                },
                { tur: "yuru", m: m1, kalkis: varis - w1, varis, from: ag.duraklar[p.d[j]], to: nereye },
              ],
            });
          }
          break;
        }
      }
    }
    return [...enIyi.values()]
      .sort((x, y) => x.maliyet - y.maliyet)
      .slice(0, 6)
      .map((e) => {
        const r = duzenle({ bacaklar: e.bacaklar.filter((b) => b.tur !== "yuru" || b.m > 1) }, t0, ag);
        r.direkt = true;
        return r;
      });
  }

  /**
   * Zero-allocation binary min-heap backed by TypedArrays for A* search.
   */
  class TypedHeap {
    constructor(initialCap = 4096) {
      this.cap = initialCap;
      this.size = 0;
      this.nodes = new Int32Array(initialCap);
      this.fCosts = new Float64Array(initialCap);
      this.gCosts = new Float64Array(initialCap);
    }

    get bos() {
      return this.size === 0;
    }

    _grow() {
      const nextCap = this.cap * 2;
      const n = new Int32Array(nextCap);
      const f = new Float64Array(nextCap);
      const g = new Float64Array(nextCap);
      n.set(this.nodes);
      f.set(this.fCosts);
      g.set(this.gCosts);
      this.nodes = n;
      this.fCosts = f;
      this.gCosts = g;
      this.cap = nextCap;
    }

    ekle(node, fCost, gCost) {
      if (this.size === this.cap) this._grow();
      let i = this.size++;
      const nodes = this.nodes;
      const fCosts = this.fCosts;
      const gCosts = this.gCosts;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (fCosts[p] <= fCost) break;
        nodes[i] = nodes[p];
        fCosts[i] = fCosts[p];
        gCosts[i] = gCosts[p];
        i = p;
      }
      nodes[i] = node;
      fCosts[i] = fCost;
      gCosts[i] = gCost;
    }

    al() {
      const nodes = this.nodes;
      const fCosts = this.fCosts;
      const gCosts = this.gCosts;
      const topNode = nodes[0];
      const topF = fCosts[0];
      const topG = gCosts[0];
      const last = --this.size;
      if (last > 0) {
        const lNode = nodes[last];
        const lF = fCosts[last];
        const lG = gCosts[last];
        let i = 0;
        const half = last >> 1;
        while (i < half) {
          let l = (i << 1) + 1;
          const r = l + 1;
          if (r < last && fCosts[r] < fCosts[l]) l = r;
          if (lF <= fCosts[l]) break;
          nodes[i] = nodes[l];
          fCosts[i] = fCosts[l];
          gCosts[i] = gCosts[l];
          i = l;
        }
        nodes[i] = lNode;
        fCosts[i] = lF;
        gCosts[i] = lG;
      }
      return { u: topNode, f: topF, c: topG };
    }
  }

  function ara(ag, nereden, nereye, t0, opt = {}) {
    const N = ag.duraklar.length;
    const M = N + ag.ofset[ag.desenler.length];
    const en = new Float64Array(M).fill(Infinity);
    const zaman = new Float64Array(M);
    const onceki = new Int32Array(N).fill(-2);
    const bacak = new Array(N);
    const binisBilgi = new Array(M - N);
    const yasak = opt.yasakHat || new Set();
    const Q = new TypedHeap(Math.max(4096, Math.min(M, 32768)));

    // Admissible lower-bound A* heuristic (1150 m/min ~ 69 km/h)
    const hCache = new Float64Array(N).fill(-1);
    const hStop = (s) => {
      let v = hCache[s];
      if (v < 0) {
        v = Core.mesafe(ag.duraklar[s], nereye) / 1150;
        hCache[s] = v;
      }
      return v;
    };

    const dm = Core.mesafe(nereden, nereye);
    const hedefKume = durakKumesi(ag, nereye);
    let hedefAday = (hedefKume || []).map(([i]) => [i, 0]);
    if (!hedefAday.length) hedefAday = yakinDuraklar(ag, nereye, ERISIM_M, ERISIM_MAX_DURAK);
    if (!hedefAday.length) hedefAday = yakinDuraklar(ag, nereye, ERISIM_GENIS_M, ERISIM_MAX_DURAK);
    const exitWalkCost = new Map(hedefAday.map(([i, m]) => [i, hedefKume ? 0 : yurumeMaliyet(yurume(m))]));
    let goalBestCost = dm <= 3500 ? yurumeMaliyet(yurume(dm)) : Infinity;

    const durakIt = (s, t, c, b, pr) => {
      if (c < en[s] - 1e-9) {
        en[s] = c;
        zaman[s] = t;
        bacak[s] = b;
        onceki[s] = pr;
        Q.ekle(s, c + hStop(s), c);
        if (exitWalkCost.has(s) && !(b.tur === "yuru" && pr === -1)) {
          const total = c + exitWalkCost.get(s);
          if (total < goalBestCost) goalBestCost = total;
        }
      }
    };
    const aracIt = (k, t, c, bilgi, stopIdx) => {
      const u = N + k;
      if (c < en[u] - 1e-9) {
        en[u] = c;
        zaman[u] = t;
        binisBilgi[k] = bilgi;
        Q.ekle(u, c + hStop(stopIdx), c);
      }
    };

    const basKume = durakKumesi(ag, nereden);
    let erisim = basKume || yakinDuraklar(ag, nereden, ERISIM_M, ERISIM_MAX_DURAK);
    if (!erisim.length) erisim = yakinDuraklar(ag, nereden, ERISIM_GENIS_M, ERISIM_MAX_DURAK);
    for (const [s, m] of erisim) {
      const w = yurume(m);
      durakIt(s, t0 + w, yurumeMaliyet(w), { tur: "yuru", m, kalkis: t0, varis: t0 + w, from: nereden, to: ag.duraklar[s] }, -1);
    }
    for (const tk of opt.tohumlar || []) {
      durakIt(tk.durak, tk.t, tk.t - t0 + BINIS_CEZASI, { tur: "dis", bacaklar: tk.bacaklar, kalkis: t0, varis: tk.t }, -1);
    }

    const bitti = new Uint8Array(M);
    while (!Q.bos) {
      const { u, f: poppedF, c } = Q.al();
      if (goalBestCost < Infinity && poppedF > goalBestCost + 15) break;
      if (bitti[u] || c > en[u] + 1e-9) continue;
      bitti[u] = 1;
      const t = zaman[u];
      if (u >= N) {
        const k = u - N;
        let lo = 0;
        let hi = ag.desenler.length;
        while (lo < hi) {
          const m = (lo + hi) >> 1;
          if (ag.ofset[m + 1] <= k) lo = m + 1;
          else hi = m;
        }
        const pi = lo;
        const p = ag.desenler[pi];
        const i = k - ag.ofset[pi];
        const bi = binisBilgi[k];
        if (i + 1 < p.d.length) {
          aracIt(k + 1, t + p.t[i + 1] - p.t[i], c + p.t[i + 1] - p.t[i], bi, p.d[i + 1]);
        }
        if (i > bi.i0) {
          const s = p.d[i];
          durakIt(
            s,
            t,
            c,
            {
              tur: p.tur,
              desen: pi,
              hat: p.hat,
              renk: p.renk,
              yonAd: p.ad,
              i: bi.i0,
              j: i,
              bekleme: bi.bekle,
              kalkis: bi.kalk,
              varis: t,
              from: ag.duraklar[bi.s0],
              to: ag.duraklar[s],
              iett: !!p.iett,
              yon: p.yon,
            },
            bi.s0
          );
        }
        continue;
      }

      const s = u;
      const gelen = bacak[s];
      if (gelen.tur !== "yuru") {
        const y = ag.yakin[s];
        for (let q = 0; q < y.length; q += 2) {
          const j = y[q];
          const m = y[q + 1];
          const w = yurume(m) + 1;
          durakIt(j, t + w, c + yurumeMaliyet(w), { tur: "yuru", m, kalkis: t, varis: t + w, from: ag.duraklar[s], to: ag.duraklar[j] }, s);
        }
      }

      const dd = ag.desenDurak[s];
      for (let q = 0; q < dd.length; q += 2) {
        const pi = dd[q];
        const i = dd[q + 1];
        const p = ag.desenler[pi];
        if (i === p.d.length - 1 || yasak.has(p.hat)) continue;
        if (gelen.desen === pi || (gelen.hat === p.hat && gelen.tur !== "yuru")) continue;
        const bekle = bekleHesap(p, i, t, opt);
        if (bekle == null || !isFinite(bekle)) continue;
        aracIt(ag.ofset[pi] + i, t + bekle, c + bekle + BINIS_CEZASI, { s0: s, i0: i, kalk: t + bekle, bekle }, p.d[i]);
      }

      const gor = new Set();
      for (const [si, i] of ag.seferDurak[s]) {
        const sf = ag.seferler[si];
        if (sf.t[i] < t + 1 || i === sf.d.length - 1 || gor.has(sf.grup) || yasak.has("Vapur")) continue;
        gor.add(sf.grup);
        for (let j = i + 1; j < sf.d.length; j++) {
          const v = sf.t[j];
          durakIt(
            sf.d[j],
            v,
            c + (v - t) + BINIS_CEZASI,
            {
              tur: "vapur",
              sefer: si,
              hat: sf.hat,
              renk: "#0d9488",
              i,
              j,
              bekleme: sf.t[i] - t,
              kalkis: sf.t[i],
              varis: v,
              from: ag.duraklar[s],
              to: ag.duraklar[sf.d[j]],
            },
            s
          );
        }
      }
    }

    const zincir = (s) => {
      const l = [];
      while (s >= 0) {
        l.unshift(bacak[s]);
        s = onceki[s];
      }
      return l;
    };

    let enIyi = null;
    if (dm <= 3500) {
      const w = yurume(dm);
      enIyi = { c: yurumeMaliyet(w), bacaklar: [{ tur: "yuru", m: dm, kalkis: t0, varis: t0 + w, from: nereden, to: nereye }] };
    }
    let cikis = (hedefKume || []).filter(([i]) => en[i] < Infinity).map(([i]) => [i, 0]);
    if (!cikis.length) cikis = yakinDuraklar(ag, nereye, ERISIM_M, ERISIM_MAX_DURAK).filter(([i]) => en[i] < Infinity);
    if (!cikis.length) cikis = yakinDuraklar(ag, nereye, ERISIM_GENIS_M, ERISIM_MAX_DURAK).filter(([i]) => en[i] < Infinity);

    for (const [s, m] of cikis) {
      if (bacak[s].tur === "yuru" && onceki[s] === -1) continue;
      const w = yurume(m);
      const c = en[s] + yurumeMaliyet(w);
      if (!enIyi || c < enIyi.c) {
        enIyi = {
          c,
          bacaklar: zincir(s).concat([
            { tur: "yuru", m, kalkis: zaman[s], varis: zaman[s] + w, from: ag.duraklar[s], to: nereye },
          ]),
        };
      }
    }

    return { enIyi: enIyi && duzenle(enIyi, t0, ag), etiketler: { en, zaman, zincir } };
  }

  function duzenle(r, t0, ag) {
    const l = [];
    for (const b of r.bacaklar) {
      if (b.tur === "dis") {
        l.push(...b.bacaklar);
        continue;
      }
      const son = l[l.length - 1];
      if (b.tur === "yuru" && son && son.tur === "yuru") {
        son.m += b.m;
        son.varis = b.varis;
        son.to = b.to;
        continue;
      }
      l.push({ ...b });
    }
    for (const b of l) {
      if (b.desen != null && ag && b.tur !== "vapur") {
        const p = ag.desenler[b.desen];
        b.yol = p.d.slice(b.i, b.j + 1).map((k) => [ag.duraklar[k].lat, ag.duraklar[k].lon]);
        b.durakAdlari = p.d.slice(b.i, b.j + 1).map((k) => ag.duraklar[k].ad);
        b.durakSayisi = b.j - b.i;
        b.durakKodlari = p.iett ? p.d.slice(b.i, b.j + 1).map((k) => ag.duraklar[k].kod) : null;
      } else if (b.sefer != null && ag) {
        const s = ag.seferler[b.sefer];
        b.yol = s.d.slice(b.i, b.j + 1).map((k) => [ag.duraklar[k].lat, ag.duraklar[k].lon]);
        b.durakAdlari = s.d.slice(b.i, b.j + 1).map((k) => ag.duraklar[k].ad);
        b.durakSayisi = b.j - b.i;
      } else if (!b.yol && b.from && b.to) {
        b.yol = [
          [b.from.lat, b.from.lon],
          [b.to.lat, b.to.lon],
        ];
      }
    }
    const varis = l.length ? l[l.length - 1].varis : t0;
    return {
      bacaklar: l,
      kalkis: t0,
      varis,
      sure: varis - t0,
      yurumeM: l.filter((b) => b.tur === "yuru").reduce((a, b) => a + b.m, 0),
      aktarma: Math.max(0, l.filter((b) => b.tur !== "yuru").length - 1),
      imza: l.filter((b) => b.tur !== "yuru").map((b) => b.hat).join(">") || "yuru",
    };
  }

  function alternatifler(ag, nereden, nereye, t0, opt = {}, adet = 4) {
    const sonuc = [];
    const ilk = ara(ag, nereden, nereye, t0, opt);
    if (!ilk.enIyi) return { sonuc, etiketler: ilk.etiketler };
    sonuc.push(ilk.enIyi);

    const taban = [...(opt.yasakHat || [])];
    const denenen = new Set();
    const kuyruk = [];
    const ekle = (hatlar) => {
      const k = [...new Set(hatlar)].sort().join("|");
      if (!k || denenen.has(k)) return;
      denenen.add(k);
      kuyruk.push([...new Set(hatlar)]);
    };
    const binisler = (r) => r.bacaklar.filter((x) => x.tur !== "yuru").map((x) => x.hat);
    const asamaYasaklari = () => {
      const ilkH = [];
      const sonH = [];
      for (const r of sonuc) {
        const h = binisler(r);
        if (h.length) {
          ilkH.push(h[0]);
          sonH.push(h[h.length - 1]);
        }
      }
      ekle(ilkH);
      ekle(sonH);
    };
    const yeniRota = (r) => {
      for (const h of binisler(r)) ekle([h]);
      asamaYasaklari();
    };
    yeniRota(ilk.enIyi);

    let arama = 0;
    while (kuyruk.length && sonuc.length < adet && arama < 18) {
      const yasak = kuyruk.shift();
      arama++;
      const a = ara(ag, nereden, nereye, t0, { ...opt, yasakHat: new Set([...taban, ...yasak]) }).enIyi;
      if (a && !sonuc.some((x) => x.imza === a.imza) && a.sure <= sonuc[0].sure * 1.6 + 10) {
        sonuc.push(a);
        yeniRota(a);
      }
    }
    return { sonuc, etiketler: ilk.etiketler };
  }

  function durakYonu(ag, i) {
    const dd = ag.desenDurak[i];
    const hed = new Map();
    const hat = [];
    for (let q = 0; q < dd.length; q += 2) {
      const p = ag.desenler[dd[q]];
      if (dd[q + 1] === p.d.length - 1) continue;
      hed.set(p.ad, (hed.get(p.ad) || 0) + 1);
      if (!hat.includes(p.hat)) hat.push(p.hat);
    }
    return {
      yon: [...hed.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]).slice(0, 2),
      hat,
    };
  }

  function yerAra(ag, metin, adet = 8) {
    const q = norm(metin);
    if (q.length < 2) return [];
    const gor = new Set();
    const out = [];
    ag.duraklar.forEach((d, i) => {
      const n = norm(d.ad);
      if (!n.includes(q)) return;
      const otobus = d.tur === "otobus" || (d.tur === "mb" && d.kod);
      const y = otobus ? durakYonu(ag, i) : null;
      const k = n + "|" + d.tur + "|" + (y ? y.yon.join(",") : "");
      if (gor.has(k)) return;
      gor.add(k);
      const alt = otobus
        ? `${d.tur === "mb" ? "Metrobüs" : "Durak"}${y.yon.length ? " · → " + y.yon.join(" / ") : ""}${
            y.hat.length ? " · " + y.hat.slice(0, 5).join(", ") + (y.hat.length > 5 ? "…" : "") : ""
          }`
        : TUR_ADI[d.tur] + (d.hat && !["vapur", "mb", "otobus"].includes(d.tur) ? " " + d.hat : "");
      out.push({
        ad: d.ad,
        alt,
        lat: d.lat,
        lon: d.lon,
        tur: otobus ? "durak" : d.tur,
        kod: otobus ? d.kod : undefined,
        durak: true,
        skor: (n.startsWith(q) ? 0 : 1) + (otobus ? 0.3 : 0) + (y && !y.hat.length ? 2 : 0),
      });
    });
    return out.sort((a, b) => a.skor - b.skor).slice(0, adet);
  }

  /**
   * Estimates 2026 Istanbulkart fare for a computed route.
   * Tam bilet: 27.00 TL, 1. aktarma: 19.33 TL, 2. aktarma: 14.67 TL, 3.+ aktarma: 9.27 TL.
   * Metrobus scales up to ~40.07 TL; Marmaray scales 27.00–59.76 TL by stop count.
   * @param {object} route
   * @returns {{ tamTL: number, ogrenciTL: number }}
   */
  function ucretHesapla(route) {
    const AKTARMA_TARIFE = [27.0, 19.33, 14.67, 9.27];
    const bacaklar = (route && route.bacaklar) || [];
    const transit = bacaklar.filter((b) => b.tur && b.tur !== "yuru" && b.tur !== "dis");
    if (!transit.length) return { tamTL: 0, ogrenciTL: 0 };

    let tamTL = 0;
    let ogrenciTL = 0;
    let binisNo = 0;

    for (const b of transit) {
      const stops = Math.max(1, b.durakSayisi || (b.j != null && b.i != null ? b.j - b.i : 6));
      let ucret;
      if (b.tur === "marmaray") {
        if (stops <= 7) ucret = 27.0;
        else if (stops <= 14) ucret = 34.72;
        else if (stops <= 21) ucret = 40.07;
        else if (stops <= 28) ucret = 46.22;
        else if (stops <= 35) ucret = 53.99;
        else ucret = 59.76;
        // Marmaray does not participate in standard transfer discount; student ~48.8%
        tamTL += ucret;
        ogrenciTL += ucret * 0.488;
      } else if (b.tur === "mb") {
        const oran = Math.min(1, Math.max(0, (stops - 1) / 33));
        ucret = stops <= 3 ? 27.0 : 27.0 + oran * (40.07 - 27.0);
        if (binisNo > 0) ucret = Math.max(19.33, ucret - (27.0 - 19.33));
        tamTL += ucret;
        ogrenciTL += ucret * 0.488;
      } else {
        const idx = Math.min(binisNo, AKTARMA_TARIFE.length - 1);
        ucret = AKTARMA_TARIFE[idx];
        tamTL += ucret;
        ogrenciTL += ucret * 0.488;
      }
      binisNo++;
    }

    return {
      tamTL: Math.round(tamTL * 100) / 100,
      ogrenciTL: Math.round(ogrenciTL * 100) / 100,
    };
  }

  /**
   * Scores a route according to the requested optimization criterion (lower is better).
   * @param {object} route
   * @param {"fastest"|"fewest_transfers"|"least_walking"|"least_waiting"|"cheapest"|"traffic_resilient"} kriter
   * @param {number} [trafficFactor=1.0]
   * @returns {number}
   */
  function puanla(route, kriter = "fastest", trafficFactor = 1.0) {
    if (!route) return Infinity;
    const varis = route.varis ?? 0;
    const aktarma = route.aktarma || 0;
    const yurumeM = route.yurumeM || 0;
    const bacaklar = route.bacaklar || [];

    switch (kriter) {
      case "fewest_transfers":
        return aktarma * 60 + varis;
      case "least_walking":
        return yurumeM * 0.25 + varis;
      case "least_waiting": {
        const totalWaitDk = bacaklar.reduce((s, b) => s + (b.bekleme || 0), 0);
        return totalWaitDk * 4 + varis;
      }
      case "cheapest": {
        const { tamTL } = ucretHesapla(route);
        return tamTL * 15 + varis;
      }
      case "traffic_resilient": {
        const tf = Math.max(0.5, Number(trafficFactor) || 1.0);
        const surfacePenalty = bacaklar.reduce((s, b) => {
          if (b.tur === "otobus") {
            const dur = Math.max(0, (b.varis ?? 0) - (b.kalkis ?? 0));
            return s + dur * (tf - 1);
          }
          return s;
        }, 0);
        return varis + surfacePenalty + aktarma * 1.5;
      }
      case "fastest":
      default:
        return varis + aktarma * 0.5;
    }
  }

  /**
   * Builds an inverted index mapping each coded stop to all passing line codes.
   * Enables <1ms Stop Departure Board lookups.
   * @param {object} ag
   * @returns {Object<string, string[]>}
   */
  function buildStopLinesIndex(ag) {
    const index = Object.create(null);
    if (!ag || !ag.duraklar || !ag.desenler) return index;

    const seenByStop = new Map();
    for (const p of ag.desenler) {
      if (!p || !p.d || !p.hat) continue;
      for (const stopIdx of p.d) {
        const d = ag.duraklar[stopIdx];
        if (!d || !d.kod) continue;
        let set = seenByStop.get(d.kod);
        if (!set) {
          set = new Set();
          seenByStop.set(d.kod, set);
        }
        set.add(p.hat);
      }
    }

    for (const [kod, set] of seenByStop) {
      index[kod] = [...set].sort();
    }
    return index;
  }

  return {
    kur,
    ara,
    alternatifler,
    direkler,
    bekleHesap,
    durakYonu,
    durakKumesi,
    duzenle,
    yerAra,
    yakinDuraklar,
    yurume,
    yurumeMaliyet,
    turOf,
    norm,
    bas,
    otobusHiz,
    otobusAralik,
    ucretHesapla,
    puanla,
    buildStopLinesIndex,
    TUR_ADI,
    HAT_RENK,
    MARMARAY,
    tabloGunUygun,
    bugunYapilmayanIsaretler,
    satirYok,
  };
})();
