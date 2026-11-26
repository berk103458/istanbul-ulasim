/**
 * İstanbul Ulaşım v4.0 — Vapur (Şehir Hatları, İskeleler, Tarife & Tahmini Konum)
 */
import L from "leaflet";
import { Zaman } from "../core/time.js";
import { API } from "../core/api.js";
import { Plan } from "../core/router.js";
import { iconSvg } from "../ui/icons.js";
import { esc, bas } from "../map/mapController.js";

export function createFerryView(S, mc, callbacks) {
  async function renderList(p, ilk) {
    if (ilk) {
      callbacks.onYukle("Vapur · Şehir Hatları", false);
      mc.aktifHatlarAyarla([]);
    }
    const hatlar = await API.vapur.hatlar();
    const grup = S.vapurGrup || "Tümü";
    const q = (S.vapurArama || "").trim().toLocaleLowerCase("tr");

    let html = callbacks.baslikHTML("Vapur · Şehir Hatları", false);
    html += `
      <div class="arama-kutu">
        <span class="arama-ikon">${iconSvg("search", 17)}</span>
        <input class="giris" id="vapurAra" placeholder="Vapur hattı veya iskele ara…" value="${esc(S.vapurArama || "")}" autocomplete="off">
      </div>
      <div class="cip-satir" aria-label="Vapur Hat Grupları">
        ${["Tümü", "İstanbul İçi", "Boğaz", "Adalar"]
          .map((g) => `<button class="cip ${grup === g ? "aktif" : ""}" data-vapur-grup="${esc(g)}">${esc(g)}</button>`)
          .join("")}
      </div>`;

    const gruplar = grup === "Tümü" ? ["İstanbul İçi", "Boğaz", "Adalar", "Diğer"] : [grup];
    let toplam = 0;

    for (const g of gruplar) {
      const l = hatlar.filter((h) => {
        if (h.grup !== g) return false;
        if (!q) return true;
        return h.ad.toLocaleLowerCase("tr").includes(q);
      });
      if (!l.length) continue;
      toplam += l.length;

      html += `<div class="baslik-satir"><h2>${esc(g)}</h2><span class="soluk">${l.length} hat</span></div>`;
      html += `<div class="liste">${l
        .map(
          (h) => `
          <div class="kart satir tik" data-vhat="${esc(h.url)}">
            <div class="kart-sol">
              <div class="bas">
                <span class="rozet vapur">${iconSvg("vapur", 13)} Vapur</span>
                <span>${esc(bas(h.ad))}</span>
              </div>
              <div class="alt">${esc(h.grup)}</div>
            </div>
            <div class="kart-sag">${iconSvg("chevronRight", 16)}</div>
          </div>`
        )
        .join("")}</div>`;
    }

    if (!toplam) {
      html += `<div class="bos">Eşleşen vapur hattı bulunamadı.</div>`;
    }

    return (
      html +
      `<p class="alt" style="margin-top:12px">Tarifeler sehirhatlari.istanbul verisinden alınır. Hat sayfasında vapurların tahmini konumları haritada gösterilir.</p>`
    );
  }

  async function renderLine(p, ilk) {
    const hatlar = await API.vapur.hatlar();
    const h = hatlar.find((x) => x.url === p.url) || { ad: "Vapur Hattı", url: p.url };
    if (ilk) {
      callbacks.onYukle(esc(bas(h.ad)), true);
      mc.aktifHatlarAyarla([]);
    }
    const tablolar = await API.vapur.tarife(p.url);
    const simdi = Zaman.simdi();

    if (ilk) {
      API.iskeleler()
        .then((isk) => {
          if (callbacks.sayfa() !== p) return;
          const ag = Plan.kur({ iskeleler: isk, vapur: [{ ad: h.ad, tablolar }], marmaray: false });
          const pts = ag.duraklar.map((d) => [d.lat, d.lon]);
          ag.duraklar.forEach((d) =>
            L.circleMarker([d.lat, d.lon], {
              radius: 6,
              color: "#0284c7",
              weight: 3,
              fillColor: "#fff",
              fillOpacity: 1,
            })
              .bindTooltip(esc(d.ad))
              .addTo(mc.katman)
          );
          if (pts.length) mc.sigdir(pts, 14);
          mc.tahminiAyarla({
            seferler: ag.seferler.map((s) => ({
              key: "v" + s.id,
              hat: "Vapur",
              renk: "#0284c7",
              tur: "vapur",
              hedef: ag.duraklar[s.d[s.d.length - 1]].ad,
              d: s.d.map((i) => ag.duraklar[i]),
              t: s.t,
            })),
          });
        })
        .catch(() => {});
    }

    const resmiBtn = `<button class="btn kucuk" data-ac="${esc(p.url)}">Resmi sayfa</button>`;
    let html = callbacks.baslikHTML(
      `<span class="rozet vapur">${iconSvg("vapur", 14)}</span> <span style="font-size:15px">${esc(bas(h.ad))}</span>`,
      true,
      resmiBtn
    );

    if (!tablolar.length) {
      return html + `<div class="bos">Bu hat için tarife tablosu bulunamadı.</div>`;
    }

    const sirali = tablolar
      .map((t, i) => ({ t, i, uygun: Plan.tabloGunUygun(t.not) }))
      .sort((a, b) => b.uygun - a.uygun || a.i - b.i);

    for (const { t, uygun } of sirali) {
      const yok = Plan.bugunYapilmayanIsaretler(t.not);
      const satirZaman = (r) => {
        for (const c of r) {
          const v = Zaman.dk(c);
          if (v != null) return v;
        }
        return null;
      };
      let sonrakiBulundu = false;
      let gizli = 0;

      const govde = t.satirlar
        .map((r) => {
          const z = satirZaman(r);
          const iptal = Plan.satirYok(r, yok);
          let cls = "";
          let style = "";
          if (uygun && z != null && z < simdi) {
            cls = "gecti";
            style = "opacity:.4";
          } else if (iptal) {
            cls = "yok";
            style = "opacity:.4;text-decoration:line-through";
          } else if (uygun && !sonrakiBulundu && z != null) {
            cls = "siradaki";
            sonrakiBulundu = true;
          }
          if (cls === "gecti" && !p.tumu) {
            gizli++;
            return "";
          }
          return `<tr class="${cls}" style="${style}">${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`;
        })
        .join("");

      const ilkSonraki = uygun ? t.satirlar.find((r) => !Plan.satirYok(r, yok) && (satirZaman(r) ?? -1) >= simdi) : null;

      html += `<div class="baslik-satir"><h2>${esc(t.baslik)}</h2>${!uygun ? '<span class="soluk">Bugün değil</span>' : ""}</div>`;
      html += `<div class="kart" style="margin-bottom:10px">`;
      if (t.not) html += `<div class="alt">${esc(t.not)}</div>`;
      if (ilkSonraki) {
        const z = ilkSonraki.find((c) => Zaman.dk(c) != null);
        html += `<div class="alt">${iconSvg("clock", 14)} Sıradaki sefer <b style="color:var(--yazi)">${esc(z)}</b> · <span class="sure yakin">${Zaman.kalanYazi(Zaman.dk(z) - simdi)} sonra</span></div>`;
      } else if (uygun && !sonrakiBulundu && !gizli) {
        html += `<div class="alt">Bugün için kalan sefer yok.</div>`;
      }

      html += `<div style="overflow-x:auto"><table class="tarife">${t.basliklar
        .map((r) => `<tr>${r.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`)
        .join("")}${govde}</table></div>`;

      if (gizli) {
        html += `<div style="margin-top:8px"><button class="btn kucuk" data-tumu>Geçmiş ${gizli} seferi göster</button></div>`;
      } else if (p.tumu && uygun) {
        html += `<div style="margin-top:8px"><button class="btn kucuk" data-tumu>Geçmiş seferleri gizle</button></div>`;
      }
      html += `</div>`;
    }

    return (
      html +
      `<p class="alt" style="margin-top:10px">Üstü çizili seferler bugün yapılmamaktadır. Haritadaki vapurlar tarifeye göre tahmini konumdur.</p>`
    );
  }

  return { renderList, renderLine };
}
