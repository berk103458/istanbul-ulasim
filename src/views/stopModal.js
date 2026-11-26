/**
 * İstanbul Ulaşım v4.0 — Slide-up Modal (Stop Departure Board, İSPARK Detail, Settings)
 */
import { Zaman } from "../core/time.js";
import { Core } from "../core/geo.js";
import { KV } from "../core/storage.js";
import { Bridge } from "../core/bridge.js";
import { API } from "../core/api.js";
import { iconSvg } from "../ui/icons.js";
import { esc, bas, metre, saat, renkKod, sureEtiket, hataMesaji } from "../map/mapController.js";

export function createStopModal(S, mc, callbacks) {
  const modalEl = () => document.querySelector("#altModal");

  function isOpen() {
    const el = modalEl();
    return Boolean(el && !el.hasAttribute("hidden"));
  }

  function close() {
    const el = modalEl();
    if (!el) return;
    el.setAttribute("hidden", "");
    el.innerHTML = "";
  }

  function renderBox(html) {
    const el = modalEl();
    if (!el) return;
    el.innerHTML = `<div class="alt-modal-kutu" role="dialog" aria-modal="true">${html}</div>`;
    el.removeAttribute("hidden");
  }

  // Backdrop click closes modal
  document.addEventListener("click", (e) => {
    const el = modalEl();
    if (!el || el.hasAttribute("hidden")) return;
    if (e.target === el || e.target.closest("[data-modal-kapat]")) {
      close();
    }
  });

  // ---------------- 1) Durak Kalkış Panosu ----------------
  async function openStopBoard(stop) {
    const baslikAd = esc(bas(stop.ad || "Durak"));
    const mesafeYazi = S.ben && stop.lat ? ` · ${metre(Core.mesafe(S.ben, stop))}` : "";
    renderBox(`
      <div class="modal-baslik">
        <div>
          <h3>${iconSvg("busStop", 18)} ${baslikAd}</h3>
          <div class="alt">${stop.kod ? `Durak ${esc(stop.kod)}` : "Toplu Taşıma Durağı"}${mesafeYazi}</div>
        </div>
        <button class="btn ikon" data-modal-kapat aria-label="Kapat">${iconSvg("close", 18)}</button>
      </div>
      <div id="modalGovde">
        <div class="skeleton skeleton-kart"></div>
        <div class="skeleton skeleton-kart"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn" style="flex:1" data-durak-rota="nereden">${iconSvg("rota", 16)} Buradan Rota</button>
        <button class="btn birincil" style="flex:1" data-durak-rota="nereye">${iconSvg("konum", 16)} Hedef Yap</button>
      </div>
    `);

    const box = modalEl();
    box.querySelectorAll("[data-durak-rota]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const alan = btn.dataset.durakRota;
        const yer = {
          ad: bas(stop.ad),
          alt: stop.kod ? `Durak ${stop.kod}` : "Durak",
          lat: stop.lat,
          lon: stop.lon,
          tur: stop.tur || "durak",
          durak: true,
          kod: stop.kod,
        };
        close();
        callbacks.setRoutePlace(alan, yer);
      });
    });

    const govde = document.querySelector("#modalGovde");
    if (!govde) return;

    try {
      const kalkislar = [];
      const simdi = Zaman.simdi();

      // 1) Transitous stop times if available (scheduled + RT)
      const trStopId = stop.stopId || stop.id;
      if (trStopId && typeof API.transitous?.durakSaatleri === "function") {
        try {
          const st = await API.transitous.durakSaatleri(trStopId);
          for (const item of st || []) {
            const dk = item.zaman ? Zaman.dk(item.zaman) : item.iso ? Math.round((new Date(item.iso) - Date.now()) / 60000 + simdi) : null;
            const kalan = dk != null ? dk - simdi : item.kalanDk;
            if (kalan != null && kalan >= -1 && kalan <= 180) {
              kalkislar.push({
                hat: item.hat || item.routeShortName || "?",
                yon: item.yon || item.headsign || "",
                kalan: Math.max(0, Math.round(kalan)),
                saatStr: dk != null ? saat(dk) : "",
                canli: Boolean(item.canli || item.realTime),
                renk: renkKod(item.hat || item.routeShortName || ""),
              });
            }
          }
        } catch {
          // ignore Transitous stop board errors
        }
      }

      // 2) Merge live İETT GPS from cached/active network or stop's lines
      const hatlar = new Set(stop.hatlar || []);
      if (S.ag && stop.kod) {
        const idx = S.ag.duraklar.findIndex((d) => d.kod === stop.kod);
        if (idx >= 0) {
          const dd = S.ag.desenDurak[idx] || [];
          for (let q = 0; q < dd.length; q += 2) {
            const p = S.ag.desenler[dd[q]];
            if (p?.hat) hatlar.add(p.hat);
          }
        }
      }

      const hatList = [...hatlar].slice(0, 6);
      await Promise.all(
        hatList.map(async (hat) => {
          try {
            const v = await mc.hatHazirla(hat);
            if (!v.zaman || Date.now() - v.zaman > 20e3) {
              mc.konumIsle(hat, await API.iett.konum(hat));
            }
            for (const [yon, liste] of Object.entries(v.duraklar || {})) {
              const i = stop.kod
                ? liste.findIndex((d) => d.kod === stop.kod)
                : Core.enYakinIndex(liste, stop).metre < 120
                ? Core.enYakinIndex(liste, stop).index
                : -1;
              if (i < 0) continue;
              const gel = mc.yaklasanOtobusler(hat, yon, i).slice(0, 2);
              for (const g of gel) {
                kalkislar.push({
                  hat,
                  yon: bas(liste[liste.length - 1]?.ad || g.bus.yonAdi || ""),
                  kalan: g.t.dakika,
                  saatStr: saat(simdi + g.t.dakika),
                  canli: true,
                  kapino: g.bus.kapino,
                  renk: v.renk || renkKod(hat),
                });
              }
            }
          } catch {
            // ignore line error
          }
        })
      );

      if (!document.querySelector("#modalGovde")) return;

      kalkislar.sort((a, b) => a.kalan - b.kalan);
      const tekil = [];
      const gor = new Set();
      for (const k of kalkislar) {
        const key = `${k.hat}|${k.kapino || k.saatStr}`;
        if (gor.has(key)) continue;
        gor.add(key);
        tekil.push(k);
      }

      if (!tekil.length) {
        govde.innerHTML = `<div class="bos">Bu durak için yaklaşan sefer bilgisi bulunamadı.</div>`;
        return;
      }

      govde.innerHTML = `<div class="liste">${tekil
        .slice(0, 15)
        .map(
          (k) => `
          <div class="kart satir tik" data-modal-hat="${esc(k.hat)}" ${k.kapino ? `data-modal-arac="${esc(k.kapino)}"` : ""}>
            <div class="kart-sol">
              <div class="bas">
                <span class="rozet" style="background:${esc(k.renk)}">${esc(k.hat)}</span>
                <span>→ ${esc(k.yon || "Merkez")}</span>
              </div>
              <div class="alt">
                ${k.canli ? '<span class="canli">CANLI</span>' : '<span class="rozet soluk">Tarife</span>'}
                ${k.kapino ? `<span>${esc(k.kapino)}</span>` : ""}
                ${k.saatStr ? `<span>· ${esc(k.saatStr)}</span>` : ""}
              </div>
            </div>
            <div class="kart-sag">${sureEtiket(k.kalan)}</div>
          </div>`
        )
        .join("")}</div>`;

      govde.querySelectorAll("[data-modal-hat]").forEach((row) => {
        row.addEventListener("click", () => {
          const hat = row.dataset.modalHat;
          const kapino = row.dataset.modalArac;
          close();
          if (kapino) mc.aracOdakla(hat, kapino);
          else callbacks.git({ tur: "hat", hat });
        });
      });
    } catch (e) {
      if (govde) govde.innerHTML = `<div class="duyuru hata"><span class="duyuru-ikon">${iconSvg("alert", 18)}</span><span>${esc(hataMesaji(e))}</span></div>`;
    }
  }

  // ---------------- 2) İSPARK Detay ----------------
  function openIspark(park) {
    const kap = Math.max(1, park.kapasite || 0);
    const bos = Math.max(0, park.bos || 0);
    const doluOran = Math.min(100, Math.max(0, Math.round(((kap - bos) / kap) * 100)));
    const bosOran = park.kapasite > 0 ? bos / park.kapasite : 0;
    const barRenk = bosOran > 0.3 ? "var(--iyi)" : bosOran >= 0.1 ? "var(--uyari)" : "var(--hata)";
    const mesafeYazi = S.ben ? ` · ${metre(Core.mesafe(S.ben, park))}` : "";

    renderBox(`
      <div class="modal-baslik">
        <div>
          <h3>${iconSvg("ispark", 18)} ${esc(bas(park.ad))}</h3>
          <div class="alt">${esc(park.ilce || "İstanbul")}${park.tip ? ` · ${esc(park.tip)}` : ""}${mesafeYazi}</div>
        </div>
        <button class="btn ikon" data-modal-kapat aria-label="Kapat">${iconSvg("close", 18)}</button>
      </div>
      <div class="kart">
        <div class="bas" style="justify-content:space-between">
          <span>Boş Kapasite</span>
          <span class="sure ${bosOran > 0.3 ? "yakin" : ""}">${bos} / ${park.kapasite || "–"} yer</span>
        </div>
        <div class="doluluk-bar"><span style="width:${doluOran}%;background:${barRenk}"></span></div>
        <div class="alt" style="justify-content:space-between;margin-top:4px">
          <span>Doluluk %${doluOran}</span>
          <span>${park.isOpen ? "Açık" : "Kapalı"}</span>
        </div>
      </div>
      <div class="kart">
        <div class="alt">${iconSvg("clock", 14)} Çalışma Saatleri: <b style="color:var(--yazi)">${esc(park.saatler || "24 Saat")}</b></div>
        ${park.ucretsizDk ? `<div class="alt">Ücretsiz Süre: <b style="color:var(--yazi)">İlk ${esc(park.ucretsizDk)} dk</b></div>` : ""}
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn birincil" style="flex:1" id="isparkRotaBtn">${iconSvg("rota", 16)} Buraya Rota</button>
      </div>
    `);

    document.querySelector("#isparkRotaBtn")?.addEventListener("click", () => {
      close();
      callbacks.setRoutePlace("nereye", {
        ad: bas(park.ad),
        alt: "İSPARK Otopark",
        lat: park.lat,
        lon: park.lon,
        tur: "yer",
      });
    });
  }

  // ---------------- 3) Görünüm & Ayarlar ----------------
  function openSettings() {
    const tema = S.theme || "system";
    const stil = S.mapStyle || "standart";
    const proxy = S.proxyUrl || "";

    renderBox(`
      <div class="modal-baslik">
        <h3>${iconSvg("settings", 18)} Görünüm &amp; Ayarlar</h3>
        <button class="btn ikon" data-modal-kapat aria-label="Kapat">${iconSvg("close", 18)}</button>
      </div>

      <div class="baslik-satir"><h3>Tema</h3></div>
      <div class="segment" id="temaSegment">
        <button data-tema="system" class="${tema === "system" ? "aktif" : ""}">Sistem</button>
        <button data-tema="light" class="${tema === "light" ? "aktif" : ""}">${iconSvg("sun", 15)} Açık</button>
        <button data-tema="dark" class="${tema === "dark" ? "aktif" : ""}">${iconSvg("moon", 15)} Koyu</button>
      </div>

      <div class="baslik-satir"><h3>Harita Stili</h3></div>
      <div class="segment" id="haritaStilSegment">
        <button data-stil="standart" class="${stil === "standart" ? "aktif" : ""}">Standart</button>
        <button data-stil="sade" class="${stil === "sade" ? "aktif" : ""}">Sade</button>
        <button data-stil="osm" class="${stil === "osm" ? "aktif" : ""}">OSM</button>
      </div>

      <div class="baslik-satir"><h3>Gelişmiş (İsteğe Bağlı Proxy)</h3></div>
      <div class="kart" style="margin-bottom:10px">
        <div class="alt">Mobil/Web CORS için özel proxy adresi (boş bırakılabilir)</div>
        <div style="display:flex;gap:8px">
          <input class="giris" id="proxyInput" placeholder="https://ornek.vercel.app/api/proxy" value="${esc(proxy)}">
          <button class="btn" id="proxyKaydetBtn">Kaydet</button>
        </div>
      </div>

      <div class="ayar-satir tik" id="cacheTemizleBtn">
        <div class="ayar-bilgi">
          <span class="ayar-baslik">Önbelleği Temizle</span>
          <span class="ayar-alt">Kayıtlı hat, durak ve harita önbelleğini sıfırlar</span>
        </div>
        <span class="btn kucuk">${iconSvg("refresh", 14)} Temizle</span>
      </div>

      <div class="kart" style="margin-top:12px">
        <div class="bas">İstanbul Ulaşım v4.0</div>
        <div class="alt">Veri Kaynakları: İETT, Metro İstanbul, TCDD Marmaray, Şehir Hatları, İSPARK, İBB Trafik (TKM), Transitous.</div>
      </div>
    `);

    document.querySelectorAll("#temaSegment button").forEach((b) => {
      b.addEventListener("click", () => {
        callbacks.applyTheme(b.dataset.tema);
        document.querySelectorAll("#temaSegment button").forEach((x) => x.classList.toggle("aktif", x === b));
      });
    });

    document.querySelectorAll("#haritaStilSegment button").forEach((b) => {
      b.addEventListener("click", () => {
        S.mapStyle = b.dataset.stil;
        KV.set("mapStyle", S.mapStyle);
        mc.updateBaseLayer();
        document.querySelectorAll("#haritaStilSegment button").forEach((x) => x.classList.toggle("aktif", x === b));
      });
    });

    document.querySelector("#proxyKaydetBtn")?.addEventListener("click", () => {
      const val = document.querySelector("#proxyInput")?.value.trim() || "";
      S.proxyUrl = val;
      KV.set("proxyUrl", val);
      if (typeof Bridge.setProxyUrl === "function") Bridge.setProxyUrl(val);
      const btn = document.querySelector("#proxyKaydetBtn");
      if (btn) btn.textContent = "Kaydedildi ✓";
    });

    document.querySelector("#cacheTemizleBtn")?.addEventListener("click", async () => {
      try {
        if (typeof KV.clear === "function") await KV.clear();
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith("ulasim.")) localStorage.removeItem(k);
        }
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
        const alt = document.querySelector("#cacheTemizleBtn .ayar-alt");
        if (alt) alt.textContent = "Önbellek temizlendi ✓";
      } catch {
        // ignore
      }
    });
  }

  return {
    isOpen,
    close,
    openStopBoard,
    openIspark,
    openSettings,
  };
}
