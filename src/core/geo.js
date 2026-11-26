// ---- Hesaplama çekirdeği (harita ve arayüzden bağımsız) ----
export const Core = (() => {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;

  function gecerliKonum(p) {
    return Number.isFinite(p?.lat) && Number.isFinite(p?.lon);
  }

  function mesafe(a, b) {
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function yonAcisi(a, b) {
    const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
    const x =
      Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
      Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  function enYakinIndex(duraklar, p) {
    let best = -1;
    let bd = Infinity;
    duraklar.forEach((d, i) => {
      const m = mesafe(d, p);
      if (m < bd) {
        bd = m;
        best = i;
      }
    });
    return { index: best, metre: bd };
  }

  function siradakiDurak(duraklar, bus) {
    const kod = bus.yakinDurak;
    let i = kod == null || kod === "" ? -1 : duraklar.findIndex((d) => d.kod === kod);
    if (i < 0) i = enYakinIndex(duraklar, bus).index;
    if (i < 0) return -1;
    if (i < duraklar.length - 1) {
      const sonraki = duraklar[i + 1];
      if (mesafe(bus, sonraki) < mesafe(duraklar[i], sonraki)) i += 1;
    }
    return i;
  }

  function ortalamaHiz(hat) {
    const km = Number(hat && hat.uzunlukKm);
    const dk = Number(hat && hat.seferSuresiDk);
    const v = km > 0 && dk > 0 ? km / (dk / 60) : 15;
    return Math.min(35, Math.max(8, v));
  }

  const YOL_KATSAYISI = 1.15;

  function varisTahmini(duraklar, bus, hedefIndex, hizKmSa) {
    const s = siradakiDurak(duraklar, bus);
    if (s < 0 || s > hedefIndex) return null;
    let m = mesafe(bus, duraklar[s]);
    for (let k = s; k < hedefIndex; k++) m += mesafe(duraklar[k], duraklar[k + 1]);
    m *= YOL_KATSAYISI;
    const dk = (m / 1000 / hizKmSa) * 60;
    return {
      durakSayisi: hedefIndex - s,
      metre: Math.round(m),
      dakika: Math.max(0, Math.round(dk)),
      siradakiIndex: s,
    };
  }

  function yaklasanlar(duraklar, otobusler, yon, hedefIndex, hizKmSa) {
    return otobusler
      .filter((b) => b.yon === yon)
      .map((b) => ({ bus: b, t: varisTahmini(duraklar, b, hedefIndex, hizKmSa) }))
      .filter((x) => x.t)
      .sort((a, b) => a.t.metre - b.t.metre);
  }

  return { gecerliKonum, mesafe, yonAcisi, enYakinIndex, siradakiDurak, ortalamaHiz, varisTahmini, yaklasanlar };
})();

// Google polyline çözücü (Transitous hassasiyet 7 kullanır)
export function polylineCoz(s, hassasiyet = 7) {
  const k = Math.pow(10, hassasiyet);
  const out = [];
  let i = 0;
  let la = 0;
  let lo = 0;
  while (i < s.length) {
    for (const ek of [0, 1]) {
      let b;
      let sh = 0;
      let r = 0;
      do {
        b = s.charCodeAt(i++) - 63;
        r |= (b & 0x1f) << sh;
        sh += 5;
      } while (b >= 0x20);
      const d = r & 1 ? ~(r >> 1) : r >> 1;
      if (ek === 0) la += d;
      else lo += d;
    }
    out.push([la / k, lo / k]);
  }
  return out;
}
