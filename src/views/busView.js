/**
 * İstanbul Ulaşım v4.0 — Otobüs & Metrobüs (Search, Line Detail, Live Vehicle Card)
 */
import { Zaman } from "../core/time.js";
import { Core } from "../core/geo.js";
import { API } from "../core/api.js";
import { iconSvg } from "../ui/icons.js";
import { esc, bas, metre, saat, renkKod, metrobusMu } from "../map/mapController.js";
import { otobusSatiriHTML } from "./nearbyView.js";

const GUN_ADI = { I: "Hafta içi", C: "Cumartesi", P: "Pazar" };

export function createBusView(S, mc, callbacks) {
  async function renderList(p, ilk) {
    if (ilk) {
      callbacks.onYukle("Otobüs ve Metrobüs", false);
      mc.aktifHatlarAyarla([]);
    }
    const [hatlar, duyurular] = await Promise.all([
      API.iett.hatlar(),
      API.iett.duyurular ? API.iett.duyurular().catch(() => []) : Promise.resolve([]),
    ]);

    const q = (S.arama || "").trim().toLocaleUpperCase("tr");
    const kat = S.busKat || "tumu"; // tumu | fav | mb | duyuru
    const duyuruMap = new Map();
    for (const d of duyurular || []) {
      const k = String(d.hat || d.HATKODU || "").trim();
      if (!k) continue;
      if (!duyuruMap.has(k)) duyuruMap.set(k, []);
      duyuruMap.get(k).push(d.mesaj || d.MESAJ || d.tip || "Duyuru");
    }

    let html = callbacks.baslikHTML("Otobüs ve Metrobüs", false);
    html += `
      <div class="arama-kutu">
        <span class="arama-ikon">${iconSvg("search", 17)}</span>
        <input class="giris" id="ara" placeholder="Hat kodu veya adı: 500T, 34BZ, Kadıköy…" value="${esc(S.arama || "")}" autocomplete="off" autocapitalize="characters">
      </div>
      <div class="cip-satir" aria-label="Otobüs Kategorileri">
        <button class="cip ${kat === "tumu" ? "aktif" : ""}" data-bus-kat="tumu">Tümü</button>
        <button class="cip ${kat === "fav" ? "aktif" : ""}" data-bus-kat="fav">${iconSvg("starFill", 14)} Favoriler</button>
        <button class="cip ${kat === "mb" ? "aktif" : ""}" data-bus-kat="mb">${iconSvg("mb", 14)} Metrobüs</button>
        <button class="cip ${kat === "duyuru" ? "aktif" : ""}" data-bus-kat="duyuru">${iconSvg("alert", 14)} Duyurular (${duyuruMap.size})</button>
      </div>`;

    const satir = (h) => {
      const fav = S.favoriler.includes(h.kod);
      const mb = metrobusMu(h);
      const dVar = duyuruMap.has(h.kod);
      return `
        <div class="kart satir tik" data-hat="${esc(h.kod)}">
          <div class="kart-sol">
            <div class="bas">
              <span class="rozet ${mb ? "mb" : "otobus"}" style="${mb ? "" : `background:${renkKod(h.kod)}`}">${iconSvg(mb ? "mb" : "otobus", 13)} ${esc(h.kod)}</span>
              <span>${esc(bas(h.ad))}</span>
              ${dVar ? `<span class="rozet" style="background:var(--uyari)">${iconSvg("alert", 12)}</span>` : ""}
            </div>
            <div class="alt">${mb ? "Metrobüs · " : ""}${h.km ? h.km.toFixed(1) + " km · " : ""}${h.dk ? Math.round(h.dk) + " dk" : ""}</div>
          </div>
          <div class="kart-sag">
            <button class="btn ikon" data-fav="${esc(h.kod)}" aria-label="Favori" style="border:0;background:transparent;color:#f59e0b">${iconSvg(fav ? "starFill" : "star", 20)}</button>
          </div>
        </div>`;
    };

    if (q) {
      const bulunan = hatlar
        .filter((h) => h.kod.startsWith(q))
        .concat(hatlar.filter((h) => !h.kod.startsWith(q) && (h.kod.includes(q) || h.ad.toLocaleUpperCase("tr").includes(q))))
        .slice(0, 40);
      html += `<div class="baslik-satir"><h2>Sonuçlar</h2><span class="soluk">${bulunan.length} hat</span></div>`;
      html += `<div class="liste">${bulunan.map(satir).join("") || `<div class="bos">Eşleşen hat bulunamadı.</div>`}</div>`;
    } else if (kat === "duyuru") {
      const duyurulu = hatlar.filter((h) => duyuruMap.has(h.kod));
      html += `<div class="baslik-satir"><h2>Aktif Duyurulu Hatlar</h2><span class="soluk">${duyurulu.length} hat</span></div>`;
      html += `<div class="liste">${duyurulu.map(satir).join("") || `<div class="bos">Şu an aktif hat duyurusu yok.</div>`}</div>`;
    } else if (kat === "mb") {
      const mb = hatlar.filter(metrobusMu).sort((a, b) => a.kod.localeCompare(b.kod, "tr"));
      html += `<div class="baslik-satir"><h2>Metrobüs Hatları</h2><span class="soluk">${mb.length} hat</span></div>`;
      html += `<div class="liste">${mb.map(satir).join("")}</div>`;
    } else if (kat === "fav") {
      const favs = S.favoriler.map((k) => hatlar.find((h) => h.kod === k) || { kod: k, ad: "" });
      html += `<div class="baslik-satir"><h2>Favoriler</h2><span class="soluk">${favs.length} hat</span></div>`;
      html += `<div class="liste">${favs.map(satir).join("") || `<div class="bos">Hat arayıp yıldız ile ekleyin.</div>`}</div>`;
    } else {
      const favs = S.favoriler.map((k) => hatlar.find((h) => h.kod === k) || { kod: k, ad: "" });
      html += `<div class="baslik-satir"><h2>Favoriler</h2></div>`;
      html += `<div class="liste">${favs.map(satir).join("") || `<div class="bos">Hat arayıp yıldız ile ekleyin.</div>`}</div>`;
      const mb = hatlar.filter(metrobusMu).sort((a, b) => a.kod.localeCompare(b.kod, "tr"));
      html += `<div class="baslik-satir"><h2>Metrobüs Hatları</h2></div>`;
      html += `<div class="liste">${mb.map(satir).join("")}</div>`;
      html += `<p class="alt" style="margin-top:12px">Toplam ${hatlar.length} İETT hattı arasında arama yapabilirsiniz.</p>`;
    }

    return html;
  }

  async function renderLine(p, ilk, no) {
    const hat = p.hat;
    if (ilk) {
      callbacks.onYukle(esc(hat), true);
      mc.aktifHatlarAyarla([hat]);
    }
    const [v, hatDuyurular] = await Promise.all([
      mc.hatHazirla(hat),
      API.iett.hatDuyurulari ? API.iett.hatDuyurulari(hat).catch(() => []) : Promise.resolve([]),
    ]);
    if (!v.otobusler || ilk) mc.konumIsle(hat, await API.iett.konum(hat));
    if (no !== callbacks.getCizimNo()) return null;
    if (!v.seferler) {
      try {
        v.seferler = await API.iett.seferler(hat);
      } catch {
        v.seferler = {};
      }
    }

    const yonler = Object.keys(v.duraklar).sort();
    if (!yonler.includes(p.yon)) p.yon = yonler[0];
    if (!p.gun) p.gun = Zaman.gunTipi();

    const liste = v.duraklar[p.yon] || [];
    const b = v.bilgi || {};
    const fav = S.favoriler.includes(hat);

    if (ilk || p.cizilenYon !== p.yon) {
      mc.katman.clearLayers();
      const pts = mc.guzergahCiz(hat, p.yon);
      if (ilk) mc.sigdir(S.ben ? pts.concat([[S.ben.lat, S.ben.lon]]) : pts);
      p.cizilenYon = p.yon;
    }
    mc.aracCiz(hat);

    const favBtn = `<button class="btn ikon" data-fav="${esc(hat)}" aria-label="Favori" style="border:0;background:transparent;color:#f59e0b">${iconSvg(fav ? "starFill" : "star", 22)}</button>`;
    let html = callbacks.baslikHTML(
      `<span class="rozet" style="background:${esc(v.renk)}">${iconSvg(v.mb ? "mb" : "otobus", 14)} ${esc(hat)}</span> <span style="font-size:15px">${esc(bas(b.ad || ""))}</span>`,
      true,
      favBtn
    );

    html += `<div class="alt" style="margin-bottom:8px">${[
      b.km ? b.km.toFixed(1) + " km" : "",
      b.dk ? "sefer " + Math.round(b.dk) + " dk" : "",
      b.tarife ? bas(b.tarife) : "",
      (v.otobusler || []).length + " araç seferde",
    ]
      .filter(Boolean)
      .join(" · ")} <span class="canli">CANLI</span></div>`;

    // Announcements banner
    for (const d of hatDuyurular || []) {
      const msg = d.mesaj || d.MESAJ || d.tip || "";
      if (msg) {
        html += `<div class="duyuru"><span class="duyuru-ikon">${iconSvg("alert", 18)}</span><span>${esc(msg)}</span></div>`;
      }
    }

    // Direction switcher
    html += `<div class="segment">${yonler
      .map((y) => {
        const l = v.duraklar[y];
        return `<button data-yon="${esc(y)}" class="${y === p.yon ? "aktif" : ""}">→ ${esc(bas(l[l.length - 1].ad))}</button>`;
      })
      .join("")}</div>`;

    const h = mc.hedefDurak(hat, p.yon);
    mc.hedefKatmani.clearLayers();
    if (h) {
      mc.durakIsaretle(hat, h.d, v.renk);
      const gel = mc.yaklasanOtobusler(hat, p.yon, h.i).slice(0, 4);
      html += `
        <div class="kart" style="margin-bottom:10px">
          <div class="alt">${h.secili ? "Durağım" : "Size en yakın durak"}: <b style="color:var(--yazi)">${esc(bas(h.d.ad))}</b>${h.metre != null ? " · " + metre(h.metre) : ""}</div>
          <div class="liste">${gel.length ? gel.map((x) => otobusSatiriHTML(hat, x)).join("") : `<div class="alt">Bu yönde yaklaşan otobüs yok</div>`}</div>
        </div>`;
    } else {
      html += `<div class="alt" style="margin-bottom:8px">Durağınızı seçmek için listeden veya haritadan bir durağa dokunun.</div>`;
    }

    // Timetable
    const gunler = v.seferler?.[p.yon] || {};
    const saatler = gunler[p.gun] || [];
    const bugun = p.gun === Zaman.gunTipi();
    const simdi = Zaman.simdi();
    const sonraki = bugun ? saatler.find((s) => Zaman.dk(s) >= simdi) : null;

    html += `<div class="baslik-satir"><h2>Sefer Saatleri</h2><span class="soluk">${esc(bas(liste[0]?.ad || ""))} kalkış</span></div>`;
    html += `<div class="segment">${["I", "C", "P"]
      .map((g) => `<button data-gun="${g}" class="${g === p.gun ? "aktif" : ""}">${GUN_ADI[g]}${g === Zaman.gunTipi() ? " •" : ""}</button>`)
      .join("")}</div>`;

    html += `<div class="kart" style="margin-bottom:12px">`;
    if (saatler.length) {
      if (sonraki) {
        html += `<div class="alt">Sıradaki kalkış <b style="color:var(--yazi)">${esc(sonraki)}</b> · ${Zaman.kalanYazi(Zaman.kalan(sonraki))} sonra</div>`;
      }
      html += `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">${saatler
        .map((s) => {
          const gecti = bugun && Zaman.dk(s) < simdi;
          const isNext = s === sonraki;
          return `<span class="sure ${isNext ? "" : "tarife"}" style="${gecti ? "opacity:.35" : ""}">${esc(s)}</span>`;
        })
        .join("")}</div>`;
    } else {
      html += `<div class="alt">Bu gün için planlanmış sefer bilgisi yok.</div>`;
    }
    html += `</div>`;

    // Interactive Stop Timeline with Live Vehicles
    const durakta = {};
    const arada = {};
    const hiz0 = v.hiz || 15;
    for (const a of S.arac.values()) {
      if (a.hat !== hat || a.yon !== p.yon) continue;
      const yer = mc.aracYeri(liste, a);
      if (!yer) continue;
      const t = h && h.i >= yer.sonraki ? Core.varisTahmini(liste, a.gor, h.i, mc.aracHizi(hat, a.kapino) || hiz0) : null;
      const kayit = { a, yer, t };
      if (yer.durakta != null) (durakta[yer.durakta] ||= []).push(kayit);
      else (arada[yer.sonraki] ||= []).push(kayit);
    }

    const kalanYazi = (k) => (k.t ? ` · <b>${k.t.dakika <= 1 ? "geliyor" : "~" + k.t.dakika + " dk"}</b>` : "");
    let lis = "";
    liste.forEach((d, i) => {
      for (const k of (arada[i] || []).sort((x, y) => y.yer.oran - x.yer.oran)) {
        lis += `
          <li class="tik" data-arac="${esc(k.a.kapino)}" style="padding-left:8px">
            <span class="arac-cip" style="background:${esc(v.renk)}">${iconSvg(v.mb ? "mb" : "otobus", 12)} ${esc(k.a.kapino)}</span>
            <span class="alt">${esc(bas(d.ad))} durağına ${metre(k.yer.metre)}${kalanYazi(k)}</span>
          </li>`;
      }
      const bu = durakta[i] || [];
      lis += `
        <li data-durak="${i}" class="tik ${h && h.i === i ? "aktif" : ""}">
          <span>${esc(bas(d.ad))}</span>
          <span style="display:flex;align-items:center;gap:6px">
            ${bu.map((k) => `<span class="arac-cip" data-arac="${esc(k.a.kapino)}" style="background:${esc(v.renk)}">${iconSvg(v.mb ? "mb" : "otobus", 12)} ${esc(k.a.kapino)}</span>`).join("")}
          </span>
        </li>`;
    });

    const toplam = Object.values(durakta).flat().length + Object.values(arada).flat().length;
    html += `<div class="baslik-satir"><h2>Duraklar (${liste.length})</h2><span class="soluk">${toplam} araç bu yönde</span></div>`;
    html += `<div class="kart"><ol class="duraklar">${lis}</ol></div>`;
    return html;
  }

  async function renderVehicle(p, ilk, no) {
    const key = p.hat + "/" + p.kapino;
    if (ilk) {
      mc.aktifHatlarAyarla([p.hat]);
      callbacks.onYukle(`${esc(p.hat)} · ${esc(p.kapino)}`, true);
    }
    const v = await mc.hatHazirla(p.hat);
    if (!v.otobusler || ilk) mc.konumIsle(p.hat, await API.iett.konum(p.hat));
    if (no !== callbacks.getCizimNo()) return null;

    const a = S.arac.get(key);
    if (ilk || p.cizilenYon !== a?.yon) {
      mc.katman.clearLayers();
      if (a) {
        mc.guzergahCiz(p.hat, a.yon);
        p.cizilenYon = a.yon;
        if (ilk) mc.map.setView([a.gor.lat, a.gor.lon], Math.max(mc.map.getZoom(), 15));
      }
    }
    mc.aracCiz(p.hat);
    if (a) {
      mc.hedefKatmani.clearLayers();
      const hd = mc.hedefDurak(p.hat, a.yon);
      if (hd) mc.durakIsaretle(p.hat, hd.d, v.renk);
    }
    if (!v.seferler) {
      API.iett
        .seferler(p.hat)
        .then((x) => {
          v.seferler = x || {};
          if (callbacks.sayfa() === p) callbacks.panelYenile();
        })
        .catch(() => {
          v.seferler = {};
        });
    }

    const baslik = callbacks.baslikHTML(
      `<span class="rozet" style="background:${esc(v.renk)}">${iconSvg(v.mb ? "mb" : "otobus", 14)} ${esc(p.hat)}</span> <span style="font-size:15px">Araç ${esc(p.kapino)}</span>`,
      true
    );

    if (!a) {
      return baslik + `<div class="bos">Bu araç şu an görünmüyor (sefer bitmiş veya konum gelmiyor).</div>`;
    }

    const liste = v.duraklar?.[a.yon] || [];
    const simdi = Zaman.simdi();
    const s = liste.length ? Core.siradakiDurak(liste, a.gor) : -1;
    const hiz = mc.aracHizi(p.hat, a.kapino);
    const tah = (i) => (liste.length && s >= 0 && i >= s ? Core.varisTahmini(liste, a.gor, i, hiz) : null);

    const yas = Math.max(0, Math.round((Date.now() - a.gercek.ms) / 1000));
    const durum = [];
    if (a.hiz != null) durum.push(a.hiz < 3 ? "duruyor / trafikte" : `~${Math.round(a.hiz)} km/sa`);
    durum.push(yas < 90 ? `konum ${yas} sn önce` : `konum ${Math.round(yas / 60)} dk önce`);

    let kart = `<div class="kart">`;
    if (liste.length) kart += `<div class="bas">→ ${esc(bas(liste[liste.length - 1].ad))} yönü</div>`;
    if (v.bilgi?.ad) kart += `<div class="alt">${esc(bas(v.bilgi.ad))}</div>`;
    kart += `<div class="alt">${durum.join(" · ")}</div>`;

    const yer = liste.length ? mc.aracYeri(liste, a) : null;
    if (yer) {
      kart += `<div class="kart" style="background:var(--kart-2);margin:6px 0">
        <div class="alt">${iconSvg("konum", 14)} <b style="color:var(--yazi)">Şu an:</b> ${
        yer.durakta != null
          ? `<b>${esc(bas(liste[yer.durakta].ad))}</b> durağında`
          : yer.sonraki > 0
          ? `<b>${esc(bas(liste[yer.sonraki - 1].ad))}</b> → <b>${esc(bas(liste[yer.sonraki].ad))}</b> (${metre(yer.metre)})`
          : `<b>${esc(bas(liste[0].ad))}</b> durağına ${metre(yer.metre)}`
      }</div></div>`;
    }

    const hd = mc.hedefDurak(p.hat, a.yon);
    if (hd && s >= 0) {
      const t = tah(hd.i);
      kart += `<div class="kart" style="background:var(--vurgu-yumusak)">
        <div class="alt">${hd.secili ? "Durağınıza" : "Size en yakın durağa"} (${esc(bas(hd.d.ad))})</div>
        ${
          t
            ? `<div class="bas" style="color:var(--vurgu);font-size:20px">${t.dakika <= 1 ? "geliyor" : "~" + t.dakika + " dk"} <span class="alt">${t.durakSayisi} durak · ${metre(t.metre)} · ${saat(simdi + t.dakika)}</span></div>`
            : `<div class="alt">Durağınızı geçti</div>`
        }
      </div>`;
    }

    if (s >= 0) {
      const son = liste.length - 1;
      const satirlar = [];
      for (let i = s; i <= son && satirlar.length < 5; i++) {
        const t = tah(i);
        if (t) {
          satirlar.push(`<div class="alt" style="justify-content:space-between;width:100%"><span>${esc(bas(liste[i].ad))}</span><b style="color:var(--yazi)">${saat(simdi + t.dakika)}</b></div>`);
        }
      }
      const yuzde = Math.round((s / Math.max(1, son)) * 100);
      kart += `
        <div class="baslik-satir" style="margin:6px 0 4px"><h3>Sıradaki Duraklar</h3><span class="soluk">${son - s + 1} kaldı</span></div>
        ${satirlar.join("")}
        <div class="doluluk-bar"><span style="width:${yuzde}%;background:${esc(v.renk)}"></span></div>
        <div class="alt" style="justify-content:space-between"><span>${esc(bas(liste[0].ad))}</span><span>%${yuzde}</span></div>`;
    }

    kart += `
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn" style="flex:1" data-ak="takip">${mc.getTakipArac() === key ? "✓ Takip ediliyor" : "Haritada takip et"}</button>
        <button class="btn birincil" style="flex:1" data-ak="hat" data-akhat="${esc(p.hat)}" data-akyon="${esc(a.yon)}">Hat sayfası ›</button>
      </div>
    </div>`;

    return baslik + kart;
  }

  return { renderList, renderLine, renderVehicle };
}
