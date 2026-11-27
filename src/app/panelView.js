import { t } from "../i18n/index.js";
import { esc, hataMesaji } from "../map/mapController.js";
import { iconSvg } from "../ui/icons.js";

export function baslikHTML(metin, geriVar, ek = "") {
  return `
    <div class="baslik-satir" style="margin-top:4px">
      <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1">
        ${geriVar ? `<button class="btn ikon" data-geri aria-label="${esc(t("common.back"))}" style="width:36px;height:36px;min-width:36px">${iconSvg("chevronLeft", 18)}</button>` : ""}
        <h2 style="font-size:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${metin}</h2>
      </div>
      ${ek}
    </div>`;
}

export function onYukle(b, g) {
  const ic = document.querySelector("#icerik");
  if (!ic) return;
  ic.innerHTML =
    baslikHTML(b, g) +
    `<div class="skeleton skeleton-kart"></div><div class="skeleton skeleton-kart"></div><div class="skeleton skeleton-satir"></div>`;
}

export function createPanelView(S, mc, views, { sayfa }, pwaInstall) {
  const { nearbyView, routeView, busView, railView, ferryView } = views;
  let cizimNo = 0;
  let nearbyCache = [];

  async function ciz(sayfaDegisti = false) {
    const no = ++cizimNo;
    const p = sayfa();
    if (sayfaDegisti) {
      if (p.tur !== "arac") mc.setTakipArac(null);
      mc.haritaTemizle();
      const ic = document.querySelector("#icerik");
      if (ic) ic.scrollTop = 0;
      routeView.peek()?.secimBitir();
    }

    const ic = document.querySelector("#icerik");
    if (!ic) return;

    const routes = {
      yakin: (x, i, n) => nearbyView.render(x, i, n),
      rota: async (x, i, n) => (await routeView.get()).render(x, i, n),
      rdetay: async (x, i, n) => (await routeView.get()).renderDetail(x, i, n),
      otobus: async (x, i, n) => (await busView.get()).renderList(x, i, n),
      hat: async (x, i, n) => (await busView.get()).renderLine(x, i, n),
      arac: async (x, i, n) => (await busView.get()).renderVehicle(x, i, n),
      rayli: async (x, i, n) => (await railView.get()).renderList(x, i, n),
      rhat: async (x, i, n) => (await railView.get()).renderLine(x, i, n),
      ist: async (x, i, n) => (await railView.get()).renderStation(x, i, n),
      vapur: async (x, i, n) => (await ferryView.get()).renderList(x, i, n),
      vhat: async (x, i, n) => (await ferryView.get()).renderLine(x, i, n),
    };

    try {
      const html = await (routes[p.tur] || routes.yakin)(p, sayfaDegisti, no);
      if (no !== cizimNo || html == null) return;

      const aktif = document.activeElement;
      const id = aktif && aktif.id;
      const pos = aktif && aktif.selectionStart;
      const focusAttrs = !sayfaDegisti && !id && ic.contains(aktif)
        ? [...aktif.attributes].filter(({ name }) => name.startsWith("data-"))
        : [];

      ic.innerHTML = pwaInstall.renderBanner() + html;

      if (id) {
        const el = document.getElementById(id);
        if (el && el.tagName === "INPUT") {
          el.focus();
          try {
            el.setSelectionRange(pos, pos);
          } catch {
            // ignore
          }
        }
      } else if (focusAttrs.length) {
        const [first] = focusAttrs;
        const replacement = [...ic.querySelectorAll(`[${first.name}]`)].find((el) =>
          el.tabIndex >= 0 && focusAttrs.every(({ name, value }) => el.getAttribute(name) === value)
        );
        replacement?.focus({ preventScroll: true });
      }
    } catch (e) {
      if (no !== cizimNo) return;
      ic.innerHTML =
        baslikHTML(esc(t("common.error")), S.yigin.length > 0) +
        `<div class="duyuru hata"><span class="duyuru-ikon">${iconSvg("alert", 18)}</span><span>${esc(hataMesaji(e))}</span></div>` +
        `<button class="btn" data-yenile>${iconSvg("refresh", 16)} ${esc(t("common.retry"))}</button>`;
    }
  }

  return {
    ciz,
    getCizimNo: () => cizimNo,
    getNearbyStop: (index) => nearbyCache[index],
    setNearbyCache: (list) => {
      nearbyCache = list;
    },
  };
}
