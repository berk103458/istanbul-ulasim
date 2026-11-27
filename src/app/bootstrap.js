import { initLang } from "../i18n/index.js";
import { createMapController } from "../map/mapController.js";
import { createAppStore } from "../state/store.js";
import { createBottomSheet } from "./bottomSheet.js";
import { createLiveUpdates } from "./liveUpdates.js";
import { createNavigation } from "./navigation.js";
import { ensureToastContainer } from "./notifications.js";
import { baslikHTML, createPanelView, onYukle } from "./panelView.js";
import { bindPlatformEvents } from "./platformEvents.js";
import { createPwaInstall } from "./pwa.js";
import { createSettings } from "./settings.js";
import { bindViewEvents } from "./viewEvents.js";
import { createViews } from "./views.js";

export async function bootstrap() {
  const store = createAppStore();
  const S = store.get();
  const ciz = (degisti) => panelView.ciz(degisti);
  const panelYenile = () => liveUpdates.panelYenile();

  // Keep the callback interface used by the view and map factories.
  const callbacks = {
    sayfa: () => navigation.sayfa(),
    getCizimNo: () => panelView.getCizimNo(),
    baslikHTML,
    onYukle,
    panelYenile,
    syncNav: () => navigation.syncNav(),
    ciz,
    git: (s) => navigation.git(s),
    geri: (fromPop) => navigation.geri(fromPop),
    aracAc: (hat, kapino) => navigation.aracAc(hat, kapino),
    openStopBoard: async (stop) => (await views.modal.get()).openStopBoard(stop),
    openIspark: async (park) => (await views.modal.get()).openIspark(park),
    openSettings: async () => (await views.modal.get()).openSettings(),
    setRoutePlace: async (alan, yer) => (await views.routeView.get()).setRoutePlace(alan, yer),
    applyTheme: (theme) => settings.applyTheme(theme),
    setNearbyCache: (list) => panelView.setNearbyCache(list),
  };

  const mc = createMapController(S, callbacks);
  const views = createViews(S, mc, callbacks);
  const bottomSheet = createBottomSheet(mc);
  const navigation = createNavigation(store, mc, bottomSheet, ciz);
  const liveUpdates = createLiveUpdates(S, mc, { sayfa: navigation.sayfa, ciz });
  const pwaInstall = createPwaInstall(S, { sayfa: navigation.sayfa, panelYenile });
  const panelView = createPanelView(S, mc, views, navigation, pwaInstall);
  const settings = createSettings(store, mc);

  settings.bind();
  bindViewEvents(store, mc, { navigation, panelView, views, pwaInstall });
  bottomSheet.bind();
  bindPlatformEvents({
    getModalInstance: views.modal.peek,
    hasHistory: navigation.hasHistory,
    geri: navigation.geri,
    panelKonum: bottomSheet.panelKonum,
    panelAyarla: bottomSheet.panelAyarla,
  });
  pwaInstall.bind();
  liveUpdates.startTimers();

  initLang();
  ensureToastContainer();
  await settings.restore();
  liveUpdates.connectStream();
  ciz(true);
}
