/**
 * İstanbul Ulaşım v4.0 — Rota Planlayıcı (Multi-modal Route Planner & Timeline)
 */
import L from "leaflet";
import { Zaman } from "../core/time.js";
import { Core, polylineCoz } from "../core/geo.js";
import { KV } from "../core/storage.js";
import { API } from "../core/api.js";
import { Plan } from "../core/router.js";
import { iconSvg } from "../ui/icons.js";
import { esc, bas, metre, saat, renkKod, hataMesaji } from "../map/mapController.js";

const TUR_IKON = {
  metro: "metro",
  marmaray: "marmaray",
  tram: "tram",
  fun: "fun",
  tf: "tf",
  mb: "mb",
  vapur: "vapur",
  otobus: "otobus",
  yuru: "walk",
  durak: "busStop",
  benim: "konum",
  harita: "katman",
  son: "clock",
};

export function yerAdi(y) {
  return !y ? "" : y.benim ? "Konumum" : y.ad;
}

export function createRouteView(S, mc, callbacks) {
  const AG = { temel: null, otobus: null, vapur: null, kurulma: 0, saatDilimi: null, indirme: null };
  const SEFER = new Map();
  const PLAN_ZAMAN = { gunTipi: null, canli: true, tabanMs: 0, tabanDk: 0 };

  let agYukleniyor = null;
  let rotaNo = 0;
  let yerAramaNo = 0;
  let yerAramaZaman = null;
  let secimAlani = null;
  let kaydedilenAlan = null; // "ev" | "is" when user is setting a saved place

  const gunTipiPlan = () => PLAN_ZAMAN.gunTipi || Zaman.gunTipi();
  const seferAl = (hat) => SEFER.get(gunTipiPlan() + "|" + hat);

  const isoDk = (iso) => {
    const d = new Date(iso);
    const z = PLAN_ZAMAN.tabanMs ? PLAN_ZAMAN : { tabanMs: Date.now(), tabanDk: Zaman.simdi() + new Date().getSeconds() / 60 };
    return z.tabanDk + (d - z.tabanMs) / 60000;
  };

  function agKur() {
    const s = new Date();
    const dilim = Math.floor((s.getHours() * 60 + s.getMinutes()) / 30);
    S.ag = Plan.kur({ ...(AG.temel || {}), otobus: AG.otobus, vapur: AG.vapur || [] });
    AG.kurulma = Date.now();
    AG.saatDilimi = dilim;
    return S.ag;
  }

  function agHazirla() {
    if (agYukleniyor) {
      return agYukleniyor.then(() => {
        const s = new Date();
        if (Math.floor((s.getHours() * 60 + s.getMinutes()) / 30) !== AG.saatDilimi) agKur();
        return S.ag;
      });
    }
    agYukleniyor = (async () => {
      AG.temel = await API.ag.temel();
      agKur();
      API.vapur
        .tumu()
        .then((v) => {
          AG.vapur = v;
          S.agVapur = true;
          agKur();
          if (S.rota.sonuclar && callbacks.sayfa().tur === "rota") rotaBul(true);
        })
        .catch(() => {});
      AG.indirme = { bitti: 0, toplam: 0 };
      API.ag
        .otobus((bitti, toplam) => {
          AG.indirme = { bitti, toplam };
          if (callbacks.sayfa().tur === "rota") callbacks.panelYenile();
        })
        .then((ob) => {
          AG.otobus = ob;
          AG.indirme = null;
          agKur();
          if (callbacks.sayfa().tur === "rota") {
            if (S.rota.sonuclar) rotaBul(true);
            else callbacks.panelYenile();
          }
        })
        .catch(() => {
          AG.indirme = { hata: true };
        });
      return S.ag;
    })().catch((e) => {
      agYukleniyor = null;
      throw e;
    });
    return agYukleniyor;
  }

  async function seferHazirla(hat) {
    const g = gunTipiPlan();
    const key = g + "|" + hat;
    if (SEFER.has(key)) return;
    try {
      const s = await API.iett.seferler(hat);
      const o = {};
      for (const y of Object.keys(s || {})) {
        o[y] = (s[y][g] || []).map(Zaman.dk).filter((x) => x != null).sort((x, z) => x - z);
      }
      SEFER.set(key, o);
    } catch {
      SEFER.set(key, undefined);
    }
  }

  function seferBekleme(p, i, t) {
    if (!p.iett) return undefined;
    const key = gunTipiPlan() + "|" + p.hat;
    if (!SEFER.has(key)) return undefined;
    const o = SEFER.get(key);
    if (!o) return undefined;
    const l = o[p.yon];
    if (!l || !l.length) return null;
    let en = null;
    for (const k of l) {
      let v = k + p.t[i];
      if (v < t - 720) v += 1440;
      if (v >= t && (en == null || v < en)) en = v;
    }
    return en == null ? null : en - t;
  }

  async function otobusGelis(hat, yon, durakKod, t, desenOfset, now) {
    const adaylar = [];
    let tarifeVar = false;
    if (PLAN_ZAMAN.canli) {
      try {
        const v = await mc.hatHazirla(hat);
        if (!v.zaman || Date.now() - v.zaman > 25e3) mc.konumIsle(hat, await API.iett.konum(hat));
        const liste = v.duraklar?.[yon] || [];
        const i = liste.findIndex((d) => d.kod === durakKod);
        if (i >= 0) {
          for (const b of v.otobusler || []) {
            if (b.yon !== yon) continue;
            const a = S.arac.get(hat + "/" + b.kapino);
            const p = a ? { ...b, lat: a.gor.lat, lon: a.gor.lon } : b;
            const e = Core.varisTahmini(liste, p, i, mc.aracHizi(hat, b.kapino));
            if (e) adaylar.push({ dk: now + e.dakika, kaynak: "canlı", kapino: b.kapino, durak: e.durakSayisi });
          }
        }
      } catch {
        // ignore live fallback
      }
    }
    try {
      const sf = await API.iett.seferler(hat);
      const l = sf?.[yon]?.[gunTipiPlan()] || [];
      if (l.length) tarifeVar = true;
      for (const s of l) {
        const k = Zaman.dk(s);
        if (k == null) continue;
        let kk = k;
        if (kk + desenOfset < now - 720) kk += 1440;
        if (kk < now - 1 && adaylar.some((x) => x.kaynak === "canlı")) continue;
        adaylar.push({ dk: kk + desenOfset, kaynak: "tarife", ilk: s });
      }
    } catch {
      // ignore
    }
    const uygun = adaylar.filter((x) => x.dk >= t - 0.5).sort((x, y) => x.dk - y.dk);
    if (uygun.length) return uygun[0];
    if (tarifeVar || adaylar.length) return null;
    return { dk: t + Plan.otobusAralik(t) / 2, kaynak: "tahmini" };
  }

  function geriKaydir(r) {
    const l = r.bacaklar;
    const iA = l.findIndex((x) => x.tur !== "yuru");
    if (iA < 0) return;
    const b0 = l[iA];
    const iB = l.findIndex((x, k) => k > iA && x.tur !== "yuru");
    if (iB < 0) return;
    const b1 = l[iB];
    const aradaYuru = l.slice(iA + 1, iB).reduce((t, x) => t + (x.varis - x.kalkis), 0);
    const bosluk = b1.kalkis - (b0.varis + aradaYuru);
    if (bosluk < 8 || !b0.iett) return;
    const o = seferAl(b0.hat);
    const p = S.ag?.desenler?.[b0.desen];
    if (!o || !p) return;
    const sure = b0.varis - b0.kalkis;
    let en = null;
    for (const k of o[b0.yon] || []) {
      let v = k + p.t[b0.i];
      if (v < b0.kalkis - 720) v += 1440;
      if (v >= b0.kalkis && v + sure + aradaYuru <= b1.kalkis - 1 && (en == null || v > en)) en = v;
    }
    if (en == null || en - b0.kalkis < 3) return;
    const fark = en - b0.kalkis;
    b0.kalkis = en;
    b0.varis += fark;
    b0.kaynak = "tarife";
    b0.canli = "tarife " + saat(en);
    for (let k = 0; k < iA; k++) {
      l[k].kalkis += fark;
      l[k].varis += fark;
    }
    for (let k = iA + 1; k < iB; k++) {
      l[k].kalkis += fark;
      l[k].varis += fark;
    }
    b1.bekleme = Math.max(0, b1.kalkis - (b0.varis + aradaYuru));
    b0.bekleme = 0;
    const ilk = l.find((x) => x.tur !== "yuru");
    r.canli = `${ilk.hat} · ${ilk.canli}`;
  }

  async function rotaInceltme(r, now) {
    r.bacaklar = r.bacaklar.filter(
      (b, i, l) => !(b.tur === "yuru" && (b.m || 0) < 40 && (i === 0 || i === l.length - 1) && l.length > 1)
    );
    let t = now;
    for (const b of r.bacaklar) {
      if ((b.tur === "otobus" || b.tur === "mb") && !b.renk) {
        b.renk = b.tur === "mb" ? "#d9381e" : renkKod(b.hat);
      }
      // Collect intermediate stop names if available in S.ag
      if (b.desen != null && S.ag?.desenler?.[b.desen] && !b.araDuraklar) {
        const p = S.ag.desenler[b.desen];
        b.araDuraklar = p.d.slice(b.i + 1, b.j).map((idx) => S.ag.duraklar[idx]?.ad).filter(Boolean);
      }
    }
    r.kalkis = now;
    for (const b of r.bacaklar) {
      const sure = b.varis - b.kalkis;
      if (b.tur === "yuru") {
        b.kalkis = t;
        t += sure;
        b.varis = t;
        continue;
      }
      if (b.iett && b.durakKodlari) {
        const p = S.ag.desenler[b.desen];
        const g = await otobusGelis(b.hat, b.yon, b.durakKodlari[0], t, p.t[b.i], now);
        if (!g) {
          r.gecersiz = `${b.hat} bugün artık sefer yapmıyor`;
          return r;
        }
        b.bekleme = Math.max(0, g.dk - t);
        b.kalkis = g.dk;
        b.varis = g.dk + sure;
        t = b.varis;
        b.kaynak = g.kaynak;
        b.canli =
          g.kaynak === "canlı"
            ? `${g.kapino} ~${Math.max(0, Math.round(g.dk - now))} dk`
            : g.kaynak === "tarife"
            ? `tarife ${saat(g.dk)}`
            : "tahmini";
        continue;
      }
      if (b.kaynak === "transitous") {
        if (b.kalkis < t - 1) {
          r.gecersiz = "aktarmaya yetişilemiyor";
          return r;
        }
        b.bekleme = b.kalkis - t;
        t = b.varis;
        continue;
      }
      if (b.tur === "vapur") {
        if (b.kalkis < t - 0.5) {
          r.gecersiz = "vapura yetişilemiyor";
          return r;
        }
        b.bekleme = b.kalkis - t;
        t = b.varis;
        continue;
      }
      let bekle = b.bekleme ?? 3;
      if (b.from?.istId && !r._rayliBakildi && PLAN_ZAMAN.canli) {
        r._rayliBakildi = true;
        try {
          const yonler = await API.metro.yonler(b.from.hatId);
          const hedef = Plan.norm(b.yonAd || "");
          const y = yonler.find((x) => {
            const s = Plan.norm(x.ad.split("->").pop());
            return s.startsWith(hedef.slice(0, 5)) || hedef.startsWith(s.slice(0, 5));
          });
          if (y) {
            const tt = await API.metro.saatler(b.from.istId, b.from.hatId, y.id);
            const u = tt.saatler.map(Zaman.dk).find((x) => x != null && x >= t);
            if (u != null) {
              bekle = u - t;
              b.canli = "tarife " + saat(u);
              b.kaynak = "tarife";
            }
          }
        } catch {
          // ignore
        }
      }
      b.bekleme = bekle;
      b.kalkis = t + bekle;
      b.varis = b.kalkis + sure;
      t = b.varis;
    }
    r.varis = t;
    r.sure = t - now;
    geriKaydir(r);
    const ilk = r.bacaklar.find((x) => x.tur !== "yuru");
    r.canli = ilk?.canli
      ? ilk.kaynak === "canlı"
        ? `${ilk.hat} (${ilk.canli.split(" ")[0]}) durağa ${ilk.canli.split(" ").slice(1).join(" ")} sonra gelecek`
        : `${ilk.hat} · ${ilk.canli}`
      : "";
    return r;
  }

  function trDonustur(it) {
    const tur = { BUS: "otobus", TRAM: "tram", SUBWAY: "metro", METRO: "metro", FERRY: "vapur", WALK: "yuru", COACH: "otobus" };
    const bacaklar = (it.legs || []).map((l) => {
      const t = tur[l.mode] || "otobus";
      let yol = null;
      try {
        yol = l.legGeometry ? polylineCoz(l.legGeometry.points, l.legGeometry.precision || 7) : null;
      } catch {
        yol = null;
      }
      if (!yol || yol.length < 2) yol = [[l.from.lat, l.from.lon], [l.to.lat, l.to.lon]];
      const m =
        l.distance ||
        yol.reduce((a, p, i) => (i ? a + Core.mesafe({ lat: yol[i - 1][0], lon: yol[i - 1][1] }, { lat: p[0], lon: p[1] }) : 0), 0);
      const mb = t === "otobus" && /^34[A-Z]{0,2}$/.test(l.routeShortName || "");
      return {
        tur: mb ? "mb" : t,
        hat: l.routeShortName || "",
        renk: mb ? "#d9381e" : t === "otobus" ? renkKod(l.routeShortName || "") : "#0f62fe",
        headsign: l.headsign,
        from: { ad: bas(l.from.name), lat: l.from.lat, lon: l.from.lon },
        to: { ad: bas(l.to.name), lat: l.to.lat, lon: l.to.lon },
        kalkis: isoDk(l.startTime),
        varis: isoDk(l.endTime),
        durakSayisi: t === "yuru" ? 0 : (l.intermediateStops || []).length + 1,
        araDuraklar: (l.intermediateStops || []).map((st) => bas(st.name)).filter(Boolean),
        yol,
        m,
        kaynak: "transitous",
      };
    });
    bacaklar.forEach((b) => {
      if (b.from.ad === "Start" || b.from.ad === "START") b.from.ad = "Başlangıç";
      if (/^end$/i.test(b.to.ad)) b.to.ad = "Varış";
    });
    const r = Plan.duzenle({ bacaklar }, bacaklar[0]?.kalkis ?? Zaman.simdi(), null);
    r.kalkis = Math.min(r.kalkis, bacaklar[0]?.kalkis ?? r.kalkis);
    r.sure = r.varis - Zaman.simdi();
    return r;
  }

  async function rotaBul(sessiz = false) {
    const R = S.rota;
    const no = ++rotaNo;
    if (!sessiz) {
      R.sonuclar = null;
      R.durum = "Rotalar hesaplanıyor…";
      callbacks.ciz();
    }
    try {
      let a = R.nereden;
      let b = R.nereye;
      if (a.benim) {
        const k = S.ben || (await mc.benimKonum(false));
        if (!k) throw new Error("Konum alınamadı");
        a = { ...k, ad: "Konumum" };
      }
      if (b.benim) {
        const k = S.ben || (await mc.benimKonum(false));
        if (!k) throw new Error("Konum alınamadı");
        b = { ...k, ad: "Konumum" };
      }

      const taban = R.zaman ? new Date(R.zaman) : new Date();
      const ileri = Boolean(R.zaman) && Math.abs(taban - Date.now()) > 20 * 60e3;
      const tabanDk = taban.getHours() * 60 + taban.getMinutes() + (taban.getHours() < 4 ? 1440 : 0);
      PLAN_ZAMAN.gunTipi = Zaman.gunTipi(taban);
      PLAN_ZAMAN.canli = !ileri;
      PLAN_ZAMAN.tabanMs = ileri ? taban.getTime() : Date.now();
      PLAN_ZAMAN.tabanDk = ileri ? tabanDk : Zaman.simdi() + new Date().getSeconds() / 60;

      let ag = await agHazirla();
      if (ileri) {
        ag = Plan.kur({ ...(AG.temel || {}), otobus: AG.otobus, vapur: AG.vapur || [], saat: tabanDk, gun: taban.getDay() });
        S.ag = ag;
        AG.saatDilimi = null;
      }

      const simdi = () => (ileri ? tabanDk : Zaman.simdi() + new Date().getSeconds() / 60);
      const t0 = simdi();
      const nowISO = taban.toISOString();

      const trDirekt = API.transitous.plan(a, b, nowISO).then((l) => l.map(trDonustur)).catch(() => []);

      let sonuc = [];
      let etiketler = null;
      for (let tur = 0; tur < 4; tur++) {
        ({ sonuc, etiketler } = Plan.alternatifler(ag, a, b, t0, { bekleme: seferBekleme }, 7));
        sonuc = Plan.direkler(ag, a, b, t0, { bekleme: seferBekleme }).concat(sonuc);
        const yeni = [...new Set(sonuc.flatMap((r) => r.bacaklar.filter((x) => x.iett).map((x) => x.hat)))].filter(
          (h) => !SEFER.has(gunTipiPlan() + "|" + h)
        );
        if (!yeni.length) break;
        R.durum = `Sefer saatleri kontrol ediliyor: ${yeni.join(", ")}…`;
        if (!sessiz) callbacks.ciz();
        await Promise.all(yeni.map(seferHazirla));
        if (no !== rotaNo) return;
      }

      let adaylar = sonuc.slice();
      if (!AG.otobus) {
        const yakinDurak = (pt) => Plan.yakinDuraklar(ag, pt, 8000, 60);
        const uzak = (pt) => Plan.yurume(yakinDurak(pt)[0]?.[1] ?? 1e9) > 10;
        const adaylar3 = (pt, f = () => true) => {
          const g = new Set();
          const o = [];
          for (const [i, m] of yakinDurak(pt)) {
            if (!f(i)) continue;
            const k = Plan.norm(ag.duraklar[i].ad);
            if (g.has(k)) continue;
            g.add(k);
            o.push([i, m]);
            if (o.length >= 3) break;
          }
          return o;
        };
        if (uzak(a)) {
          const tohumlar = (
            await Promise.all(
              adaylar3(a).map(async ([i]) => {
                try {
                  const en = (await API.transitous.plan(a, ag.duraklar[i], nowISO)).map(trDonustur).sort((x, y) => x.varis - y.varis)[0];
                  return en ? { durak: i, t: en.varis + 1, bacaklar: en.bacaklar } : null;
                } catch {
                  return null;
                }
              })
            )
          ).filter(Boolean);
          if (tohumlar.length) adaylar.push(...Plan.alternatifler(ag, a, b, t0, { tohumlar }, 3).sonuc);
        }
        if (uzak(b) && etiketler) {
          const ekler = await Promise.all(
            adaylar3(b, (i) => etiketler.en[i] < Infinity).map(async ([i]) => {
              try {
                const zISO = new Date(Date.now() + (etiketler.zaman[i] - t0) * 60000).toISOString();
                const en = (await API.transitous.plan(ag.duraklar[i], b, zISO)).map(trDonustur).sort((x, y) => x.varis - y.varis)[0];
                return en ? Plan.duzenle({ bacaklar: etiketler.zincir(i).concat(en.bacaklar) }, t0, ag) : null;
              } catch {
                return null;
              }
            })
          );
          adaylar.push(...ekler.filter(Boolean));
        }
      }

      adaylar.push(...(await trDirekt));
      if (no !== rotaNo) return;

      adaylar = adaylar.filter((r) => r && r.bacaklar.length);
      const tekil0 = [];
      const im0 = new Set();
      for (const r of adaylar.sort((x, y) => (x.aktarma - y.aktarma) * 15 + x.varis - y.varis)) {
        if (im0.has(r.imza)) continue;
        im0.add(r.imza);
        tekil0.push(r);
        if (tekil0.length >= 12) break;
      }

      R.durum = "Canlı otobüs konumları ve sefer saatleri kontrol ediliyor…";
      if (!sessiz) callbacks.ciz();
      await Promise.all(tekil0.map((r) => rotaInceltme(r, simdi()).catch(() => {})));
      if (no !== rotaNo) return;

      const yuruDk = (r) => Plan.yurume(r.yurumeM);
      const cikis = (r) => {
        const iA = r.bacaklar.findIndex((x) => x.tur !== "yuru");
        return iA >= 0 ? r.bacaklar[0].kalkis : r.kalkis;
      };
      const puan = (r) => r.varis + r.aktarma * 12 + (Plan.yurumeMaliyet(yuruDk(r)) - yuruDk(r)) + (r.varis - cikis(r)) * 0.05;
      let gecerli = tekil0.filter((r) => !r.gecersiz).sort((x, y) => puan(x) - puan(y));

      const birlesik = new Map();
      for (const r of gecerli) {
        const k = r.bacaklar.filter((x) => x.tur !== "yuru").map((x) => `${x.tur}:${x.from?.ad}>${x.to?.ad}`).join("|");
        const e = birlesik.get(k);
        if (!e) {
          birlesik.set(k, r);
          continue;
        }
        r.bacaklar
          .filter((x) => x.tur !== "yuru")
          .forEach((x, i) => {
            const eb = e.bacaklar.filter((z) => z.tur !== "yuru")[i];
            if (eb && eb.hat !== x.hat) {
              eb.ekHat = eb.ekHat || [];
              if (!eb.ekHat.includes(x.hat)) eb.ekHat.push(x.hat);
            }
          });
      }
      gecerli = [...birlesik.values()];
      const enAzAktarma = gecerli.length ? Math.min(...gecerli.map((r) => r.aktarma)) : 0;
      gecerli = gecerli.filter((r) => r.aktarma <= enAzAktarma + 2);
      const tekil = [];
      for (const r of gecerli) {
        if (tekil.length && puan(r) > puan(tekil[0]) + 90) continue;
        tekil.push(r);
        if (tekil.length >= 8) break;
      }

      const gecersizler = tekil0.filter((r) => r.gecersiz).slice(0, 5);
      R.sonuclar = tekil.concat(gecersizler);
      const geceMi =
        !ileri &&
        tekil.length &&
        tekil.every((r) => {
          const ib = r.bacaklar.find((x) => x.tur !== "yuru");
          return ib && ib.kalkis - r.kalkis > 45;
        });
      R.durum = [
        geceMi ? "Şu an çalışan sefer yok; sabahın ilk seferleri gösteriliyor." : "",
        ileri ? "Seçilen zaman için planlanan sefer saatleri kullanıldı." : "",
        !AG.otobus ? "Otobüs ağı indiriliyor; bitince öneriler güncellenecek." : "",
        !S.agVapur ? "Vapur tarifeleri yükleniyor." : "",
      ]
        .filter(Boolean)
        .join(" ");

      if (["rota", "rdetay"].includes(callbacks.sayfa().tur)) callbacks.ciz();
    } catch (e) {
      R.durum = "Rota hesaplanamadı: " + hataMesaji(e);
      R.sonuclar = [];
      callbacks.ciz();
    }
  }

  function yerAramaYap() {
    const R = S.rota;
    const q = R.metin.trim();
    const no = ++yerAramaNo;
    clearTimeout(yerAramaZaman);
    if (q.length < 2) {
      R.oneriler = [];
      return callbacks.ciz();
    }
    yerAramaZaman = setTimeout(async () => {
      const yerel = S.ag ? Plan.yerAra(S.ag, q, 8) : [];
      R.oneriler = yerel;
      callbacks.ciz();
      try {
        const uzak = await API.transitous.yerAra(q, S.ben);
        if (no !== yerAramaNo) return;
        const gor = new Set(yerel.map((x) => Plan.norm(x.ad)));
        R.oneriler = yerel.concat(uzak.filter((x) => !gor.has(Plan.norm(x.ad))).slice(0, 8));
        callbacks.ciz();
      } catch {
        // ignore
      }
    }, 300);
  }

  function haritaSecimTik(e) {
    const alan = secimAlani;
    secimBitir();
    const yer = {
      ad: `Seçilen nokta (${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)})`,
      alt: "Haritadan",
      lat: e.latlng.lat,
      lon: e.latlng.lng,
      tur: "harita",
    };
    if (kaydedilenAlan) {
      S.savedPlaces[kaydedilenAlan] = yer;
      KV.set("savedPlaces", S.savedPlaces);
      kaydedilenAlan = null;
      callbacks.ciz(true);
      return;
    }
    S.rota.aktif = alan;
    yerSec(yer);
  }

  function secimBaslat(alan) {
    secimAlani = alan;
    document.body.classList.add("harita-buyuk");
    setTimeout(() => mc.map.invalidateSize(), 300);
    document.querySelector("#secimBandi")?.classList.add("acik");
    setTimeout(() => mc.map.once("click", haritaSecimTik), 50);
  }

  function secimBitir() {
    const band = document.querySelector("#secimBandi");
    if (!secimAlani && !band?.classList.contains("acik")) return;
    secimAlani = null;
    band?.classList.remove("acik");
    document.body.classList.remove("harita-buyuk");
    setTimeout(() => mc.map.invalidateSize(), 300);
  }

  function yerSec(y) {
    const R = S.rota;
    if (y.harita) {
      secimBaslat(R.aktif);
      return;
    }
    const durak = ["durak", "metro", "marmaray", "tram", "fun", "tf", "mb", "vapur"].includes(y.tur) || Boolean(y.durak);
    const secilen = y.benim
      ? { benim: true, ad: "Konumum" }
      : { ad: y.ad, alt: y.alt, lat: y.lat, lon: y.lon, tur: y.tur, durak, kod: y.kod };

    if (kaydedilenAlan) {
      if (!secilen.benim) {
        S.savedPlaces[kaydedilenAlan] = secilen;
        KV.set("savedPlaces", S.savedPlaces);
      }
      kaydedilenAlan = null;
      R.aktif = null;
      R.metin = "";
      R.oneriler = [];
      callbacks.ciz(true);
      return;
    }

    const alan = R.aktif || "nereye";
    R[alan] = secilen;
    if (!y.benim && alan === "nereye") {
      R.son = [secilen].concat(R.son.filter((x) => !(x.ad === y.ad && x.kod === y.kod))).slice(0, 6);
      KV.set("sonYerler", R.son);
    }
    R.metin = "";
    R.oneriler = [];
    R.aktif = !R.nereden ? "nereden" : !R.nereye ? "nereye" : null;
    document.activeElement?.blur?.();
    callbacks.ciz(true);
    if (R.nereden && R.nereye) rotaBul();
  }

  function filtreleSirala(sonuclar, filtre) {
    const gecerli = (sonuclar || []).filter((r) => !r.gecersiz);
    const gecersiz = (sonuclar || []).filter((r) => r.gecersiz);
    const kopya = gecerli.slice();
    if (filtre === "hizli") kopya.sort((a, b) => a.sure - b.sure);
    else if (filtre === "az_aktarma") kopya.sort((a, b) => a.aktarma - b.aktarma || a.sure - b.sure);
    else if (filtre === "az_yuru") kopya.sort((a, b) => a.yurumeM - b.yurumeM || a.sure - b.sure);
    return kopya.concat(gecersiz);
  }

  function bacakRozet(b) {
    const ikon = TUR_IKON[b.tur] || "otobus";
    const etiket = b.tur === "vapur" ? "Vapur" : [b.hat, ...(b.ekHat || [])].join(" / ");
    return `<span class="rozet" style="background:${esc(b.renk || "#0f62fe")}">${iconSvg(ikon, 13)} ${esc(etiket)}</span>`;
  }

  function zincirHTML(r) {
    const p = [];
    r.bacaklar.forEach((b, i) => {
      if (i) p.push('<span class="ok">›</span>');
      p.push(
        b.tur === "yuru"
          ? `<span class="alt">${iconSvg("walk", 13)} ${Math.max(1, Math.round(b.varis - b.kalkis))}</span>`
          : bacakRozet(b)
      );
    });
    return `<div class="zincir">${p.join("")}</div>`;
  }

  function rotaKart(r, i) {
    if (r.gecersiz) {
      return `
        <div class="kart" style="opacity:.55">
          <div class="bas"><span class="sure tarife">Sefer Yok</span>${zincirHTML(r)}</div>
          <div class="alt">O saatte kullanılamaz: ${esc(r.gecersiz)}.</div>
        </div>`;
    }
    const ilkBinis = r.bacaklar.find((b) => b.tur !== "yuru");
    const ilkYuru = r.bacaklar[0]?.tur === "yuru" ? r.bacaklar[0].varis - r.bacaklar[0].kalkis : 0;
    const cikis = ilkBinis ? ilkBinis.kalkis - ilkYuru : r.kalkis;
    const gece = ilkBinis && cikis - r.kalkis > 40;
    const yolculuk = r.varis - (gece ? cikis : r.kalkis);
    const ilkB = r.bacaklar.find((x) => x.tur !== "yuru");
    const canli = r.canli
      ? `<div class="alt">${ilkB?.kaynak === "canlı" ? '<span class="canli">CANLI</span>' : iconSvg("clock", 13)} ${esc(r.canli)}</div>`
      : "";

    return `
      <div class="kart tik" data-rota="${i}">
        <div class="bas" style="justify-content:space-between">
          <div style="flex:1;min-width:0">${zincirHTML(r)}</div>
          <span class="sure ${i === 0 && !gece ? "yakin" : ""}">${gece ? saat(cikis) : Math.round(r.sure) + " dk"}</span>
        </div>
        <div class="alt">
          ${gece ? `Şu an sefer yok · <b style="color:var(--yazi)">${saat(cikis)}</b> çıkış · ${Math.round(yolculuk)} dk · ` : `${saat(r.kalkis)} → `}
          <b style="color:var(--yazi)">${saat(r.varis)}</b> varış · ${metre(r.yurumeM)} yürüme · ${r.aktarma ? `${r.aktarma} aktarma` : `<b style="color:var(--iyi)">aktarmasız</b>`}
        </div>
        ${canli}
      </div>`;
  }

  async function render(p, ilk) {
    const R = S.rota;
    if (ilk) {
      mc.aktifHatlarAyarla([]);
      if (!R.nereden) R.nereden = { benim: true, ad: "Konumum" };
      agHazirla().catch(() => {});
    }
    if (ilk && R.nereden?.lat) mc.ucIsaret([R.nereden.lat, R.nereden.lon], "baslangic").addTo(mc.katman);
    if (ilk && R.nereye?.lat) mc.ucIsaret([R.nereye.lat, R.nereye.lon], "varis").addTo(mc.katman);

    let html = callbacks.baslikHTML("Rota Planlayıcı", false);

    // Quick Ev & İş Saved Places
    const ev = S.savedPlaces?.ev;
    const is = S.savedPlaces?.is;
    html += `
      <div class="hizli-yerler" aria-label="Kayıtlı Yerler">
        <button class="cip" data-kayitli="ev">${iconSvg("home", 15)} Ev${ev ? ` · ${esc(ev.ad.slice(0, 14))}` : " (ekle)"}</button>
        ${ev ? `<button class="cip" data-kayitli-duzenle="ev" title="Ev konumunu değiştir">Düzenle</button>` : ""}
        <button class="cip" data-kayitli="is">${iconSvg("work", 15)} İş${is ? ` · ${esc(is.ad.slice(0, 14))}` : " (ekle)"}</button>
        ${is ? `<button class="cip" data-kayitli-duzenle="is" title="İş konumunu değiştir">Düzenle</button>` : ""}
      </div>`;

    const giris = (alan, ph) => {
      const y = R[alan];
      const duzenle = R.aktif === alan;
      return `
        <div class="yer-giris ${alan === "nereye" ? "varis" : ""}">
          <span class="nokta"></span>
          <input id="yer_${alan}" data-alan="${alan}" placeholder="${ph}" value="${esc(duzenle ? R.metin : yerAdi(y))}" autocomplete="off">
          ${y && !duzenle ? `<button data-temizle="${alan}" aria-label="Temizle">${iconSvg("close", 16)}</button>` : ""}
        </div>`;
    };

    html += `
      <div class="rota-ust">
        ${giris("nereden", "Nereden?")}
        ${giris("nereye", "Nereye? (yer, durak, istasyon)")}
        <button class="btn ikon" data-degistir title="Yer değiştir" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:var(--kart)">${iconSvg("swap", 17)}</button>
      </div>`;

    const zv = R.zaman || "";
    html += `
      <div class="segment">
        <button data-zaman="simdi" class="${R.zaman ? "" : "aktif"}">Şimdi</button>
        <button data-zaman="sec" class="${R.zaman ? "aktif" : ""}">${iconSvg("clock", 15)} Tarih ve saat seç</button>
      </div>`;
    if (R.zaman) {
      html += `<input type="datetime-local" id="zamanSec" class="giris" value="${esc(zv)}" style="margin-bottom:10px">`;
    }

    if (R.aktif) {
      const satir = (o, i) => `
        <button class="oneri-satir" data-oneri="${i}">
          <span style="display:flex;align-items:center;gap:10px;min-width:0">
            ${iconSvg(TUR_IKON[o.tur] || "konum", 18)}
            <span style="min-width:0">
              <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(o.ad)}</div>
              <div class="alt">${esc(o.alt || "")}</div>
            </span>
          </span>
          ${iconSvg("chevronRight", 16)}
        </button>`;
      const ozel = [];
      if (R.aktif === "nereden" && !kaydedilenAlan) {
        ozel.push({ tur: "benim", ad: "Konumum", alt: "Bulunduğunuz yer", benim: true });
      }
      ozel.push({ tur: "harita", ad: "Haritadan seç", alt: "Haritada bir noktaya dokunun", harita: true });
      const liste =
        R.metin.trim().length >= 2
          ? ozel.filter((x) => x.harita).concat(R.oneriler)
          : ozel.concat(R.son.map((x) => ({ ...x, tur: "son", alt: x.alt || "Son aranan" })));
      R.gosterilen = liste;
      html += `<div class="oneriler">${liste.map(satir).join("") || `<div class="alt" style="padding:12px">Aranıyor…</div>`}</div>`;
    }

    if (AG.indirme && AG.indirme.toplam) {
      const pct = Math.round((100 * AG.indirme.bitti) / AG.indirme.toplam);
      html += `<div class="alt" style="margin-bottom:8px">Otobüs ağı hazırlanıyor: ${AG.indirme.bitti}/${AG.indirme.toplam} (%${pct})</div>`;
    }

    if (R.nereden && R.nereye && !R.aktif) {
      html += `<button class="btn birincil" style="width:100%;margin-bottom:10px" data-rotabul>${iconSvg("rota", 18)} Rota Bul</button>`;
      if (R.durum) html += `<div class="alt" style="margin-bottom:8px">${esc(R.durum)}</div>`;
      if (R.sonuclar) {
        const filtre = R.filtre || "onerilen";
        html += `
          <div class="cip-satir" aria-label="Rota Sıralama">
            <button class="cip ${filtre === "onerilen" ? "aktif" : ""}" data-rfiltre="onerilen">Önerilen</button>
            <button class="cip ${filtre === "hizli" ? "aktif" : ""}" data-rfiltre="hizli">En Hızlı</button>
            <button class="cip ${filtre === "az_aktarma" ? "aktif" : ""}" data-rfiltre="az_aktarma">Az Aktarma</button>
            <button class="cip ${filtre === "az_yuru" ? "aktif" : ""}" data-rfiltre="az_yuru">Az Yürüme</button>
          </div>`;

        const sirali = filtreleSirala(R.sonuclar, filtre);
        R.gosterilenSonuclar = sirali;

        if (!sirali.length) {
          html += `<div class="bos">Uygun rota bulunamadı.</div>`;
        } else {
          html += `<div class="liste">${sirali.map((r, i) => rotaKart(r, i)).join("")}</div>`;
        }
      }
    } else if (!R.aktif) {
      html += `<div class="alt">Gitmek istediğiniz yeri yazın, Ev/İş seçin ya da haritadan dokunun.</div>`;
    }

    return html;
  }

  async function renderDetail(p, ilk) {
    const r = S.rota.gosterilenSonuclar?.[p.i] || S.rota.sonuclar?.[p.i];
    if (!r) {
      S.yigin.pop();
      return callbacks.ciz(true);
    }
    const otobusHatlari = [
      ...new Set(r.bacaklar.filter((b) => (b.tur === "otobus" || b.iett) && b.hat && b.hat !== "Metrobüs").map((b) => b.hat)),
    ];

    if (ilk) {
      mc.aktifHatlarAyarla(otobusHatlari);
      const pts = [];
      for (const b of r.bacaklar) {
        const yol = b.yol || [[b.from.lat, b.from.lon], [b.to.lat, b.to.lon]];
        pts.push(...yol);
        if (b.tur === "yuru") {
          L.polyline(yol, { color: "#6b7280", weight: 4, dashArray: "2 8", lineCap: "round", interactive: false }).addTo(mc.katman);
        } else {
          L.polyline(yol, { color: "#fff", weight: 7, opacity: 0.9, interactive: false }).addTo(mc.katman);
          L.polyline(yol, { color: b.renk || "#0f62fe", weight: 4, interactive: false }).addTo(mc.katman);
          L.circleMarker(yol[0], { radius: 5, color: b.renk || "#0f62fe", weight: 3, fillColor: "#fff", fillOpacity: 1 })
            .bindTooltip(esc(b.from.ad))
            .addTo(mc.katman);
        }
      }
      if (pts.length) {
        mc.ucIsaret(pts[0], "baslangic").addTo(mc.katman);
        mc.ucIsaret(pts[pts.length - 1], "varis").addTo(mc.katman);
        mc.sigdir(pts);
      }
      for (const h of otobusHatlari) {
        mc.hatHazirla(h).then(() => mc.aracCiz(h)).catch(() => {});
      }
      mc.canliTur();
    }

    const paylasBtn = `<button class="btn kucuk" data-rota-paylas="${p.i}">${iconSvg("share", 14)} Paylaş</button>`;
    let html = callbacks.baslikHTML(`${Math.round(r.sure)} dk · ${saat(r.varis)} varış`, true, paylasBtn);
    html += `<div style="margin-bottom:10px">${zincirHTML(r)}</div>`;
    html += `<div class="kart">`;

    r.bacaklar.forEach((b, i) => {
      if (b.tur === "yuru") {
        const ayniDurak = (b.m || 0) < 40 && i > 0 && i < r.bacaklar.length - 1;
        html += `
          <div class="bacak yuruyus">
            <div class="bas">${saat(b.kalkis)} · ${ayniDurak ? "Aynı durakta aktarma" : `${Math.max(1, Math.round(b.varis - b.kalkis))} dk yürüme (${metre(b.m)})`}</div>
            <div class="alt">→ ${i === r.bacaklar.length - 1 ? "Varış noktası" : esc(b.to.ad)}</div>
          </div>`;
        return;
      }

      const canli = b.canli
        ? b.kaynak === "canlı"
          ? `<span class="canli">${esc(b.canli)}</span>`
          : `<span class="rozet soluk">${esc(b.canli)}</span>`
        : "";
      const tur = Plan.TUR_ADI[b.tur] || "";
      const ara = b.araDuraklar || [];
      const acik = p.acikBacak === i;

      html += `
        <div class="bacak" style="border-left-color:${esc(b.renk || "var(--vurgu)")}">
          <div class="bas">${saat(b.kalkis)} · ${bacakRozet(b)} <span>${esc(b.from.ad)}</span> ${canli}</div>
          <div class="alt">${esc(tur)}${b.yonAd ? " · " + esc(bas(b.yonAd)) : ""}${b.headsign ? " · " + esc(bas(b.headsign)) : ""}${b.bekleme ? ` · ~${Math.round(b.bekleme)} dk bekleme` : ""}</div>
          <div class="alt">${b.durakSayisi ? b.durakSayisi + " durak · " : ""}${Math.max(1, Math.round(b.varis - b.kalkis))} dk → <b style="color:var(--yazi)">${esc(b.to.ad)}</b> (${saat(b.varis)})</div>
          ${ara.length ? `<button class="btn kucuk" style="align-self:flex-start;margin-top:4px" data-bacak-durak="${i}">${acik ? "Durakları gizle" : `${ara.length} ara durak`}</button>` : ""}
          ${acik && ara.length ? `<div class="alt" style="flex-direction:column;align-items:flex-start;gap:2px;margin-top:4px">${ara.map((ad) => `<span>· ${esc(ad)}</span>`).join("")}</div>` : ""}
        </div>`;
    });

    html += `
      <div class="bacak" style="border-left-color:var(--hata)">
        <div class="bas">${saat(r.varis)} · Varış</div>
        <div class="alt">${esc(yerAdi(S.rota.nereye))}</div>
      </div>
    </div>`;

    return html;
  }

  async function shareRoute(idx) {
    const r = S.rota.gosterilenSonuclar?.[idx] || S.rota.sonuclar?.[idx];
    if (!r) return;
    const ozet = r.bacaklar
      .map((b) => (b.tur === "yuru" ? `Yürü (${metre(b.m)})` : `${b.hat || "Vapur"} (${b.from.ad} → ${b.to.ad})`))
      .join(" > ");
    const text = `İstanbul Ulaşım Rota (${Math.round(r.sure)} dk, ${saat(r.varis)} varış): ${ozet}`;
    try {
      if (navigator.share) await navigator.share({ title: "İstanbul Ulaşım Rotası", text });
      else if (navigator.clipboard) await navigator.clipboard.writeText(text);
    } catch {
      // user cancelled share
    }
  }

  function handleSavedPlace(alan, editMode = false) {
    const saved = S.savedPlaces?.[alan];
    if (saved && !editMode) {
      const target = S.rota.aktif === "nereden" ? "nereden" : "nereye";
      S.rota[target] = saved;
      S.rota.aktif = null;
      if (!S.rota.nereden) S.rota.nereden = { benim: true, ad: "Konumum" };
      callbacks.ciz(true);
      if (S.rota.nereden && S.rota.nereye) rotaBul();
      return;
    }
    kaydedilenAlan = alan;
    S.rota.aktif = "nereye";
    S.rota.metin = "";
    S.rota.oneriler = [];
    callbacks.ciz();
    setTimeout(() => document.querySelector("#yer_nereye")?.focus(), 40);
  }

  return {
    render,
    renderDetail,
    rotaBul,
    yerAramaYap,
    yerSec,
    secimBaslat,
    secimBitir,
    shareRoute,
    handleSavedPlace,
    setRoutePlace(alan, yer) {
      S.rota[alan] = yer;
      if (!S.rota.nereden) S.rota.nereden = { benim: true, ad: "Konumum" };
      S.rota.aktif = null;
      S.sekme = "rota";
      S.yigin = [];
      callbacks.syncNav();
      callbacks.ciz(true);
      if (S.rota.nereden && S.rota.nereye) rotaBul();
    },
  };
}
