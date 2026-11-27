import L from "leaflet";
import { Bridge } from "../core/bridge.js";
import { KV } from "../core/storage.js";
import { t } from "../i18n/index.js";
import { hataMesaji } from "../map/mapController.js";
import { iconSvg } from "../ui/icons.js";
import { HIZLI_SEMTLER } from "../views/nearbyView.js";
import { toggleStopWatch } from "./notifications.js";

export function bindViewEvents(store, mc, { navigation, panelView, views, pwaInstall }) {
  const S = store.get();
  const { sayfa, git, geri, aracAc, selectTab } = navigation;
  const { ciz, getNearbyStop } = panelView;
  const { modal, routeView } = views;

  document.querySelector("#katmanBtn")?.addEventListener("click", async () => {
    (await modal.get()).openSettings();
  });

  document.querySelector("#konumBtn")?.addEventListener("click", async () => {
    store.set({ konumHata: null, semt: null });
    try {
      await mc.benimKonum(false);
      if (S.ben) mc.map.setView([S.ben.lat, S.ben.lon], 15);
    } catch (err) {
      store.set({ konumHata: hataMesaji(err) });
    }
    ciz(true);
  });

  document.querySelector("#secimIptal")?.addEventListener("click", (e) => {
    e.stopPropagation();
    routeView.peek()?.secimBitir();
  });

  document.addEventListener("click", async (e) => {
    const installAction = pwaInstall.handleClick(e.target);
    if (installAction) return installAction;

    const ar = e.target.closest("[data-arac]");
    if (ar && sayfa().tur === "hat") {
      e.stopImmediatePropagation();
      return aracAc(sayfa().hat, ar.dataset.arac);
    }

    const ak = e.target.closest("[data-ak]");
    if (ak) {
      const p = sayfa();
      if (ak.dataset.ak === "takip" && p.tur === "arac") {
        const key = p.hat + "/" + p.kapino;
        const cur = mc.getTakipArac();
        mc.setTakipArac(cur === key ? null : key);
        const a = S.arac.get(key);
        if (mc.getTakipArac() && a) mc.map.setView([a.gor.lat, a.gor.lon], Math.max(mc.map.getZoom(), 15));
        return ciz(false);
      }
      if (ak.dataset.ak === "hat") {
        return git({ tur: "hat", hat: ak.dataset.akhat, yon: ak.dataset.akyon });
      }
    }

    const el = e.target.closest(
      "[data-sekme],[data-geri],[data-yenile],[data-fav],[data-hat],[data-yon],[data-gun],[data-durak],[data-odakla],[data-rhat],[data-ist],[data-vhat],[data-ac],[data-tumu],[data-oneri],[data-temizle],[data-degistir],[data-rotabul],[data-rotabul-alt],[data-rota],[data-zaman],[data-rfiltre],[data-bacak-durak],[data-rota-paylas],[data-kayitli],[data-kayitli-duzenle],[data-semt],[data-semt-temizle],[data-yakin-durak],[data-fav-durak],[data-akilli-rota],[data-filo-toggle],[data-bildir-hat],[data-bus-kat],[data-vapur-grup]"
    );
    if (!el) return;
    const d = el.dataset;

    if (d.sekme) {
      selectTab(d.sekme);
      return ciz(true);
    }
    if ("geri" in d) return geri();
    if ("yenile" in d) return ciz(true);
    if (d.fav) {
      e.stopPropagation();
      const i = S.favoriler.indexOf(d.fav);
      if (i >= 0) S.favoriler.splice(i, 1);
      else S.favoriler.push(d.fav);
      KV.set("favoriler", S.favoriler);
      const label = t(i >= 0 ? "bus.favAdd" : "bus.favRemove", { hat: d.fav });
      el.setAttribute("aria-pressed", String(i < 0));
      el.setAttribute("aria-label", label);
      el.title = label;
      el.innerHTML = iconSvg(i >= 0 ? "star" : "starFill", 20);
      return;
    }
    if (d.hat) return git({ tur: "hat", hat: d.hat });
    if (d.yon) {
      sayfa().yon = d.yon;
      return ciz(false);
    }
    if (d.gun) {
      sayfa().gun = d.gun;
      return ciz(false);
    }
    if (d.durak != null) {
      const p = sayfa();
      const dd = S.hatVeri[p.hat]?.duraklar?.[p.yon]?.[+d.durak];
      if (!dd) return;
      mc.map.setView([dd.lat, dd.lon], 16);
      L.popup().setLatLng([dd.lat, dd.lon]).setContent(mc.durakPopup(p.hat, dd)).openOn(mc.map);
      return;
    }
    if (d.odakla) {
      const [hat, kapino] = d.odakla.split("/");
      if (hat && kapino) mc.aracOdakla(hat, kapino);
      return;
    }
    if (d.rhat) return git({ tur: "rhat", id: d.rhat === "MR" ? "MR" : +d.rhat });
    if (d.ist) return git({ tur: "ist", id: String(d.ist).startsWith("mr:") ? d.ist : +d.ist });
    if (d.vhat) return git({ tur: "vhat", url: d.vhat });
    if (d.ac) {
      Bridge.call("open", { url: d.ac }).catch(() => {});
      return;
    }
    if ("tumu" in d) {
      const p = sayfa();
      p.tumu = !p.tumu;
      return ciz(false);
    }
    if (d.oneri != null) {
      const y = S.rota.gosterilen?.[+d.oneri];
      if (y) (await routeView.get()).yerSec(y);
      return;
    }
    if (d.temizle) {
      S.rota[d.temizle] = null;
      S.rota.aktif = d.temizle;
      S.rota.metin = "";
      S.rota.sonuclar = null;
      return ciz(false);
    }
    if ("degistir" in d) {
      const R = S.rota;
      [R.nereden, R.nereye] = [R.nereye, R.nereden];
      R.aktif = !R.nereden ? "nereden" : !R.nereye ? "nereye" : null;
      R.sonuclar = null;
      ciz(true);
      if (R.nereden && R.nereye) (await routeView.get()).rotaBul();
      return;
    }
    if ("rotabul" in d) return (await routeView.get()).rotaBul();
    if ("rotabulAlt" in d) {
      selectTab("rota");
      return (await routeView.get()).rotaBul();
    }
    if (d.zaman) {
      const R = S.rota;
      if (d.zaman === "simdi") {
        R.zaman = null;
        ciz(false);
        if (R.nereden && R.nereye) (await routeView.get()).rotaBul();
        return;
      }
      if (!R.zaman) {
        const z = new Date(Date.now() + 3600e3);
        z.setMinutes(Math.ceil(z.getMinutes() / 15) * 15, 0, 0);
        const p2 = (n) => String(n).padStart(2, "0");
        R.zaman = `${z.getFullYear()}-${p2(z.getMonth() + 1)}-${p2(z.getDate())}T${p2(z.getHours())}:${p2(z.getMinutes())}`;
      }
      await ciz(false);
      const zEl = document.querySelector("#zamanSec");
      if (zEl) {
        zEl.focus();
        try {
          zEl.showPicker?.();
        } catch {
          // ignore
        }
      }
      return;
    }
    if (d.rfiltre) {
      S.rota.filtre = d.rfiltre;
      return ciz(false);
    }
    if (d.rota != null) return git({ tur: "rdetay", i: +d.rota });
    if (d.bacakDurak != null) {
      const p = sayfa();
      const i = +d.bacakDurak;
      p.acikBacak = p.acikBacak === i ? null : i;
      return ciz(false);
    }
    if (d.rotaPaylas != null) return (await routeView.get()).shareRoute(+d.rotaPaylas);
    if (d.kayitli) return (await routeView.get()).handleSavedPlace(d.kayitli, false);
    if (d.kayitliDuzenle) return (await routeView.get()).handleSavedPlace(d.kayitliDuzenle, true);
    if (d.akilliRota) {
      const target = S.savedPlaces?.[d.akilliRota];
      if (target) return (await routeView.get()).setRoutePlace("nereye", target);
      return;
    }
    if ("filoToggle" in d) {
      store.set({ filoRadar: !S.filoRadar });
      if (S.filoRadar) await mc.filoRadarYukle(true);
      else mc.filoKatmani.clearLayers();
      return ciz(false);
    }
    if (d.bildirHat) {
      toggleStopWatch(d);
      return ciz(false);
    }
    if (d.semt) {
      const hub = HIZLI_SEMTLER.find((s) => s.ad === d.semt);
      if (!hub) return;
      store.set({ semt: S.semt?.ad === hub.ad ? null : hub });
      if (S.semt) mc.map.setView([hub.lat, hub.lon], 15);
      return ciz(true);
    }
    if ("semtTemizle" in d) {
      store.set({ semt: null });
      if (S.ben) mc.map.setView([S.ben.lat, S.ben.lon], 15);
      return ciz(true);
    }
    if (d.yakinDurak != null) {
      const st = getNearbyStop(+d.yakinDurak);
      if (!st) return;
      if (st.tur === "otobus") return (await modal.get()).openStopBoard(st);
      if (st.tur === "rayli" || st.tur === "marmaray") return git({ tur: "ist", id: st.id });
      if (st.tur === "vapur") {
        selectTab("vapur");
        return ciz(true);
      }
    }
    if (d.favDurak != null) {
      const st = S.favoriDuraklar?.[+d.favDurak];
      if (st) return (await modal.get()).openStopBoard(st);
      return;
    }
    if (d.busKat) {
      store.set({ busKat: d.busKat });
      return ciz(false);
    }
    if (d.vapurGrup) {
      store.set({ vapurGrup: d.vapurGrup });
      return ciz(false);
    }
  });

  document.addEventListener("change", async (e) => {
    if (e.target.id !== "zamanSec") return;
    const R = S.rota;
    R.zaman = e.target.value || null;
    if (R.nereden && R.nereye) (await routeView.get()).rotaBul();
    else ciz(false);
  });

  document.addEventListener("focusin", (e) => {
    const alan = e.target.dataset?.alan;
    if (!alan) return;
    const R = S.rota;
    if (R.aktif === alan) return;
    R.aktif = alan;
    R.metin = "";
    R.oneriler = [];
    ciz(false);
  });

  let aramaZaman = null;
  document.addEventListener("input", async (e) => {
    if (e.target.dataset?.alan) {
      S.rota.metin = e.target.value;
      (await routeView.get()).yerAramaYap();
      return;
    }
    if (e.target.id === "ara") {
      store.set({ arama: e.target.value });
      clearTimeout(aramaZaman);
      aramaZaman = setTimeout(() => ciz(false), 220);
    } else if (e.target.id === "rayliAra") {
      store.set({ rayliArama: e.target.value });
      clearTimeout(aramaZaman);
      aramaZaman = setTimeout(() => ciz(false), 200);
    } else if (e.target.id === "vapurAra") {
      store.set({ vapurArama: e.target.value });
      clearTimeout(aramaZaman);
      aramaZaman = setTimeout(() => ciz(false), 200);
    }
  });
}
