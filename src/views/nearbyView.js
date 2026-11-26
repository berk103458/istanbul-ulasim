/**
 * İstanbul Ulaşım v4.0 — Yakınımda (Nearby Stops, Hubs, Favorite Lines)
 */
import L from "leaflet";
import { Zaman } from "../core/time.js";
import { Core } from "../core/geo.js";
import { API } from "../core/api.js";
import { iconSvg } from "../ui/icons.js";
import { esc, bas, metre, renkKod, sureEtiket, hataMesaji } from "../map/mapController.js";

export const HIZLI_SEMTLER = [
  { ad: "Kadıköy", lat: 40.9904, lon: 29.0235 },
  { ad: "Beşiktaş", lat: 41.0422, lon: 29.0067 },
  { ad: "Eminönü", lat: 41.0175, lon: 28.9708 },
  { ad: "Taksim", lat: 41.037, lon: 28.9851 },
  { ad: "Üsküdar", lat: 41.0258, lon: 29.0152 },
  { ad: "Bakırköy", lat: 40.9803, lon: 28.8723 },
  { ad: "Mecidiyeköy", lat: 41.0669, lon: 28.9958 },
];

export function otobusSatiriHTML(hat, x) {
  return `
    <div class="kart satir tik" data-odakla="${esc(hat)}/${esc(x.bus.kapino)}">
      <div class="kart-sol">
        <div class="bas">
          ${x.t.durakSayisi === 0 ? "Sıradaki durak" : `${x.t.durakSayisi} durak`}
          ${x.gozlenen ? '<span class="canli">CANLI</span>' : ""}
        </div>
        <div class="alt">
          <span>${metre(x.t.metre)} uzakta</span>
          <span>· ${esc(x.bus.kapino)}</span>
          ${x.gozlenen ? "<span>· trafik hesaba katıldı</span>" : ""}
        </div>
      </div>
      <div class="kart-sag">${sureEtiket(x.t.dakika)}</div>
    </div>`;
}

export function createNearbyView(S, mc, callbacks) {
  async function render(p, ilk, no) {
    if (ilk) {
      callbacks.onYukle("Yakınımda", false);
      mc.aktifHatlarAyarla(S.favoriler);
    }

    if ((ilk || !S.ben) && !S.semt) {
      await mc.benimKonum(true);
    }

    const refPoint = S.semt || S.ben;
    const favs = S.favoriler.slice();

    // Fetch announcements + favorite lines in parallel
    const duyuruPromise = API.iett.duyurular ? API.iett.duyurular().catch(() => []) : Promise.resolve([]);
    const [duyurular, hatalarRaw] = await Promise.all([
      duyuruPromise,
      Promise.all(
        favs.map(async (h) => {
          try {
            await mc.hatHazirla(h);
            if (!S.hatVeri[h].otobusler) {
              mc.konumIsle(h, await API.iett.konum(h));
            }
            mc.aracCiz(h);
            return null;
          } catch (e) {
            return `${h}: ${hataMesaji(e)}`;
          }
        })
      ),
    ]);

    if (no !== callbacks.getCizimNo()) return null;
    const hatalar = hatalarRaw.filter(Boolean);
    const duyuruSet = new Set((duyurular || []).map((d) => String(d.hat || d.HATKODU || "").trim()).filter(Boolean));

    if (ilk) {
      mc.katman.clearLayers();
      mc.durakKatmani.clearLayers();
      const gor = new Set();
      for (const h of favs) {
        for (const l of Object.values(S.hatVeri[h]?.duraklar || {})) {
          for (const d of l) {
            if (gor.has(d.kod)) continue;
            gor.add(d.kod);
            L.circleMarker([d.lat, d.lon], {
              radius: 4.5,
              color: S.hatVeri[h].renk,
              weight: 2,
              fillColor: "#fff",
              fillOpacity: 1,
            })
              .bindPopup(() => mc.durakPopup(h, d))
              .addTo(mc.durakKatmani);
          }
        }
      }
      mc.zoomAyarla();
    }

    mc.hedefKatmani.clearLayers();
    const noktalar = refPoint ? [[refPoint.lat, refPoint.lon]] : [];

    // Header & status
    let html = callbacks.baslikHTML("Yakınımda", false);

    if (S.semt) {
      html += `<div class="alt" style="margin-bottom:8px">${iconSvg("konum", 14)} <b style="color:var(--yazi)">${esc(S.semt.ad)}</b> merkezi seçili · <button class="btn kucuk" data-semt-temizle>Konumuma dön</button></div>`;
    } else if (S.ben) {
      html += `<div class="alt" style="margin-bottom:8px">Konumunuz ±${Math.round(S.ben.acc || 0)} m <span class="canli">CANLI</span></div>`;
    } else {
      html += `<div class="alt" style="margin-bottom:8px">Konum alınamadı. Haritadan ${iconSvg("konum", 13)} konumunuzu açın veya aşağıdan bir semt seçin.</div>`;
    }

    if (S.konumHata) {
      html += `<div class="duyuru hata"><span class="duyuru-ikon">${iconSvg("alert", 18)}</span><span>${esc(S.konumHata)}</span></div>`;
    }
    if (hatalar.length) {
      html += `<div class="duyuru"><span class="duyuru-ikon">${iconSvg("alert", 18)}</span><span>${hatalar.map(esc).join("<br>")}</span></div>`;
    }

    // Quick Hub Chips (Hızlı Semt Seç)
    html += `
      <div class="hizli-yerler" aria-label="Hızlı Semt Seç">
        ${HIZLI_SEMTLER.map(
          (s) =>
            `<button class="cip ${S.semt?.ad === s.ad ? "aktif" : ""}" data-semt="${esc(s.ad)}">${esc(s.ad)}</button>`
        ).join("")}
      </div>`;

    // Nearby Stops & Stations around refPoint
    let yakinHTML = "";
    if (refPoint) {
      const [trStops, metroIst, metroHat, mrIst, iskeleler] = await Promise.all([
        API.transitous?.yakinDuraklar ? API.transitous.yakinDuraklar(refPoint.lat, refPoint.lon).catch(() => []) : Promise.resolve([]),
        API.metro.istasyonlar().catch(() => []),
        API.metro.hatlar().catch(() => []),
        typeof API.marmaray?.istasyonlar === "function"
          ? API.marmaray.istasyonlar().catch(() => [])
          : Promise.resolve(API.marmaray?.istasyonlar || []),
        API.iskeleler().catch(() => []),
      ]);

      if (no !== callbacks.getCizimNo()) return null;

      const yakinDuraklar = [];

      // Bus stops from Transitous
      for (const st of trStops || []) {
        const lat = Number(st.lat);
        const lon = Number(st.lon);
        if (!isFinite(lat) || !isFinite(lon)) continue;
        const m = Core.mesafe(refPoint, { lat, lon });
        if (m > 1200) continue;
        yakinDuraklar.push({
          tur: "otobus",
          ad: bas(st.name || st.ad || "Durak"),
          kod: st.code || st.kod || "",
          stopId: st.stopId || st.id || "",
          lat,
          lon,
          m,
          alt: "Otobüs Durağı",
          renk: "var(--mod-otobus)",
        });
      }

      // Metro / Tram / Funicular stations
      const hatMap = new Map((metroHat || []).map((h) => [h.id, h]));
      for (const s of metroIst || []) {
        const m = Core.mesafe(refPoint, s);
        if (m > 1500) continue;
        const h = hatMap.get(s.hatId);
        yakinDuraklar.push({
          tur: "rayli",
          id: s.id,
          ad: s.ad,
          hat: s.hat,
          lat: s.lat,
          lon: s.lon,
          m,
          alt: `${s.hat} · Raylı Sistem`,
          renk: h?.renk || "var(--mod-metro)",
        });
      }

      // Marmaray stations
      for (const s of mrIst || []) {
        const m = Core.mesafe(refPoint, s);
        if (m > 1500) continue;
        yakinDuraklar.push({
          tur: "marmaray",
          id: "mr:" + s.ad,
          ad: s.ad,
          hat: "MR",
          lat: s.lat,
          lon: s.lon,
          m,
          alt: "Marmaray",
          renk: "var(--mod-marmaray)",
        });
      }

      // Vapur piers
      for (const p of iskeleler || []) {
        const m = Core.mesafe(refPoint, p);
        if (m > 1500) continue;
        yakinDuraklar.push({
          tur: "vapur",
          ad: p.ad,
          hat: "Vapur",
          lat: p.lat,
          lon: p.lon,
          m,
          alt: `${p.op || "Şehir Hatları"} İskelesi`,
          renk: "var(--mod-vapur)",
        });
      }

      yakinDuraklar.sort((a, b) => a.m - b.m);
      const gosterilen = yakinDuraklar.slice(0, 8);
      callbacks.setNearbyCache(gosterilen);

      if (gosterilen.length) {
        if (ilk) {
          for (const d of gosterilen) {
            noktalar.push([d.lat, d.lon]);
            L.circleMarker([d.lat, d.lon], {
              radius: 6,
              color: "#fff",
              weight: 2,
              fillColor: d.renk.startsWith("var(") ? "#0f62fe" : d.renk,
              fillOpacity: 0.95,
            })
              .bindTooltip(esc(d.ad))
              .addTo(mc.katman);
          }
        }
        yakinHTML += `<div class="baslik-satir"><h2>Yakındaki Duraklar &amp; İstasyonlar</h2><span class="soluk">${gosterilen.length} nokta</span></div>`;
        yakinHTML += `<div class="liste">${gosterilen
          .map((d, idx) => {
            const ikonAd = d.tur === "vapur" ? "vapur" : d.tur === "marmaray" ? "marmaray" : d.tur === "rayli" ? "metro" : "busStop";
            return `
              <div class="kart satir tik" data-yakin-durak="${idx}">
                <div class="kart-sol">
                  <div class="bas">
                    <span class="rozet" style="background:${esc(d.renk)}">${iconSvg(ikonAd, 13)} ${esc(d.hat || "Durak")}</span>
                    <span>${esc(d.ad)}</span>
                  </div>
                  <div class="alt">${esc(d.alt)}</div>
                </div>
                <div class="kart-sag">
                  <span class="sure tarife">${metre(d.m)}</span>
                  ${iconSvg("chevronRight", 16)}
                </div>
              </div>`;
          })
          .join("")}</div>`;
      }
    }

    // Favorite Lines
    let favHTML = `<div class="baslik-satir"><h2>Favori Hatlarım</h2><span class="soluk">${favs.length} hat</span></div>`;
    if (!favs.length) {
      favHTML += `<div class="bos">Henüz favori hat yok. Otobüs sekmesinden hat arayıp yıldız ile ekleyin.</div>`;
    } else {
      favHTML += `<div class="liste">`;
      for (const hat of favs) {
        const v = S.hatVeri[hat];
        const duyuruVar = duyuruSet.has(hat);
        const duyuruBadge = duyuruVar ? `<span class="rozet" style="background:var(--uyari)">${iconSvg("alert", 12)} Duyuru</span>` : "";

        if (!v?.duraklar || !Object.keys(v.duraklar).length) {
          favHTML += `
            <div class="kart satir tik" data-hat="${esc(hat)}">
              <div class="kart-sol">
                <div class="bas"><span class="rozet" style="background:${renkKod(hat)}">${esc(hat)}</span>${duyuruBadge}<span class="alt">Hat verisi alınamadı</span></div>
              </div>
              <div class="kart-sag">${iconSvg("chevronRight", 16)}</div>
            </div>`;
          continue;
        }

        for (const yon of Object.keys(v.duraklar).sort()) {
          const liste = v.duraklar[yon];
          // Use refPoint temporarily if S.ben isn't set or S.semt is active
          const origBen = S.ben;
          if (S.semt) S.ben = S.semt;
          const h = mc.hedefDurak(hat, yon);
          S.ben = origBen;

          let govde = "";
          if (!h) {
            govde = `<div class="alt">Konum ya da seçili durak yok.</div>`;
          } else {
            noktalar.push([h.d.lat, h.d.lon]);
            mc.durakIsaretle(hat, h.d, v.renk);
            const gel = mc.yaklasanOtobusler(hat, yon, h.i).slice(0, 3);
            if (gel[0]) {
              const a = S.arac.get(hat + "/" + gel[0].bus.kapino);
              if (a) noktalar.push([a.gor.lat, a.gor.lon]);
            }
            govde = `<div class="alt">${h.secili ? "Durağım" : "En yakın durak"}: <b style="color:var(--yazi)">${esc(bas(h.d.ad))}</b>${h.metre != null ? " · " + metre(h.metre) : ""}</div>`;
            govde +=
              `<div class="liste" style="margin-top:4px">` +
              (gel.length ? gel.map((x) => otobusSatiriHTML(hat, x)).join("") : `<div class="alt">Bu yönde yaklaşan otobüs yok</div>`) +
              `</div>`;
          }

          favHTML += `
            <div class="kart">
              <div class="bas tik" data-hat="${esc(hat)}" style="justify-content:space-between">
                <span style="display:flex;align-items:center;gap:8px;min-width:0">
                  <span class="rozet" style="background:${esc(v.renk)}">${esc(hat)}</span>
                  <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">→ ${esc(bas(liste[liste.length - 1].ad))}</span>
                  ${duyuruBadge}
                </span>
                ${iconSvg("chevronRight", 16)}
              </div>
              ${govde}
            </div>`;
        }
      }
      favHTML += `</div>`;
    }

    if (no !== callbacks.getCizimNo()) return null;

    if (ilk && noktalar.length) {
      mc.sigdir(noktalar, 15);
    }

    return (
      html +
      yakinHTML +
      favHTML +
      `<p class="alt" style="margin-top:14px">Otobüs süreleri son dakikalardaki gerçek hıza ve güzergah mesafesine göre hesaplanır.</p>`
    );
  }

  return { render };
}
