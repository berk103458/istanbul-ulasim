export function createBottomSheet(mc) {
  const panelEl = () => document.querySelector("#panel");

  function panelKonum() {
    const b = document.body.classList;
    return b.contains("tam") ? "tam" : b.contains("genis") ? "genis" : "normal";
  }

  function panelAyarla(k) {
    document.body.classList.toggle("tam", k === "tam");
    document.body.classList.toggle("genis", k === "genis");
    const p = panelEl();
    if (k === "tam" && p) p.scrollTop = 0;
    setTimeout(() => mc.map.invalidateSize({ pan: false }), 300);
  }

  function bind() {
    const panel = panelEl();
    if (!panel) return;
    let y0 = null, x0 = 0, dy = 0, bastan = false, surukle = false, iptal = false, k0 = "normal", ust0 = true;

    panel.addEventListener(
      "touchstart",
      (e) => {
        const touch = e.touches[0];
        y0 = touch.clientY;
        x0 = touch.clientX;
        dy = 0;
        surukle = false;
        iptal = false;
        k0 = panelKonum();
        const ic = document.querySelector("#icerik");
        ust0 = !ic || ic.scrollTop <= 0;
        const ust = touch.clientY - panel.getBoundingClientRect().top < 56;
        bastan = Boolean(e.target.closest("#tutamak")) || k0 === "tam" || (ust && !e.target.closest("input,select,textarea,button"));
      },
      { passive: true }
    );

    panel.addEventListener(
      "touchmove",
      (e) => {
        if (y0 == null || iptal) return;
        const touch = e.touches[0];
        dy = touch.clientY - y0;
        if (!surukle && Math.abs(touch.clientX - x0) > Math.abs(dy) + 6) {
          iptal = true;
          return;
        }
        const izin = surukle || bastan || (dy > 0 && ust0);
        if (!izin || Math.abs(dy) < 6) return;
        if (k0 === "genis" && dy < 0 && !bastan) return;
        if (k0 === "tam" && dy > 0) return;
        surukle = true;
        e.preventDefault();
        panel.classList.add("suruk");
        const sin =
          k0 === "tam"
            ? [-window.innerHeight * 0.8, 0]
            : k0 === "genis"
            ? [0, window.innerHeight * 0.8]
            : [-window.innerHeight * 0.3, window.innerHeight * 0.5];
        panel.style.transform = `translateY(${Math.max(sin[0], Math.min(sin[1], dy))}px)`;
      },
      { passive: false }
    );

    const bitir = () => {
      panel.classList.remove("suruk");
      panel.style.transform = "";
      if (surukle) {
        const H = window.innerHeight;
        let k = k0;
        if (k0 === "normal") k = dy > 70 ? "tam" : dy < -60 ? "genis" : "normal";
        else if (k0 === "genis") k = dy > H * 0.45 ? "tam" : dy > 60 ? "normal" : "genis";
        else if (k0 === "tam") k = dy < -H * 0.5 ? "genis" : dy < -40 ? "normal" : "tam";
        if (k !== k0) panelAyarla(k);
      }
      y0 = null;
      surukle = false;
    };

    panel.addEventListener("touchend", bitir);
    panel.addEventListener("touchcancel", bitir);
    panel.addEventListener(
      "click",
      (e) => {
        const k = panelKonum();
        if (k === "tam") {
          e.stopPropagation();
          e.preventDefault();
          panelAyarla("normal");
          return;
        }
        if (e.target.closest("#tutamak")) {
          panelAyarla(k === "genis" ? "normal" : "genis");
        }
      },
      true
    );
  }

  return { panelKonum, panelAyarla, bind };
}
