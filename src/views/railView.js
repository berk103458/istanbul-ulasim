/**
 * İstanbul Ulaşım v4.0 — Raylı Sistem (Marmaray 43 İstasyon, Metro, Tramvay, Füniküler, Teleferik)
 */
import L from "leaflet";
import { Zaman } from "../core/time.js";
import { Core } from "../core/geo.js";
import { API } from "../core/api.js";
import { Plan } from "../core/router.js";
import { iconSvg } from "../ui/icons.js";
import { esc, metre, saat, hataMesaji } from "../map/mapController.js";

// Fallback Marmaray stations if API.marmaray.istasyonlar is unavailable
const FALLBACK_MARMARAY = [
  ["Gebze", 40.78425, 29.40956, 0], ["Darıca", 40.79142, 29.39184, 2.8], ["Osmangazi", 40.79927, 29.38001, 4.8],
  ["Fatih", 40.80763, 29.36393, 7.3], ["Çayırova", 40.8105, 29.34751, 9.4], ["Tuzla", 40.82995, 29.32236, 13.9],
  ["İçmeler", 40.84565, 29.30006, 17.6], ["Aydıntepe", 40.85229, 29.29317, 19.1], ["Güzelyalı", 40.85685, 29.2835, 20.7],
  ["Tersane", 40.86098, 29.27336, 22.4], ["Kaynarca", 40.8713, 29.25603, 25.1], ["Pendik", 40.88021, 29.23167, 28.6],
  ["Yunus", 40.8845, 29.21054, 31.3], ["Kartal", 40.88861, 29.19119, 33.9], ["Başak", 40.89056, 29.17735, 36.1],
  ["Atalar", 40.89859, 29.16945, 37.9], ["Cevizli", 40.91002, 29.15605, 40.4], ["Maltepe", 40.92065, 29.13353, 43.6],
  ["Süreyya Plajı", 40.92683, 29.1242, 45.3], ["İdealtepe", 40.93781, 29.11426, 47.5], ["Küçükyalı", 40.94626, 29.10682, 49.5],
  ["Bostancı", 40.9538, 29.09506, 51.6], ["Suadiye", 40.96048, 29.08442, 53.6], ["Erenköy", 40.97141, 29.07647, 55.9],
  ["Göztepe", 40.97916, 29.06256, 58.3], ["Feneryolu", 40.9787, 29.04901, 60.1], ["Söğütlüçeşme", 40.9909, 29.03763, 62.6],
  ["Ayrılıkçeşme", 41.00014, 29.03014, 64.6], ["Üsküdar", 41.02576, 29.01379, 70], ["Sirkeci", 41.01355, 28.97705, 74.8],
  ["Yenikapı", 41.00478, 28.94958, 78.5], ["Kazlıçeşme", 40.99269, 28.91688, 83.2], ["Zeytinburnu", 40.98587, 28.90545, 85.2],
  ["Yenimahalle", 40.98174, 28.88105, 88.4], ["Bakırköy", 40.98027, 28.87232, 89.7], ["Ataköy", 40.98022, 28.85623, 91.7],
  ["Yeşilyurt", 40.96548, 28.83728, 95.4], ["Yeşilköy", 40.96266, 28.82488, 97.1], ["Florya Akvaryum", 40.96777, 28.79705, 100.7],
  ["Florya", 40.97296, 28.78748, 102.3], ["Küçükçekmece", 40.98853, 28.77295, 105.8], ["Mustafa Kemal", 41.00628, 28.77395, 109.1],
  ["Halkalı", 41.01784, 28.76644, 111.6],
].map(([ad, lat, lon, dk], sira) => ({ id: "mr:" + ad, ad, lat, lon, dk, sira }));

async function getMarmarayStations() {
  try {
    const raw =
      typeof API.marmaray?.istasyonlar === "function"
        ? await API.marmaray.istasyonlar()
        : API.marmaray?.istasyonlar;
    if (Array.isArray(raw) && raw.length) {
      return raw.map((s, i) => ({
        id: s.id || "mr:" + s.ad,
        ad: s.ad,
        lat: s.lat,
        lon: s.lon,
        dk: s.dk ?? i * 2.6,
        sira: s.sira ?? i,
      }));
    }
  } catch {
    // fallback
  }
  return FALLBACK_MARMARAY;
}

function marmarayNextDepartures(stationIndex, stations, direction, count = 6) {
  const simdi = Zaman.simdi();
  const st = stations[stationIndex];
  const totalDk = stations[stations.length - 1].dk;
  const offset = direction === "halkali" ? st.dk : totalDk - st.dk;
  const pendikIdx = stations.findIndex((s) => s.ad === "Pendik");
  const atakoyIdx = stations.findIndex((s) => s.ad === "Ataköy");
  const inShortLoop = stationIndex >= pendikIdx && stationIndex <= atakoyIdx;

  // 15-min full loop (Gebze-Halkalı), 8-min inner loop (Pendik-Ataköy)
  const times = [];
  const step = inShortLoop ? 8 : 15;
  for (let k = 360; k <= 1440; k += step) {
    const arr = Math.round(k + offset);
    if (arr >= simdi && arr <= 1480) {
      times.push({ dk: arr, tur: inShortLoop && k % 15 !== 0 ? "Pendik–Ataköy (8 dk)" : "Gebze–Halkalı (15 dk)" });
      if (times.length >= count) break;
    }
  }
  return times;
}

export function createRailView(S, mc, callbacks) {
  async function renderList(p, ilk) {
    if (ilk) {
      callbacks.onYukle("Raylı Sistem", false);
      mc.aktifHatlarAyarla([]);
    }
    const [hatlar, durum, mrIst] = await Promise.all([
      API.metro.hatlar(),
      API.metro.durum(),
      getMarmarayStations(),
    ]);

    const q = (S.rayliArama || "").trim().toLocaleLowerCase("tr");
    const grup = (h) => ({ tram: "Tramvay", tf: "Teleferik", fun: "Füniküler", metro: "Metro" }[Plan.turOf(h.ad)]);

    let html = callbacks.baslikHTML("Raylı Sistem", false);
    html += `
      <div class="arama-kutu">
        <span class="arama-ikon">${iconSvg("search", 17)}</span>
        <input class="giris" id="rayliAra" placeholder="Hat veya istasyon ara (Marmaray, M2, T1…)" value="${esc(S.rayliArama || "")}" autocomplete="off">
      </div>`;

    if (durum.length) {
      html += durum
        .map(
          (d) =>
            `<div class="duyuru"><span class="duyuru-ikon">${iconSvg("alert", 18)}</span><span><b>${esc(d.hat)}</b> · ${esc(d.metin)}</span></div>`
        )
        .join("");
    }

    // Marmaray Section
    const mrMatch = !q || "marmaray gebze halkalı".includes(q) || mrIst.some((s) => s.ad.toLocaleLowerCase("tr").includes(q));
    if (mrMatch) {
      html += `<div class="baslik-satir"><h2>Marmaray</h2><span class="soluk">${mrIst.length} istasyon</span></div>`;
      html += `
        <div class="liste">
          <div class="kart satir tik" data-rhat="MR">
            <div class="kart-sol">
              <div class="bas">
                <span class="rozet marmaray">${iconSvg("marmaray", 13)} MR</span>
                <span>Gebze – Halkalı (Marmaray)</span>
              </div>
              <div class="alt">06:00 – 00:00 · 8 dk (Pendik–Ataköy) / 15 dk (Tam hat)</div>
            </div>
            <div class="kart-sag">${iconSvg("chevronRight", 16)}</div>
          </div>
        </div>`;
    }

    // Metro, Tramvay, Füniküler, Teleferik
    for (const g of ["Metro", "Tramvay", "Füniküler", "Teleferik"]) {
      const l = hatlar.filter((h) => {
        if (grup(h) !== g) return false;
        if (!q) return true;
        return h.ad.toLocaleLowerCase("tr").includes(q) || h.uzun.toLocaleLowerCase("tr").includes(q);
      });
      if (!l.length) continue;

      const ikonAd = g === "Tramvay" ? "tram" : g === "Füniküler" ? "fun" : g === "Teleferik" ? "tf" : "metro";
      html += `<div class="baslik-satir"><h2>${g}</h2><span class="soluk">${l.length} hat</span></div>`;
      html += `<div class="liste">${l
        .map(
          (h) => `
          <div class="kart satir tik" data-rhat="${esc(h.id)}">
            <div class="kart-sol">
              <div class="bas">
                <span class="rozet" style="background:${esc(h.renk)}">${iconSvg(ikonAd, 13)} ${esc(h.ad)}</span>
                <span>${esc(h.uzun.replace(/\s*(Metro|Tramvay|Füniküler|Teleferik)?\s*Hattı$/i, ""))}</span>
              </div>
              <div class="alt">
                ${h.ilk && h.son ? `İlk ${esc(h.ilk)} · Son ${esc(h.son)}` : ""}
                ${durum.some((d) => d.hatId === h.id) ? " · ⚠️ Duyuru var" : ""}
              </div>
            </div>
            <div class="kart-sag">${iconSvg("chevronRight", 16)}</div>
          </div>`
        )
        .join("")}</div>`;
    }

    return html;
  }

  async function renderLine(p, ilk) {
    if (p.id === "MR") {
      return renderMarmarayLine(p, ilk);
    }

    const hatlar = await API.metro.hatlar();
    const hat = hatlar.find((h) => h.id === p.id);
    if (!hat) {
      return callbacks.baslikHTML("Hat Bulunamadı", true) + `<div class="bos">Raylı sistem hattı bulunamadı.</div>`;
    }
    if (ilk) {
      callbacks.onYukle(esc(hat.ad), true);
      mc.aktifHatlarAyarla([]);
    }
    const ist = (await API.metro.istasyonlar()).filter((s) => s.hatId === p.id).sort((a, b) => a.sira - b.sira);
    const durum = (await API.metro.durum()).filter((d) => d.hatId === p.id);

    if (ilk) {
      const ll = ist.map((s) => [s.lat, s.lon]);
      L.polyline(ll, { color: hat.renk, weight: 4, opacity: 0.85, interactive: false }).addTo(mc.katman);
      ist.forEach((s) =>
        L.circleMarker([s.lat, s.lon], {
          radius: 4.5,
          color: hat.renk,
          weight: 2,
          fillColor: "#fff",
          fillOpacity: 1,
        })
          .bindTooltip(esc(s.ad))
          .on("click", () => callbacks.git({ tur: "ist", id: s.id }))
          .addTo(ist.length > 12 ? mc.durakKatmani : mc.katman)
      );
      mc.zoomAyarla();
      mc.sigdir(ll);
      mc.rayliTahminiHazirla(hat, ist)
        .then((sf) => {
          if (callbacks.sayfa() === p) {
            const s = Zaman.simdi();
            p.trenSayisi = sf.filter((x) => s >= x.t[0] && s <= x.t[x.t.length - 1]).length;
            mc.tahminiAyarla({ seferler: sf });
            callbacks.panelYenile();
          }
        })
        .catch(() => {});
    }

    let yakinId = null;
    if (S.ben && ist.length) yakinId = ist[Core.enYakinIndex(ist, S.ben).index].id;

    let html = callbacks.baslikHTML(
      `<span class="rozet" style="background:${esc(hat.renk)}">${esc(hat.ad)}</span> <span style="font-size:15px">${esc(hat.uzun)}</span>`,
      true
    );
    html += durum
      .map((d) => `<div class="duyuru"><span class="duyuru-ikon">${iconSvg("alert", 18)}</span><span>${esc(d.metin)}</span></div>`)
      .join("");
    html += `<div class="alt" style="margin-bottom:8px">İlk ${esc(hat.ilk || "–")} · Son ${esc(hat.son || "–")}${
      p.trenSayisi != null ? ` · Haritada ${p.trenSayisi} tahmini tren` : ""
    }</div>`;
    html += `<div class="baslik-satir"><h2>İstasyonlar (${ist.length})</h2><span class="soluk">Seferler için dokunun</span></div>`;
    html += `<div class="kart"><ol class="duraklar">${ist
      .map(
        (s) =>
          `<li data-ist="${esc(s.id)}" class="tik ${s.id === yakinId ? "aktif" : ""}"><span>${esc(s.ad)}</span>${
            s.id === yakinId ? `<span class="sure yakin">${metre(Core.mesafe(S.ben, s))}</span>` : ""
          }</li>`
      )
      .join("")}</ol></div>`;
    return html;
  }

  async function renderMarmarayLine(p, ilk) {
    if (ilk) {
      callbacks.onYukle("MR · Marmaray", true);
      mc.aktifHatlarAyarla([]);
    }
    const ist = await getMarmarayStations();
    if (ilk) {
      const ll = ist.map((s) => [s.lat, s.lon]);
      L.polyline(ll, { color: "#1d4ed8", weight: 4.5, opacity: 0.9, interactive: false }).addTo(mc.katman);
      ist.forEach((s) =>
        L.circleMarker([s.lat, s.lon], {
          radius: 4.5,
          color: "#1d4ed8",
          weight: 2,
          fillColor: "#fff",
          fillOpacity: 1,
        })
          .bindTooltip(esc(s.ad))
          .on("click", () => callbacks.git({ tur: "ist", id: s.id }))
          .addTo(mc.durakKatmani)
      );
      mc.zoomAyarla();
      mc.sigdir(ll);
      const sf = mc.marmarayTahminiHazirla();
      const s = Zaman.simdi();
      p.trenSayisi = sf.filter((x) => s >= x.t[0] && s <= x.t[x.t.length - 1]).length;
      mc.tahminiAyarla({ seferler: sf });
    }

    let yakinId = null;
    if (S.ben && ist.length) yakinId = ist[Core.enYakinIndex(ist, S.ben).index].id;

    let html = callbacks.baslikHTML(
      `<span class="rozet marmaray">${iconSvg("marmaray", 14)} MR</span> <span style="font-size:15px">Marmaray (Gebze – Halkalı)</span>`,
      true
    );
    html += `<div class="alt" style="margin-bottom:8px">06:00 – 00:00 · 8 dk / 15 dk aralık · Haritada ${p.trenSayisi ?? 0} tahmini tren</div>`;
    html += `<div class="baslik-satir"><h2>İstasyonlar (${ist.length})</h2><span class="soluk">Seferler için dokunun</span></div>`;
    html += `<div class="kart"><ol class="duraklar">${ist
      .map(
        (s) =>
          `<li data-ist="${esc(s.id)}" class="tik ${s.id === yakinId ? "aktif" : ""}"><span>${esc(s.ad)}</span>${
            s.id === yakinId ? `<span class="sure yakin">${metre(Core.mesafe(S.ben, s))}</span>` : ""
          }</li>`
      )
      .join("")}</ol></div>`;
    return html;
  }

  async function renderStation(p, ilk, no) {
    if (String(p.id).startsWith("mr:")) {
      return renderMarmarayStation(p, ilk);
    }

    const [hatlar, tum] = await Promise.all([API.metro.hatlar(), API.metro.istasyonlar()]);
    const s = tum.find((x) => x.id === p.id);
    const hat = s && hatlar.find((h) => h.id === s.hatId);
    if (!s || !hat) {
      return callbacks.baslikHTML("İstasyon Bulunamadı", true) + `<div class="bos">İstasyon verisi alınamadı.</div>`;
    }

    if (ilk) {
      callbacks.onYukle(esc(s.ad), true);
      mc.aktifHatlarAyarla([]);
      mc.map.setView([s.lat, s.lon], 15);
      L.circleMarker([s.lat, s.lon], { radius: 9, color: hat.renk, weight: 3, fillColor: hat.renk, fillOpacity: 0.9 }).addTo(mc.katman);
      const ist = tum.filter((x) => x.hatId === s.hatId).sort((a, b) => a.sira - b.sira);
      L.polyline(ist.map((x) => [x.lat, x.lon]), { color: hat.renk, weight: 4, opacity: 0.6, interactive: false }).addTo(mc.katman);
      mc.rayliTahminiHazirla(hat, ist)
        .then((sf) => {
          if (callbacks.sayfa() === p) mc.tahminiAyarla({ seferler: sf });
        })
        .catch(() => {});
    }

    const yonler = await API.metro.yonler(s.hatId);
    const ss = await Promise.all(
      yonler.map((y) => API.metro.saatler(s.id, s.hatId, y.id).then((t) => ({ y, t }), (e) => ({ y, e })))
    );
    if (no !== callbacks.getCizimNo()) return null;

    const aktarma = tum.filter((x) => x.hatId !== s.hatId && Core.mesafe(x, s) < 250);
    let html = callbacks.baslikHTML(`<span class="rozet" style="background:${esc(hat.renk)}">${esc(hat.ad)}</span> ${esc(s.ad)}`, true);
    if (S.ben) html += `<div class="alt" style="margin-bottom:8px">Size ${metre(Core.mesafe(S.ben, s))} uzakta</div>`;

    for (const { y, t, e } of ss) {
      html += `<div class="baslik-satir"><h2>→ ${esc(t?.hedef || y.ad.split("->").pop())}</h2></div><div class="kart" style="margin-bottom:10px">`;
      if (e) {
        html += `<div class="duyuru hata"><span class="duyuru-ikon">${iconSvg("alert", 16)}</span><span>${esc(hataMesaji(e))}</span></div>`;
      } else if (!t.saatler.length) {
        html += `<div class="alt">Bu yönde yakın zamanda sefer yok.</div>`;
      } else {
        html += `<div class="alt">Sıradaki tren <b style="color:var(--yazi)">${esc(t.saatler[0])}</b> · ${Zaman.kalanYazi(Zaman.kalan(t.saatler[0]))} sonra</div>`;
        html += `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">${t.saatler
          .map((x, i) => `<span class="sure ${i === 0 ? "" : "tarife"}">${esc(x)}</span>`)
          .join("")}</div>`;
      }
      html += `</div>`;
    }

    if (aktarma.length) {
      html += `<div class="baslik-satir"><h2>Aktarma</h2></div><div class="liste">${aktarma
        .map((x) => {
          const h = hatlar.find((q) => q.id === x.hatId);
          return `<div class="kart satir tik" data-ist="${esc(x.id)}"><div class="kart-sol"><div class="bas"><span class="rozet" style="background:${esc(h?.renk || "#333")}">${esc(x.hat)}</span> ${esc(x.ad)}</div></div><div class="kart-sag">${iconSvg("chevronRight", 16)}</div></div>`;
        })
        .join("")}</div>`;
    }

    return html;
  }

  async function renderMarmarayStation(p, ilk) {
    const ad = String(p.id).slice(3);
    const [ist, metroIst, metroHat] = await Promise.all([
      getMarmarayStations(),
      API.metro.istasyonlar().catch(() => []),
      API.metro.hatlar().catch(() => []),
    ]);
    const idx = ist.findIndex((s) => s.ad === ad);
    const s = ist[idx];
    if (!s) {
      return callbacks.baslikHTML("Marmaray İstasyonu", true) + `<div class="bos">İstasyon bulunamadı.</div>`;
    }

    if (ilk) {
      callbacks.onYukle(esc(s.ad), true);
      mc.aktifHatlarAyarla([]);
      mc.map.setView([s.lat, s.lon], 15);
      L.circleMarker([s.lat, s.lon], { radius: 9, color: "#1d4ed8", weight: 3, fillColor: "#1d4ed8", fillOpacity: 0.9 }).addTo(mc.katman);
      L.polyline(ist.map((x) => [x.lat, x.lon]), { color: "#1d4ed8", weight: 4, opacity: 0.65, interactive: false }).addTo(mc.katman);
      mc.tahminiAyarla({ seferler: mc.marmarayTahminiHazirla() });
    }

    const simdi = Zaman.simdi();
    const halkali = idx < ist.length - 1 ? marmarayNextDepartures(idx, ist, "halkali", 6) : [];
    const gebze = idx > 0 ? marmarayNextDepartures(idx, ist, "gebze", 6) : [];
    const hatMap = new Map((metroHat || []).map((h) => [h.id, h]));
    const aktarma = (metroIst || []).filter((x) => Core.mesafe(x, s) < 350);

    let html = callbacks.baslikHTML(`<span class="rozet marmaray">${iconSvg("marmaray", 14)} MR</span> ${esc(s.ad)}`, true);
    if (S.ben) html += `<div class="alt" style="margin-bottom:8px">Size ${metre(Core.mesafe(S.ben, s))} uzakta</div>`;

    const yonKutu = (baslik, liste) => {
      if (!liste.length) return "";
      const ilkK = liste[0];
      return `
        <div class="baslik-satir"><h2>→ ${esc(baslik)}</h2><span class="soluk">${esc(ilkK.tur)}</span></div>
        <div class="kart" style="margin-bottom:10px">
          <div class="alt">Sıradaki tren <b style="color:var(--yazi)">${saat(ilkK.dk)}</b> · ${Zaman.kalanYazi(ilkK.dk - simdi)} sonra</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
            ${liste.map((t, i) => `<span class="sure ${i === 0 ? "" : "tarife"}">${saat(t.dk)}</span>`).join("")}
          </div>
        </div>`;
    };

    html += yonKutu("Halkalı yönü", halkali);
    html += yonKutu("Gebze yönü", gebze);

    if (aktarma.length) {
      html += `<div class="baslik-satir"><h2>Aktarma</h2></div><div class="liste">${aktarma
        .map((x) => {
          const h = hatMap.get(x.hatId);
          return `<div class="kart satir tik" data-ist="${esc(x.id)}"><div class="kart-sol"><div class="bas"><span class="rozet" style="background:${esc(h?.renk || "#333")}">${esc(x.hat)}</span> ${esc(x.ad)}</div></div><div class="kart-sag">${iconSvg("chevronRight", 16)}</div></div>`;
        })
        .join("")}</div>`;
    }

    return html + `<p class="alt" style="margin-top:10px">Marmaray seferleri Pendik–Ataköy arası 8 dk, Gebze–Halkalı arası 15 dk aralıklarla işler.</p>`;
  }

  return { renderList, renderLine, renderStation };
}
