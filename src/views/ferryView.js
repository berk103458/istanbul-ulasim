/**
 * İstanbul Ulaşım v5.0 — Vapur (Şehir Hatları, İskeleler, Tarife & Tahmini Konum)
 */
import L from "leaflet";
import { Zaman } from "../core/time.js";
import { API } from "../core/api.js";
import { Plan } from "../core/router.js";
import { iconSvg } from "../ui/icons.js";
import { t } from "../i18n/index.js";
import { esc, bas } from "../map/mapController.js";
import { bindKeyboardActivators } from "./a11y.js";

const GROUP_I18N = {
  "Tümü": "ferry.groupAll",
  "İstanbul İçi": "ferry.groupInner",
  "Boğaz": "ferry.groupBosphorus",
  "Adalar": "ferry.groupIslands",
  "Diğer": "ferry.groupOther",
};

function groupLabel(g) {
  return GROUP_I18N[g] ? t(GROUP_I18N[g]) : g;
}

export function createFerryView(S, mc, callbacks) {
  bindKeyboardActivators();

  async function renderList(p, ilk) {
    if (ilk) {
      callbacks.onYukle(t("ferry.title"), false);
      mc.aktifHatlarAyarla([]);
    }
    const hatlar = await API.vapur.hatlar();
    const grup = S.vapurGrup || "Tümü";
    const q = (S.vapurArama || "").trim().toLocaleLowerCase("tr");

    let html = callbacks.baslikHTML(esc(t("ferry.title")), false);
    html += `
      <div class="arama-kutu">
        <span class="arama-ikon" aria-hidden="true">${iconSvg("search", 17)}</span>
        <input type="search" class="giris" id="vapurAra" aria-label="${esc(t("ferry.searchLabel"))}" placeholder="${esc(t("ferry.searchPlaceholder"))}" value="${esc(S.vapurArama || "")}" autocomplete="off">
      </div>
      <div class="cip-satir" role="group" aria-label="${esc(t("ferry.groupsAria"))}">
        ${["Tümü", "İstanbul İçi", "Boğaz", "Adalar"]
          .map((g) => {
            const active = grup === g;
            return `<button type="button" class="cip ${active ? "aktif" : ""}" data-vapur-grup="${esc(g)}" aria-pressed="${active ? "true" : "false"}">${esc(groupLabel(g))}</button>`;
          })
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

      html += `<div class="baslik-satir"><h2>${esc(groupLabel(g))}</h2><span class="soluk">${esc(t("nearby.linesCount", { n: l.length }))}</span></div>`;
      html += `<div class="liste">${l
        .map(
          (h) => `
          <div class="kart satir tik" role="button" tabindex="0" data-vhat="${esc(h.url)}">
            <div class="kart-sol">
              <div class="bas">
                <span class="rozet vapur">${iconSvg("vapur", 13)} ${esc(t("nav.vapur"))}</span>
                <span>${esc(bas(h.ad))}</span>
              </div>
              <div class="alt">${esc(groupLabel(h.grup))}</div>
            </div>
            <div class="kart-sag">${iconSvg("chevronRight", 16)}</div>
          </div>`
        )
        .join("")}</div>`;
    }

    if (!toplam) {
      html += `<div class="bos">${esc(t("ferry.noMatch"))}</div>`;
    }

    return html + `<p class="alt" style="margin-top:12px">${esc(t("ferry.listFootnote"))}</p>`;
  }

  async function renderLine(p, ilk) {
    const hatlar = await API.vapur.hatlar();
    const h = hatlar.find((x) => x.url === p.url) || { ad: t("ferry.lineFallback"), url: p.url };
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
              color: "#0369a1",
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
              hat: t("nav.vapur"),
              renk: "#0369a1",
              tur: "vapur",
              hedef: ag.duraklar[s.d[s.d.length - 1]].ad,
              d: s.d.map((i) => ag.duraklar[i]),
              t: s.t,
            })),
          });
        })
        .catch(() => {});
    }

    const resmiBtn = `<button type="button" class="btn kucuk" data-ac="${esc(p.url)}">${esc(t("ferry.officialPage"))}</button>`;
    let html = callbacks.baslikHTML(
      `<span class="rozet vapur">${iconSvg("vapur", 14)}</span> <span style="font-size:15px">${esc(bas(h.ad))}</span>`,
      true,
      resmiBtn
    );

    if (!tablolar.length) {
      return html + `<div class="bos">${esc(t("ferry.noTimetable"))}</div>`;
    }

    const sirali = tablolar
      .map((tbl, i) => ({ tbl, i, uygun: Plan.tabloGunUygun(tbl.not) }))
      .sort((a, b) => b.uygun - a.uygun || a.i - b.i);

    for (const { tbl, uygun } of sirali) {
      const yok = Plan.bugunYapilmayanIsaretler(tbl.not);
      const satirZaman = (r) => {
        for (const c of r) {
          const v = Zaman.dk(c);
          if (v != null) return v;
        }
        return null;
      };
      let sonrakiBulundu = false;
      let gizli = 0;

      const govde = tbl.satirlar
        .map((r) => {
          const z = satirZaman(r);
          const iptal = Plan.satirYok(r, yok);
          let cls = "";
          let style = "";
          if (uygun && z != null && z < simdi) {
            cls = "gecti";
            style = "opacity:.45";
          } else if (iptal) {
            cls = "yok";
            style = "opacity:.45;text-decoration:line-through";
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

      const ilkSonraki = uygun ? tbl.satirlar.find((r) => !Plan.satirYok(r, yok) && (satirZaman(r) ?? -1) >= simdi) : null;

      html += `<div class="baslik-satir"><h2>${esc(tbl.baslik)}</h2>${!uygun ? `<span class="soluk">${esc(t("ferry.notToday"))}</span>` : ""}</div>`;
      html += `<div class="kart" style="margin-bottom:10px">`;
      if (tbl.not) html += `<div class="alt">${esc(tbl.not)}</div>`;
      if (ilkSonraki) {
        const z = ilkSonraki.find((c) => Zaman.dk(c) != null);
        html += `<div class="alt">${iconSvg("clock", 14)} ${esc(t("ferry.nextTrip"))} <b style="color:var(--yazi)">${esc(z)}</b> · <span class="sure yakin">${Zaman.kalanYazi(Zaman.dk(z) - simdi)} ${esc(t("bus.later"))}</span></div>`;
      } else if (uygun && !sonrakiBulundu && !gizli) {
        html += `<div class="alt">${esc(t("ferry.noRemainingToday"))}</div>`;
      }

      html += `<div style="overflow-x:auto"><table class="tarife">${tbl.basliklar
        .map((r) => `<tr>${r.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr>`)
        .join("")}${govde}</table></div>`;

      if (gizli) {
        html += `<div style="margin-top:8px"><button type="button" class="btn kucuk" data-tumu>${esc(t("ferry.showPast", { n: gizli }))}</button></div>`;
      } else if (p.tumu && uygun) {
        html += `<div style="margin-top:8px"><button type="button" class="btn kucuk" data-tumu>${esc(t("ferry.hidePast"))}</button></div>`;
      }
      html += `</div>`;
    }

    return html + `<p class="alt" style="margin-top:10px">${esc(t("ferry.detailFootnote"))}</p>`;
  }

  return { renderList, renderLine };
}
