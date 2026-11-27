import { App } from "@capacitor/app";

export function bindPlatformEvents({ getModalInstance, hasHistory, geri, panelKonum, panelAyarla }) {
  window.addEventListener("popstate", () => {
    const modal = getModalInstance();
    if (modal?.isOpen()) {
      modal.close();
      return;
    }
    if (hasHistory()) {
      geri(true);
    }
  });

  App.addListener("backButton", () => {
    const modal = getModalInstance();
    if (modal?.isOpen()) {
      modal.close();
      return;
    }
    if (panelKonum() === "genis") {
      panelAyarla("normal");
      return;
    }
    if (hasHistory()) {
      geri(true);
      return;
    }
    App.exitApp();
  }).catch(() => {});
}
