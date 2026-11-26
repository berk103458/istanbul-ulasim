// ---- Zaman yardımcıları (gece yarısı +1440 tutarlı) ----
export const Zaman = {
  // "06:15 *" -> dakika; gece yarısından sonraki saatleri (00:00-03:59) güne ekler
  dk(s) {
    const m = /(\d{1,2})[:.](\d{2})/.exec(s || "");
    if (!m) return null;
    let v = +m[1] * 60 + +m[2];
    if (+m[1] < 4) v += 1440;
    return v;
  },
  simdi(d = new Date()) {
    let v = d.getHours() * 60 + d.getMinutes();
    if (d.getHours() < 4) v += 1440;
    return v;
  },
  siraKarsilastir(a, b) {
    return Zaman.dk(a) - Zaman.dk(b);
  },
  gunTipi(d = new Date()) {
    const g = d.getDay();
    return g === 0 ? "P" : g === 6 ? "C" : "I";
  },
  yerelISO(d = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
  },
  kalan(s) {
    const v = Zaman.dk(s);
    if (v == null) return null;
    let k = v - Zaman.simdi();
    if (k < -720) k += 1440;
    return k;
  },
  kalanYazi(k) {
    if (k == null) return "";
    if (k <= 0) return "şimdi";
    if (k < 60) return k + " dk";
    return Math.floor(k / 60) + " sa " + (k % 60) + " dk";
  },
  saatFormat(dk) {
    if (dk == null || !isFinite(dk)) return "–";
    let m = Math.round(dk);
    m = ((m % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  },
  isoDk(iso, planZaman) {
    const d = new Date(iso);
    const z =
      planZaman && planZaman.tabanMs
        ? planZaman
        : { tabanMs: Date.now(), tabanDk: Zaman.simdi() + new Date().getSeconds() / 60 };
    return z.tabanDk + (d - z.tabanMs) / 60000;
  },
};
