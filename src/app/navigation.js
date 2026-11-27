export function createNavigation(store, mc, { panelKonum, panelAyarla }, ciz) {
  const S = store.get();

  function sayfa() {
    return S.yigin.length ? S.yigin[S.yigin.length - 1] : { tur: S.sekme };
  }

  function syncNav() {
    document.querySelectorAll("#sekmeler button").forEach((b) => {
      b.classList.toggle("aktif", b.dataset.sekme === S.sekme);
    });
  }

  function selectTab(sekme) {
    store.set({ sekme, yigin: [] });
    syncNav();
  }

  function git(s) {
    store.set({ yigin: [...S.yigin, s] });
    try {
      history.pushState({ depth: S.yigin.length, sekme: S.sekme }, "");
    } catch {
      // ignore history errors in restricted contexts
    }
    ciz(true);
  }

  function geri(fromPop = false) {
    if (!S.yigin.length) return;
    store.set({ yigin: S.yigin.slice(0, -1) });
    if (!fromPop) {
      try {
        if (history.state?.depth > 0) history.back();
      } catch {
        // ignore
      }
    }
    ciz(true);
  }

  function aracAc(hat, kapino) {
    if (panelKonum() === "tam") panelAyarla("normal");
    const yeni = { tur: "arac", hat, kapino };
    if (sayfa().tur === "arac") {
      store.set({ yigin: [...S.yigin.slice(0, -1), yeni] });
    } else git(yeni);
    mc.setTakipArac(hat + "/" + kapino);
    ciz(true);
  }

  return { sayfa, syncNav, selectTab, git, geri, aracAc, hasHistory: () => S.yigin.length > 0 };
}
