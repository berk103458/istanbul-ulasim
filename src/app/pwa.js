import { t } from "../i18n/index.js";
import { esc } from "../map/mapController.js";

export function createPwaInstall(S, { sayfa, panelYenile }) {
  let deferredInstallPrompt = null;

  function renderBanner() {
    let installBanner = "";
    if (deferredInstallPrompt && S.sekme === "yakin" && !S.yigin.length) {
      installBanner = `
        <div class="duyuru bilgi" id="pwaBanner" style="justify-content:space-between;align-items:center">
          <span>${esc(t("common.installBanner"))}</span>
          <span style="display:flex;gap:6px">
            <button class="btn kucuk birincil" id="pwaKurBtn">${esc(t("common.installBtn"))}</button>
            <button class="btn kucuk" id="pwaKapatBtn">×</button>
          </span>
        </div>`;
    }
    return installBanner;
  }

  async function install() {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => {});
    dismiss();
  }

  function dismiss() {
    deferredInstallPrompt = null;
    document.querySelector("#pwaBanner")?.remove();
  }

  function handleClick(target) {
    if (target.closest("#pwaKurBtn") && deferredInstallPrompt) return install();
    if (target.closest("#pwaKapatBtn")) {
      dismiss();
      return true;
    }
    return false;
  }

  function bind() {
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      if (sayfa().tur === "yakin") panelYenile();
    });
  }

  return { bind, handleClick, renderBanner };
}
