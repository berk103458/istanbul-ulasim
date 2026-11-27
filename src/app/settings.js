import { Bridge } from "../core/bridge.js";
import { KV } from "../core/storage.js";
import { restorePreferences } from "../state/store.js";

export function applyMapStyle(S, mc, mapStyle) {
  S.mapStyle = mapStyle;
  KV.set("mapStyle", mapStyle);
  mc.updateBaseLayer();
}

function configureProxy(proxyUrl) {
  if (typeof Bridge.setProxyUrl === "function") Bridge.setProxyUrl(proxyUrl);
}

export function saveProxyUrl(S, proxyUrl) {
  S.proxyUrl = proxyUrl;
  KV.set("proxyUrl", proxyUrl);
  configureProxy(proxyUrl);
}

export function createSettings(store, mc) {
  const S = store.get();

  function applyTheme(theme) {
    store.set({ theme: theme || "system" });
    KV.set("theme", S.theme);
    if (S.theme === "light" || S.theme === "dark") {
      document.documentElement.dataset.theme = S.theme;
    } else {
      delete document.documentElement.dataset.theme;
    }
    mc.updateBaseLayer();
  }

  function bind() {
    window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (S.theme === "system") mc.updateBaseLayer();
    });

    document.querySelector("#trafikBtn")?.addEventListener("click", () => {
      store.set({ trafik: !S.trafik });
      document.querySelector("#trafikBtn")?.classList.toggle("aktif", S.trafik);
      KV.set("trafik", S.trafik);
      if (S.trafik) mc.trafikYukle();
      else {
        mc.trafikKatmani.clearLayers();
        mc.trafikBilgiYaz();
      }
    });

    document.querySelector("#isparkBtn")?.addEventListener("click", () => {
      store.set({ ispark: !S.ispark });
      document.querySelector("#isparkBtn")?.classList.toggle("aktif", S.ispark);
      KV.set("ispark", S.ispark);
      if (S.ispark) mc.isparkYukle();
      else {
        mc.isparkKatmani.clearLayers();
        mc.isparkBilgiYaz();
      }
    });
  }

  async function restore() {
    const { trafik, ispark } = await restorePreferences(store);
    if (S.proxyUrl) configureProxy(S.proxyUrl);

    applyTheme(S.theme);

    store.set({ trafik });
    document.querySelector("#trafikBtn")?.classList.toggle("aktif", S.trafik);
    if (S.trafik) mc.trafikYukle();

    store.set({ ispark });
    document.querySelector("#isparkBtn")?.classList.toggle("aktif", S.ispark);
    if (S.ispark) mc.isparkYukle();
  }

  return { applyTheme, bind, restore };
}
