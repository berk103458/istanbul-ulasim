/**
 * İstanbul Ulaşım v5.0 — Bilingual i18n (TR / EN)
 */

const LS_KEY = "ulasim.lang";

const STRINGS = {
  tr: {
    // Navigation & Tabs
    "nav.yakin": "Yakınımda",
    "nav.rota": "Rota",
    "nav.otobus": "Otobüs",
    "nav.rayli": "Raylı",
    "nav.vapur": "Vapur",

    // Common
    "common.back": "Geri",
    "common.close": "Kapat",
    "common.retry": "Tekrar Dene",
    "common.save": "Kaydet",
    "common.saved": "Kaydedildi ✓",
    "common.clear": "Temizle",
    "common.cancel": "Vazgeç",
    "common.error": "Hata",
    "common.live": "CANLI",
    "common.schedule": "Tarife",
    "common.now": "Şimdi",
    "common.edit": "Düzenle",
    "common.share": "Paylaş",
    "common.installBanner": "Ana ekrana ekleyerek hızlı erişin",
    "common.installBtn": "Yükle",
    "common.networkError": "Bağlantı kurulamadı. İnternetinizi kontrol edin.",

    // Nearby View
    "nearby.title": "Yakınımda",
    "nearby.hubSelected": "merkezi seçili",
    "nearby.backToLocation": "Konumuma dön",
    "nearby.locLive": "Konumunuz ±{acc} m",
    "nearby.locPending": "Konum alınıyor · {ad} çevresi gösteriliyor",
    "nearby.locMissing": "Konum alınamadı. Haritadan konumunuzu açın veya bir semt seçin.",
    "nearby.stopsHeading": "Yakındaki Duraklar & İstasyonlar",
    "nearby.pointsCount": "{n} nokta",
    "nearby.favStops": "Favori Duraklarım",
    "nearby.favStopsEmpty": "Durak panosundan ⭐ simgesine dokunarak favori durak ekleyin.",
    "nearby.favLines": "Favori Hatlarım",
    "nearby.linesCount": "{n} hat",
    "nearby.noFavLines": "Henüz favori hat yok. Otobüs sekmesinden hat arayıp yıldız ile ekleyin.",
    "nearby.lineFetchErr": "Hat verisi alınamadı",
    "nearby.noLocOrStop": "Konum ya da seçili durak yok.",
    "nearby.myStop": "Durağım",
    "nearby.nearestStop": "En yakın durak",
    "nearby.noApproaching": "Bu yönde yaklaşan otobüs yok",
    "nearby.smartTitle": "Akıllı Ulaşım Önerisi",
    "nearby.goToWork": "İşe git",
    "nearby.goToHome": "Eve dön",
    "nearby.smartMorning": "Sabah yoğunluğu: {ad} hedefine hızlı rota oluştur.",
    "nearby.smartEvening": "Akşam dönüşü: {ad} hedefine en uygun rotayı aç.",
    "nearby.heavyTrafficTip": "Trafik yoğun (%{ti}). Raylı sistem veya Vapur tercih etmeniz önerilir.",
    "nearby.fleetRadar": "Canlı Filo Radarı",
    "nearby.fleetOn": "Filo Açık",
    "nearby.fleetOff": "Filoyu Göster",
    "nearby.fleetCount": "{n} araç",
    "nearby.etaFootnote": "Otobüs süreleri son dakikalardaki gerçek hıza, trafik yoğunluğuna ve durak beklemesine göre hesaplanır.",

    // Traffic & Corridors
    "traffic.title": "Trafik Yoğunluğu",
    "traffic.loading": "Trafik yükleniyor…",
    "traffic.error": "Trafik alınamadı: {msg}",
    "traffic.index": "Trafik %{ti}",
    "traffic.smooth": "Akıcı",
    "traffic.moderate": "Orta",
    "traffic.heavy": "Yoğun",
    "traffic.severe": "Çok Yoğun",
    "traffic.corridorsTitle": "Köprüler, Tüneller & Trafik Olayları",
    "traffic.incidentsTitle": "Aktif Trafik Olayları",
    "traffic.noIncidents": "Bildirilen aktif kaza veya yol çalışması yok.",
    "traffic.incidentType.accident": "Kaza",
    "traffic.incidentType.roadwork": "Yol Çalışması",
    "traffic.incidentType.congestion": "Yoğunluk",
    "traffic.incidentType.other": "Trafik Uyarısı",

    // ETA & Vehicle
    "eta.arriving": "geliyor",
    "eta.min": "~{n} dk",
    "eta.stopsAway": "{n} durak",
    "eta.stopNext": "Sıradaki durak",
    "eta.distanceAway": "{m} uzakta",
    "eta.trafficFactored": "trafik hesaba katıldı",
    "eta.lastUpdate": "Son Güncelleme",
    "eta.secAgo": "{n} sn önce",
    "eta.minAgo": "{n} dk önce",
    "eta.notify3m": "Yaklaşınca Bildir (3 dk)",
    "eta.notifying": "Bildirim Aktif ✓",
    "eta.speed": "Hız",
    "eta.trafficImpact": "Trafik Etkisi",
    "eta.stopDwell": "Durak Bekleme",
    "eta.incidentWarn": "Güzergahta trafik olayı var",
    "eta.deviation": "Sapma",
    "eta.delayed": "Gecikme",
    "eta.outOfService": "Hizmet Dışı",
    "eta.plate": "Plaka",
    "eta.operator": "Operatör",
    "eta.breakdownTitle": "9 Faktörlü Varış Analizi",

    // Bus View
    "bus.title": "Otobüs ve Metrobüs",
    "bus.searchPlaceholder": "Hat kodu veya adı: 500T, 34BZ, Kadıköy…",
    "bus.catAll": "Tümü",
    "bus.catFav": "Favoriler",
    "bus.catMb": "Metrobüs",
    "bus.catAnn": "Duyurular",
    "bus.results": "Sonuçlar",
    "bus.noMatch": "Eşleşen hat bulunamadı.",
    "bus.annLines": "Aktif Duyurulu Hatlar",
    "bus.noAnn": "Şu an aktif hat duyurusu yok.",
    "bus.mbLines": "Metrobüs Hatları",
    "bus.favLines": "Favoriler",
    "bus.totalInfo": "Toplam {n} İETT hattı arasında arama yapabilirsiniz.",
    "bus.inService": "{n} araç seferde",
    "bus.timetable": "Sefer Saatleri",
    "bus.departureFrom": "{ad} kalkış",
    "bus.nextDep": "Sıradaki kalkış",
    "bus.later": "sonra",
    "bus.noSchedule": "Bu gün için planlanmış sefer bilgisi yok.",
    "bus.stops": "Duraklar ({n})",
    "bus.vehiclesOnDir": "{n} araç bu yönde",
    "bus.vehicleMissing": "Bu araç şu an görünmüyor (sefer bitmiş veya konum gelmiyor).",
    "bus.followMap": "Haritada takip et",
    "bus.following": "✓ Takip ediliyor",
    "bus.linePage": "Hat sayfası ›",
    "bus.nextStops": "Sıradaki Duraklar",
    "bus.remaining": "{n} kaldı",

    // Route View
    "route.title": "Rota Planlayıcı",
    "route.myLocation": "Konumum",
    "route.fromPlaceholder": "Nereden?",
    "route.toPlaceholder": "Nereye? (yer, durak, istasyon)",
    "route.pickDate": "Tarih ve saat seç",
    "route.findBtn": "Rota Bul",
    "route.calculating": "Rotalar hesaplanıyor…",
    "route.checkingLive": "Canlı otobüs konumları ve sefer saatleri kontrol ediliyor…",
    "route.noResults": "Uygun rota bulunamadı.",
    "route.emptyHint": "Gitmek istediğiniz yeri yazın, Ev/İş seçin ya da haritadan dokunun.",
    "route.home": "Ev",
    "route.work": "İş",
    "route.add": "(ekle)",
    "route.tapMap": "Haritadan seç",
    "route.tapMapHint": "Haritada bir noktaya dokunun",
    "route.criteria.onerilen": "Önerilen",
    "route.criteria.fastest": "En Hızlı",
    "route.criteria.fewest_transfers": "Az Aktarma",
    "route.criteria.least_walking": "Az Yürüme",
    "route.criteria.least_waiting": "Az Bekleme",
    "route.criteria.cheapest": "En Ekonomik",
    "route.criteria.traffic_resilient": "Trafiğe Dayanıklı",
    "route.fareFull": "Tam {tl} ₺",
    "route.fareStudent": "Öğrenci {tl} ₺",
    "route.freeTransfer": "Ücretsiz Aktarma",
    "route.compareStrip": "En hızlı {min} dk · En az {tr} aktarma · En düşük {tl} ₺",
    "route.disruptionTitle": "Güzergahta gecikme veya duyuru tespit edildi",
    "route.recalcAlt": "Alternatif Rota Öner",
    "route.direct": "aktarmasız",
    "route.transfers": "{n} aktarma",
    "route.walkM": "{m} yürüme",
    "route.arrival": "varış",
    "route.noService": "Sefer Yok",

    // Stop Modal & Settings
    "modal.stopBoard": "Kalkış Panosu",
    "modal.routeFrom": "Buradan Rota",
    "modal.routeTo": "Hedef Yap",
    "modal.noDepartures": "Bu durak için yaklaşan sefer bilgisi bulunamadı.",
    "modal.favStopAdd": "Favori Durak Ekle",
    "modal.favStopRemove": "Favori Durak ✓",
    "modal.isparkEmpty": "Boş Kapasite",
    "modal.isparkOccupancy": "Doluluk %{pct}",
    "modal.isparkOpen": "Açık",
    "modal.isparkClosed": "Kapalı",
    "modal.isparkHours": "Çalışma Saatleri",
    "modal.isparkFree": "Ücretsiz Süre",
    "modal.isparkRoute": "Buraya Rota",
    "settings.title": "Görünüm & Ayarlar",
    "settings.language": "Dil / Language",
    "settings.theme": "Tema",
    "settings.themeSystem": "Sistem",
    "settings.themeLight": "Açık",
    "settings.themeDark": "Koyu",
    "settings.mapStyle": "Harita Stili",
    "settings.styleStandard": "Standart",
    "settings.styleClean": "Sade",
    "settings.styleOsm": "OSM",
    "settings.proxy": "Gelişmiş (İsteğe Bağlı Proxy)",
    "settings.proxyHint": "Mobil/Web CORS için özel proxy adresi (boş bırakılabilir)",
    "settings.clearCache": "Önbelleği Temizle",
    "settings.clearCacheDesc": "Kayıtlı hat, durak ve harita önbelleğini sıfırlar",
    "settings.clearCacheDone": "Önbellek temizlendi ✓",
    "settings.providerHealth": "Veri Sağlayıcıları & Sistem Sağlığı",
    "settings.statusOk": "Aktif",
    "settings.statusWarn": "Yavaş / Yedek",
    "settings.statusDown": "Erişilemiyor",
    "settings.statusUnconfigured": "Anahtar Yok",
  },
  en: {
    // Navigation & Tabs
    "nav.yakin": "Nearby",
    "nav.rota": "Route",
    "nav.otobus": "Bus",
    "nav.rayli": "Rail",
    "nav.vapur": "Ferry",

    // Common
    "common.back": "Back",
    "common.close": "Close",
    "common.retry": "Retry",
    "common.save": "Save",
    "common.saved": "Saved ✓",
    "common.clear": "Clear",
    "common.cancel": "Cancel",
    "common.error": "Error",
    "common.live": "LIVE",
    "common.schedule": "Scheduled",
    "common.now": "Now",
    "common.edit": "Edit",
    "common.share": "Share",
    "common.installBanner": "Add to home screen for quick access",
    "common.installBtn": "Install",
    "common.networkError": "Connection failed. Please check your internet.",

    // Nearby View
    "nearby.title": "Nearby",
    "nearby.hubSelected": "hub selected",
    "nearby.backToLocation": "My location",
    "nearby.locLive": "Your location ±{acc} m",
    "nearby.locPending": "Locating GPS… showing {ad}",
    "nearby.locMissing": "Location unavailable. Enable GPS or pick a hub below.",
    "nearby.stopsHeading": "Nearby Stops & Stations",
    "nearby.pointsCount": "{n} stops",
    "nearby.favStops": "Favorite Stops",
    "nearby.favStopsEmpty": "Tap ⭐ on any stop board to pin your favorite stops.",
    "nearby.favLines": "Favorite Lines",
    "nearby.linesCount": "{n} lines",
    "nearby.noFavLines": "No favorite lines yet. Search in Bus tab and tap the star.",
    "nearby.lineFetchErr": "Line data unavailable",
    "nearby.noLocOrStop": "No location or selected stop.",
    "nearby.myStop": "My Stop",
    "nearby.nearestStop": "Nearest stop",
    "nearby.noApproaching": "No approaching buses in this direction",
    "nearby.smartTitle": "Smart Commute Suggestion",
    "nearby.goToWork": "Go to Work",
    "nearby.goToHome": "Go Home",
    "nearby.smartMorning": "Morning commute: plan a fast route to {ad}.",
    "nearby.smartEvening": "Evening return: open the best route to {ad}.",
    "nearby.heavyTrafficTip": "Heavy traffic (%{ti}). Rail or Ferry is recommended.",
    "nearby.fleetRadar": "Live Fleet Radar",
    "nearby.fleetOn": "Fleet On",
    "nearby.fleetOff": "Show Fleet",
    "nearby.fleetCount": "{n} buses",
    "nearby.etaFootnote": "Bus ETAs are computed from real-time speed, live traffic index, and stop dwell time.",

    // Traffic & Corridors
    "traffic.title": "Traffic Density",
    "traffic.loading": "Loading traffic…",
    "traffic.error": "Traffic unavailable: {msg}",
    "traffic.index": "Traffic %{ti}",
    "traffic.smooth": "Smooth",
    "traffic.moderate": "Moderate",
    "traffic.heavy": "Heavy",
    "traffic.severe": "Severe",
    "traffic.corridorsTitle": "Bridges, Tunnels & Traffic Incidents",
    "traffic.incidentsTitle": "Active Traffic Incidents",
    "traffic.noIncidents": "No active accidents or roadworks reported.",
    "traffic.incidentType.accident": "Accident",
    "traffic.incidentType.roadwork": "Roadwork",
    "traffic.incidentType.congestion": "Congestion",
    "traffic.incidentType.other": "Traffic Alert",

    // ETA & Vehicle
    "eta.arriving": "arriving",
    "eta.min": "~{n} min",
    "eta.stopsAway": "{n} stops",
    "eta.stopNext": "Next stop",
    "eta.distanceAway": "{m} away",
    "eta.trafficFactored": "traffic factored",
    "eta.lastUpdate": "Last Update",
    "eta.secAgo": "{n}s ago",
    "eta.minAgo": "{n}m ago",
    "eta.notify3m": "Notify on Approach (3 min)",
    "eta.notifying": "Alert Active ✓",
    "eta.speed": "Speed",
    "eta.trafficImpact": "Traffic Impact",
    "eta.stopDwell": "Stop Dwell",
    "eta.incidentWarn": "Traffic incident on corridor",
    "eta.deviation": "Deviation",
    "eta.delayed": "Delayed",
    "eta.outOfService": "Out of Service",
    "eta.plate": "Plate",
    "eta.operator": "Operator",
    "eta.breakdownTitle": "9-Factor ETA Breakdown",

    // Bus View
    "bus.title": "Bus & Metrobus",
    "bus.searchPlaceholder": "Line code or name: 500T, 34BZ, Kadıköy…",
    "bus.catAll": "All",
    "bus.catFav": "Favorites",
    "bus.catMb": "Metrobus",
    "bus.catAnn": "Alerts",
    "bus.results": "Results",
    "bus.noMatch": "No matching lines found.",
    "bus.annLines": "Lines with Active Alerts",
    "bus.noAnn": "No active line alerts right now.",
    "bus.mbLines": "Metrobus Lines",
    "bus.favLines": "Favorites",
    "bus.totalInfo": "Search across {n} İETT lines.",
    "bus.inService": "{n} in service",
    "bus.timetable": "Timetable",
    "bus.departureFrom": "Departs {ad}",
    "bus.nextDep": "Next departure",
    "bus.later": "later",
    "bus.noSchedule": "No scheduled departures for this day.",
    "bus.stops": "Stops ({n})",
    "bus.vehiclesOnDir": "{n} buses on this direction",
    "bus.vehicleMissing": "Vehicle currently not visible (trip ended or no GPS).",
    "bus.followMap": "Follow on map",
    "bus.following": "✓ Following",
    "bus.linePage": "Line details ›",
    "bus.nextStops": "Upcoming Stops",
    "bus.remaining": "{n} left",

    // Route View
    "route.title": "Route Planner",
    "route.myLocation": "My Location",
    "route.fromPlaceholder": "From?",
    "route.toPlaceholder": "To? (place, stop, station)",
    "route.pickDate": "Pick date & time",
    "route.findBtn": "Find Route",
    "route.calculating": "Computing routes…",
    "route.checkingLive": "Checking live bus positions and timetables…",
    "route.noResults": "No suitable routes found.",
    "route.emptyHint": "Type a destination, pick Home/Work, or tap on the map.",
    "route.home": "Home",
    "route.work": "Work",
    "route.add": "(add)",
    "route.tapMap": "Pick on map",
    "route.tapMapHint": "Tap a point on the map",
    "route.criteria.onerilen": "Recommended",
    "route.criteria.fastest": "Fastest",
    "route.criteria.fewest_transfers": "Fewest Transfers",
    "route.criteria.least_walking": "Least Walking",
    "route.criteria.least_waiting": "Least Waiting",
    "route.criteria.cheapest": "Cheapest",
    "route.criteria.traffic_resilient": "Traffic-Resilient",
    "route.fareFull": "Full {tl} ₺",
    "route.fareStudent": "Student {tl} ₺",
    "route.freeTransfer": "Free Transfer",
    "route.compareStrip": "Fastest {min} min · Min {tr} transfer · Lowest {tl} ₺",
    "route.disruptionTitle": "Delay or disruption detected on route",
    "route.recalcAlt": "Suggest Alternative Route",
    "route.direct": "direct",
    "route.transfers": "{n} transfers",
    "route.walkM": "{m} walk",
    "route.arrival": "arrival",
    "route.noService": "No Service",

    // Stop Modal & Settings
    "modal.stopBoard": "Departure Board",
    "modal.routeFrom": "Route From Here",
    "modal.routeTo": "Set Destination",
    "modal.noDepartures": "No upcoming departures found for this stop.",
    "modal.favStopAdd": "Save Stop",
    "modal.favStopRemove": "Saved Stop ✓",
    "modal.isparkEmpty": "Available Spaces",
    "modal.isparkOccupancy": "Occupancy {pct}%",
    "modal.isparkOpen": "Open",
    "modal.isparkClosed": "Closed",
    "modal.isparkHours": "Hours",
    "modal.isparkFree": "Free Period",
    "modal.isparkRoute": "Route Here",
    "settings.title": "Appearance & Settings",
    "settings.language": "Dil / Language",
    "settings.theme": "Theme",
    "settings.themeSystem": "System",
    "settings.themeLight": "Light",
    "settings.themeDark": "Dark",
    "settings.mapStyle": "Map Style",
    "settings.styleStandard": "Standard",
    "settings.styleClean": "Minimal",
    "settings.styleOsm": "OSM",
    "settings.proxy": "Advanced (Optional Proxy)",
    "settings.proxyHint": "Custom CORS proxy URL for mobile/web (optional)",
    "settings.clearCache": "Clear Cache",
    "settings.clearCacheDesc": "Resets cached lines, stops, and map tiles",
    "settings.clearCacheDone": "Cache cleared ✓",
    "settings.providerHealth": "Data Providers & System Health",
    "settings.statusOk": "Healthy",
    "settings.statusWarn": "Degraded",
    "settings.statusDown": "Unavailable",
    "settings.statusUnconfigured": "No Key",
  },
};

let currentLang = "tr";

function syncDomLang() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = currentLang;
  const navMap = {
    yakin: "nav.yakin",
    rota: "nav.rota",
    otobus: "nav.otobus",
    rayli: "nav.rayli",
    vapur: "nav.vapur",
  };
  document.querySelectorAll("#sekmeler button[data-sekme]").forEach((btn) => {
    const key = navMap[btn.dataset.sekme];
    const span = btn.querySelector("span:last-child");
    if (key && span) span.textContent = t(key);
  });
  const trafikBtn = document.querySelector("#trafikBtn");
  if (trafikBtn) {
    const label = t("traffic.title");
    trafikBtn.title = label;
    trafikBtn.setAttribute("aria-label", label);
  }
}

export function initLang() {
  let saved = null;
  try {
    saved = localStorage.getItem(LS_KEY);
  } catch {
    // ignore
  }
  if (saved === "tr" || saved === "en") {
    currentLang = saved;
  } else if (typeof navigator !== "undefined" && String(navigator.language || "").toLowerCase().startsWith("en")) {
    currentLang = "en";
  } else {
    currentLang = "tr";
  }
  syncDomLang();
  return currentLang;
}

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  currentLang = lang === "en" ? "en" : "tr";
  try {
    localStorage.setItem(LS_KEY, currentLang);
  } catch {
    // ignore
  }
  syncDomLang();
  return currentLang;
}

export function t(key, vars) {
  const dict = STRINGS[currentLang] || STRINGS.tr;
  let str = dict[key] ?? STRINGS.tr[key] ?? key;
  if (vars && typeof vars === "object") {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v ?? ""));
    }
  }
  return str;
}
