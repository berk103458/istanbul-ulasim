# Mimari — İstanbul Ulaşım

> Faz 1 mimarisi. Uygulama sürümü `package.json` dosyasında tanımlıdır. Worker ve yerel Node sunucusu sürümü `/health` ucunda raporlar.

---

## 1. Amaç ve kapsam

İstanbul toplu taşıma için harita tabanlı, canlı veri kullanan, çok platformlu bir uygulama. Çekirdek akış:

> **Arayüz → `API` sağlayıcı katmanı → `Bridge` → (doğrudan CORS | proxy) → İBB/İETT / Metro İstanbul / Şehir Hatları / TKM / İSPARK / Transitous (+ opsiyonel Google)**

Ek katmanlar: katmanlı önbellek (bellek + IndexedDB + service worker + statik `public/data` fallback), Web Worker rota motoru, PWA, Capacitor Android.

### Ürün kapsamı

- Canlı otobüs/metrobüs konumu, ETA, durak panosu, hat/durak araması, favoriler, bildirim eşiği.
- Metro/tramvay/füniküler/teleferik, Marmaray, vapur sefer saatleri.
- İSPARK, TKM trafik, harita katmanları, filo radarı.
- Akıllı rota planlayıcı (çok bacaklı A*, aktarmalı; opsiyonel Google Routes/Places).
- TR/EN i18n, açık/koyu tema, çevrimdışı dayanıklılık.

---

## 2. Mimariye genel bakış

```text
┌─────────────────────────────────────────────────────────────────────┐
│  Çalışma zamanı: Web/PWA  |  Capacitor Android  |  (Scriptable†)    │
│                                                                     │
│  src/main.js ──► src/views/* + src/map/mapController.js  (DOM)      │
│        │                                                            │
│        ▼                                                            │
│  src/engines/* (DataProvider, EtaEngine, TrackingEngine,            │
│                 TrafficEngine, RouteEngine, NotificationEngine)     │
│        │                                                            │
│        ▼                                                            │
│  src/core/api.js (API.*)  ──► src/core/bridge.js (Bridge.http)      │
│        │        ╲__ katmanlı cache: mem + KV(IndexedDB)             │
│        ▼                                                            │
│  [doğrudan CORS host]  veya  GET/POST /api/proxy                    │
│        │                                                            │
│        ▼                                                            │
│  PROXY ÇEKİRDEĞİ: server/proxyCore.js                               │
│   • SSRF allowlist • GET/POST • header süzme • UA • 25s timeout     │
│   • TTL cache (X-Proxy-Cache) • coalescing • circuit breaker        │
│   • stale failover • CORS                                           │
│        │                                                            │
│        ▼                                                            │
│  Yukarı akış veri kaynakları (allowlisted):                         │
│   api.ibb.gov.tr (İETT SOAP+JSON, Metro, İSPARK, TKM host'u ayrı)   │
│   tkmservices.ibb.gov.tr (TKM trafik/iskele)                        │
│   sehirhatlari.istanbul / www.sehirhatlari.istanbul (Vapur HTML)    │
│   api.transitous.org (geocode/plan/stops)                           │
│                                                                     │
│  Statik fallback: public/data/*.json  +  KV cache  +  sw.js         │
└─────────────────────────────────────────────────────────────────────┘

Proxy'yi sunan adapter'lar (aynı çekirdek, server/proxyCore.js):
  • functions/api/proxy.js   — Cloudflare Pages Function
  • worker.js (/api/proxy)   — Cloudflare Worker
  • server/localServer.js   — yerel geliştirme ve test

Rota motoru ayrı iş parçacığında:
  src/workers/router.worker.js ── INIT_GRAPH / rota mesajları ──► src/core/router.js (Plan)

† Scriptable (`window.__SCRIPTABLE__`, `İstanbul Ulaşım.js`, `legacy/`) şu an çalışır; Faz 5'te kaldırılacak.
```

---

## 3. Çalışma zamanları

`src/core/bridge.js` `Bridge.runtime` ile dört mod ayırt eder:

| Mod | Tespit | HTTP davranışı | Not |
| --- | --- | --- | --- |
| **web** | varsayılan | `isDirectCorsHost` → doğrudan; aksi `./api/proxy` veya `customProxyBase/api/proxy`; `404/405` → `proxyMissing` + statik fallback | PWA + service worker |
| **capacitor** | `window.Capacitor.isNativePlatform()` | `CapacitorHttp.request` (UA, 20/25 sn timeout); hata + `customProxyBase` → `/api/proxy` | Android; `CapacitorHttp.enabled:false`; konum `@capacitor/geolocation`; `App.backButton` |
| **scriptable** | `window.__SCRIPTABLE__` | `__bridgeCall("http"...)`, `__bridgeTake/__bridgeDeliver`, `__bridgeCall("location"/"open")` | **Faz 5'te kaldırılacak** |
| **node** | `typeof window === "undefined"` | doğrudan `fetch`, UA `IstanbulUlasim/5.0` | testler, yerel sunucu, derleme scriptleri |

`Bridge.getProxyUrl()` / `setProxyUrl()` kullanıcı proxy adresi (`customProxyBase`; kalıcı `ulasim.proxyUrl` + `KV proxyUrl`). Boş → aynı-origin `./api/proxy`.

### Dağıtım adapter'ları

- **Cloudflare Pages** `wrangler.jsonc` ile `dist/` dosyalarını ve `functions/api/proxy.js` adapter'ını kullanır. `onRequest`, isteği doğrudan `handleProxyHttpRequest` işlevine iletir.
- **Cloudflare Workers** `wrangler.worker.jsonc` ile `worker.js` dosyasını çalıştırır. `/api/proxy` için aynı `handleProxyHttpRequest` işlevini çağırır. `/health` sürümü raporlar. Statik dosyalar ve SPA fallback'i `ASSETS` bağlaması üzerinden sunulur.
- **Yerel Node sunucusu** `npm start` komutuyla `server/localServer.js` dosyasını çalıştırır ve `127.0.0.1:4173` adresini dinler. Port `PORT` ile ayarlanabilir. Paylaşılan proxy çekirdeğini, statik dosyaları, SSE/filo, sağlık, metrik ve Google Maps uçlarını geliştirme ve test için sunar.
- **Capacitor 8 Android** derlemesi `npm run build` → `npx cap sync android` → Android Studio / `gradlew` sırasını izler. Node.js 22+, JDK 21, Android SDK Platform 36 ve SDK Build-Tools 35.0.0 gerekir. Proje Gradle Wrapper 8.14.3 ve Android Gradle Plugin 8.13.0 kullanır. IDE ile derlemek için Android Studio Otter (2025.2.1) veya üstü gerekir.
- **Scriptable (Faz 5'te kaldırılacak):** `İstanbul Ulaşım.js`, `legacy/İstanbul Ulaşım.v3.8.js`, `scripts/build-scriptable.mjs`, `npm run build:scriptable` → `releases/`; native köprü; `fetchStaticJson` kapalı (`window.__SCRIPTABLE__`).

---

## 4. Klasör yapısı

```text
src/
├── main.js                  Önyükleme; S durumu; S.yigin router; rotalar (yakin/rota/rdetay/otobus/hat/arac/rayli/rhat/ist/vapur/vhat);
│                            delege edilmiş olaylar; panel fiziği; PWA; Capacitor backButton; periyodik döngüler (5s/1s/120s/60s);
│                            NotificationEngine; lazy view yükleyiciler; surgicalLiveUpdate; applyTheme; KV hidrasyonu
├── core/
│   ├── api.js               Sağlayıcılar + cache + SOAP + Transitous + fallback; MARMARAY_STATIONS; API.{iett,metro,marmaray,vapur,trafik,iskeleler,ispark,transitous,ag,http}
│   ├── bridge.js            Bridge: runtime, http, proxy, location, openUrl, Scriptable kuyruğu
│   ├── geo.js               Core: mesafe (haversine, R=6371000), yonAcisi, geometri; saf hesap
│   ├── router.js            Plan (rota v5): graf kurulumu Plan.kur, Plan.ara, buildStopLinesIndex; otobüs/metrobüs/rayli/vapur/yürüme; A*; aktarma; ETA; i18n adları
│   ├── storage.js           KV: IndexedDB `istanbul-ulasim-v4`/`kv`, localStorage fallback, PREF_KEYS, SWR `get(key,maxAge)`, `set`
│   └── time.js              Zaman: dk, saatFormat, simdi (+1440 gece yarısı), kalanYazi, yerelISO, siraKarsilastir, gün tipleri
├── engines/
│   ├── dataProvider.js      DataProvider: coalesce, swr, health, hasBackendProxy, connectStream(SSE), fetchFleetBbox
│   ├── etaEngine.js         EtaEngine: 9-faktör ETA (bkz. kod)
│   ├── trackingEngine.js    TrackingEngine: canlı araç takibi/smoothing
│   ├── trafficEngine.js     TrafficEngine: TKM segment işleme
│   ├── routeEngine.js       RouteEngine: rota yardımcıları
│   └── notificationEngine.js NotificationEngine: watchStopBus, checkUpdates, toast, kalıcı watches
├── views/                   DOM üreten görünümler; main.js `ciz()` ile lazy import
│   ├── nearbyView.js        `yakin` + HIZLI_SEMTLER (eager)
│   ├── busView.js           `otobus`/`hat`/`arac`
│   ├── railView.js          `rayli`/`rhat`/`ist`
│   ├── ferryView.js         `vapur`/`vhat`
│   ├── routeView.js         `rota`/`rdetay`
│   └── stopModal.js         durak panosu + İSPARK + ayarlar
├── map/mapController.js     Leaflet; createMapController; canlı araçlar; trafik; İSPARK; filo; tahmini iz; esc/hataMesaji
├── workers/router.worker.js Web Worker; Plan; INIT_GRAPH; mergeRoutes; rota mesajları
├── services/googleMapsService.js  Opsiyonel Google (sunucu proxy üzerinden)
├── i18n/index.js            tr/en; initLang/setLang/t
├── ui/icons.js              SVG iconSvg
└── styles/                  tokens.css, layout.css, components.css, map.css

public/
├── data/                    iett-hatlar.json, iett-ag.json, iett-duyurular.json, iett-sefer-populer.json, vapur.json, ispark.json
├── icons/                   PWA ikonları
├── manifest.webmanifest
└── sw.js                    service worker

scripts/                     Node ESM
├── build-static-data.mjs    canlı kaynak → public/data/*.json (npm script YOK; node scripts/build-static-data.mjs)
├── generate-icons.mjs       npm run icons (sharp; assets-src/icon-master.png | public/icons/icon-master.png)
└── build-scriptable.mjs     npm run build:scriptable (dist → tek dosya Scriptable; releases/) [Faz 5]

functions/api/proxy.js       Cloudflare Pages Function adapter'ı
server/                      proxyCore.js, cacheLayer.js, apiGateway.js, sseHub.js, googleMapsProxy.js
server/localServer.js        yerel Node geliştirme ve test sunucusu
worker.js + wrangler.worker.jsonc   Cloudflare Worker ve statik dosyalar
wrangler.jsonc               Cloudflare Pages yapılandırması
android/                     Capacitor 8 (com.berk.istanbululasim, minSdk 24, target/compile 36)
tests/                       verify-all.mjs (npm test), benchmark-and-verify.mjs
legacy/                      Scriptable v3.8 [Faz 5]
İstanbul Ulaşım.js           Scriptable v3.8 kök kopya [Faz 5]
releases/                    sürüm artefaktları [Faz 5 ilgili]
assets-src/                  ikon kaynağı
```

### `package.json` scripts (doğrulanmış)

| script | komut |
| --- | --- |
| `dev` | `vite` |
| `build` | `vite build` |
| `preview` | `vite preview` |
| `start` | `node server/localServer.js` |
| `icons` | `node scripts/generate-icons.mjs` |
| `build:scriptable` | `node scripts/build-scriptable.mjs` |
| `pretest` | `npm run build` |
| `test` | `node tests/verify-all.mjs` |

Çağrılar: `npm run <script>`; `npm test` ≡ `npm run test`. `npm install` bağımlılık kurulumu (script değil). **Bağımlılık eklenmedi.** `scripts/build-static-data.mjs` herhangi bir npm script'e bağlı değildir.

---

## 5. Veri kaynakları

`src/core/api.js` sabitleri: `IETT=https://api.ibb.gov.tr/iett`, `METRO=https://api.ibb.gov.tr/MetroIstanbul/api/MetroMobile/V2/`, `VAPUR=https://sehirhatlari.istanbul`, `TKM=https://tkmservices.ibb.gov.tr/web/api/`, `TR=https://api.transitous.org/api/v1/`, `ISPARK_URL=https://api.ibb.gov.tr/ispark/Park`.

| Kaynak | Uçlar | Not |
| --- | --- | --- |
| **İETT (İBB)** | SOAP `/iett/UlasimAnaVeri/HatDurakGuzergah.asmx` `GetHat_json`; `/iett/FiloDurum/SeferGerceklesme.asmx` `GetHatOtoKonum_json`; `/iett/ibb/ibb.asmx` `DurakDetay_GYY`; `/iett/UlasimAnaVeri/PlanlananSeferSaati.asmx` `GetPlanlananSeferSaati_json`; `/iett/UlasimDinamikVeri/Duyurular.asmx` `GetDuyurular_json` | SOAP zarfı + `SOAPAction`; `DOMParser`; `<...Result>`; fallback `iett-hatlar.json`/`iett-ag.json`/`iett-duyurular.json`/`iett-sefer-populer.json`; sefer fallback zinciri (statik `iett-sefer-populer` → Transitous → boş); Metrobüs `tarife` regex `METROBÜS` |
| **Metro İstanbul** | `GetLines`, `GetStations`, `GetDirectionById/:id`, `GetTimeTable` (POST), `GetServiceStatuses` | `Success`/`Data`; renk `rgb(...)`; bazı istasyon koordinat düzeltmeleri; hata → `[]` (durum) |
| **Marmaray** | **Canlı API yok.** `MARMARAY_STATIONS` (43 istasyon; km; aktarmalar) | `saatler()` ve `aktifTrenler()` **yerel sentez**: 06:00–23:58, iç hat 8 dk/diş 15 dk, Pendik–Ataköy segmenti; sabit `ilk/son`, renk `#0ea5e9` |
| **Şehir Hatları (Vapur)** | `sehirhatlari.istanbul/tr/seferler` + hat sayfaları | HTML `DOMParser`; hat grupları (İstanbul İçi/Boğaz/Adalar); tarife tabloları; 4 eşzamanlı işçi; fallback `vapur.json` |
| **TKM (İBB trafik)** | `tkmservices.ibb.gov.tr/web/api/TrafficData/v3/Segments/:seviye`, `/v4/SegmentData`, `/v1/TrafficIndex_Sc1_Cont`, `IntensityMap/v2/Piers` | segment geometrisi; 90 sn `SegmentData` cache; indeks; iskeleler (`NM/LT/LN/OP`); renk skalası `TRAFIK_RENK` |
| **İSPARK** | `api.ibb.gov.tr/ispark/Park` | kapasite/boş/ücretsiz dk; koordinat süzme; 2 dk cache; `yakinlar` haversine; fallback `ispark.json` |
| **Transitous** | `api.transitous.org/api/v1/plan`, `/geocode`, `/map/stops`, `/stoptimes` | İstanbul bbox süzme; `numItineraries=5`; canlı `realTime`; rota fallback |
| **Google (opsiyonel)** | `server/googleMapsProxy.js` + `src/services/googleMapsService.js` | yerel Node sunucusunda anahtarla `/api/google/routes`, `/api/google/places` ve `/api/google/geocode` |
| **SSE (yerel)** | `/api/stream`, `/api/fleet` (`server/sseHub.js`) | `DataProvider.connectStream`, `fetchFleetBbox` |

### Statik fallback (`public/data`)

Üretici: `scripts/build-static-data.mjs`. Tüketici: `fetchStaticJson()` (`./data/<relPath>`, `staticMem`, Scriptable kapalı) + `DataProvider` SWR. Dosyalar: `iett-hatlar.json`, `iett-ag.json`, `iett-duyurular.json`, `iett-sefer-populer.json`, `vapur.json`, `ispark.json`. **Canlı veri tercih edilir; statik yalnızca hata/offline içindir.**

---

## 6. Veri akışı

### 6.1 İstek yaşam döngüsü

1. `src/views/*` / `src/map/mapController.js`, `API.*` çağırır (ör. `API.iett.konum(hat)`, `API.trafik.veri()`, `API.ispark.liste()`, `API.transitous.plan(...)`).
2. `API` kendi katmanlı önbelleği: bellek `mem` + `KV.get/set`; TTL'ler (`GUN=864e5`, durak 7 gün, duyuru 3 dk, sefer 1 gün, vapur 6 sa, ispark 2 dk, trafik geo 7 gün, `iett.ag.v1` 7 gün; `ag.otobus` `kv` + statik + `Promise.all` 6 işçi). `DataProvider.swr` ek stale-while-revalidate + coalescing.
3. `Bridge.http` platform/ proxy kararını uygular (`isDirectCorsHost`, `customProxyBase`, `proxyMissing`, Capacitor `CapacitorHttp`, Scriptable, node). 25 sn `AbortController`.
4. Proxy `handleProxyRequest`:
   - **Doğrula:** `url` + `isAllowedUrl` (protokol http/https, host allowlist) → `403 {error:"Forbidden target host"}`; method `GET/POST` → `405`; CORS `*`, `OPTIONS 204`.
   - **Anahtar:** `METHOD:url:body`. **TTL** `getCacheTtlSeconds` (aşağıdaki tablo).
   - **Cache:** `sharedCache.getWithRedisFallback(..., {allowStale:true})`; taze `HIT`; `Cache-Control public, max-age=TTL, s-maxage=TTL`; boş TTL `no-store`; `X-Proxy-Cache`.
   - **Circuit breaker:** `gateway.isCircuitOpen(provider)` → `STALE-FAILOVER` veya `503`; `detectProvider`; `recordSuccess/recordFailure`; `coalesce`.
   - **Fetch:** süzülmüş header + `User-Agent`, 25 sn timeout, `POST` body string; yanıt ham metin + `content-type`. 2xx–3xx → cache; `X-Proxy-Cache: MISS`. Hata → `recordFailure`, `STALE-FAILOVER` veya `502`.
5. `API` normalize eder (İETT JSON/XML, Metro `Data`, Vapur HTML, TKM, İSPARK, Transitous). Hata → `catch` → statik/KV/`[]`/`null`/`{}`; canlı `GetHatOtoKonum` hata → `[]`.
6. `DataProvider` sağlayıcı sağlığını günceller; UI `panelYenile` + `surgicalLiveUpdate`; `NotificationEngine.checkUpdates`; yerel SSE `konumIsle` + `aracCiz`.
7. **Kalıcılık:** `KV` (IndexedDB `istanbul-ulasim-v4`, `localStorage` fallback, `ulasim.proxyUrl`); `public/sw.js`; `localStorage` tema/dil. Kişisel veri harici sunucuya gönderilmez (sadece proxy'lenen **hedef URL/body**; örn. SOAP, Transitous koordinatları!).

> Not: Transitous `plan`/`geocode`/`map/stops` istekleri kullanıcı konumu/koordinatlarını içerir ve proxy'lenir; allowlist dışına çıkmaz.

### 6.2 Proxy TTL tablosu (`server/proxyCore.getCacheTtlSeconds`, saniye)

| Koşul (URL/body, küçük harf/birebir) | TTL |
| --- | --- |
| `GetHatOtoKonum` / `gethatotokonum` | 5 |
| `GetFiloAracKonum` / `getfiloarackonum` | 6 |
| `SegmentData`, `TrafficIndex`, `currentAnnouncement`, `segmentdata`, `trafficindex`, `currentannouncement` | 30 |
| `GetDuyurular` / `getduyurular` | 180 |
| `ispark/park` | 120 |
| `sehirhatlari.istanbul` | 600 |
| `GetHat_json`/`gethat_json`, `DurakDetay_GYY`/`durakdetay`, `GetPlanlananSeferSaati`/`planlanansefersaati`, `metroistanbul` | 600 |
| diğer | 0 (`no-store`) |

Pages ve Worker aynı TTL, önbellek, circuit breaker ve istek birleştirme kurallarını uygular.

### 6.3 Proxy güvenliği (SSRF ve sınırlar)

- `ALLOWED_HOSTS` kesin küme; `http/https`; başka host `403`. `isAllowedUrl` `URL` parse + protokol + hostname.
- `GET/POST` only; `OPTIONS`.
- İletilen header'lar **sadece** `content-type`, `soapaction`, `accept`; sabit `User-Agent`; `SOAPAction` İETT için.
- 25 sn `AbortController`; `clearTimeout`.
- CORS `Access-Control-Allow-Origin: *`, `GET, POST, OPTIONS`, `Content-Type, SOAPAction`.
- `proxyCore` hata gövdelerini JSON olarak oluşturur. Yerel Node sunucusu 2 MB gövde sınırı, IP bazlı `429`, gzip, statik yol normalizasyonu, `/api/health` ve `/api/metrics` sağlar.
- Cache `server/cacheLayer.js`: bellek + **Redis fallback** (`sharedCache`, `allowStale`); `X-Proxy-Cache`; `getMetrics`. (Cloudflare adapter ek altyapı gerektirmez.)

---

## 7. Rota motoru (`src/core/router.js`, `Plan`)

- Girdi: `Plan.kur(ag)` — hatlar, istasyonlar, Metrobüs, vapur, `marmaray`, gün tipi, saat; durak-hat indeksi `buildStopLinesIndex`.
- **Çok bacaklı A\*:** `Plan.ara(ag, from, to, saat)`; modlar `metro`, `marmaray`, `tram`, `fun`, `tf`, `mb`, `vapur`, `otobus`, `yuru`; sabitler `YURUME_M_DK=80`, `YURUME_SAPMA=1.25`, `ERISIM_M=1200`, `ERISIM_GENIS_M=2500`, `ERISIM_MAX_DURAK=40`, `AKTARMA_RAYLI_M=600`, `AKTARMA_OTOBUS_M=350`, `BINIS_CEZASI=10`, `TUR_HIZ`, `TUR_ARALIK`, `HAT_TOPLAM`, `HAT_RENK`.
- **Web Worker:** `src/workers/router.worker.js`; `INIT_GRAPH`; istek/cevap `id`; `mergeRoutes` (doğrudan + alternatif, `imza`, `varis` sıralı); ana iş parçacığı bloklanmaz.
- **Transitous birleştirme:** `API.transitous.plan` itinerary'leri + yerel sonuçlar; `routeEngine`. **Fallback:** veri yoksa statik/Marmaray; `rMr` testleri.
- **ETA:** `src/engines/etaEngine.js` (9-faktör); `mc.yaklasanOtobusler`, `hedefDurak`, `tahminiCiz`, `oluHesap`; canlı 5 sn `canliTur`.
- Google (opsiyonel) `services/googleMapsService.js` + `server/googleMapsProxy.js`; aksi halde yerel `Plan` + Transitous.

---

## 8. Önbellek ve kalıcılık katmanları

| Katman | Konum | Amaç |
| --- | --- | --- |
| `mem` / `memCache` | `api.js`, `dataProvider.js`, `mc` | senkron bellek; TTL |
| `KV` | `storage.js` IndexedDB + `localStorage` | kalıcı SWR; tercihler; `ulasim.proxyUrl` |
| `staticMem` + `public/data` | `fetchStaticJson` | canlı hata/offline statik fallback |
| Proxy cache | `server/cacheLayer.js` (+Redis) | sunucu/proxy TTL + stale; `X-Proxy-Cache` |
| Service worker | `public/sw.js` + `manifest.webmanifest` | PWA; `no-cache` `sw.js` |
| İki katman `trafik` | `trafik.geo.*`, `trafik.veri`, mem | geometri 7 gün; veri 90 sn |

**Stale-while-revalidate:** `DataProvider.swr` bayatı döndür + arka plan tazele; `KV` bayat okunabilir. **In-flight coalescing:** `coalesce`, `gateway.coalesce`. **Circuit breaker:** `gateway.isCircuitOpen`. **Stale failover:** proxy `hit` + `STALE-FAILOVER`.

---

## 9. UI, i18n, PWA, Android köprüsü

- `src/main.js`; `src/views`; `src/map`; Leaflet; alt sayfa; `panelKonum`; `applyTheme`; `HIZLI_SEMTLER`; `surgicalLiveUpdate`; `Promise.all` KV hidrasyonu; `setInterval` (CANLI_SN=5; 1s; 120s; 60s); `history` + `popstate`; lazy import; toast; `beforeinstallprompt`.
- **i18n** `src/i18n` tr/en; `t(key, params)`; `KV lang`; `html lang`.
- **PWA** `manifest.webmanifest`, `sw.js`, ikonlar; `navigator.serviceWorker.register("/sw.js")`; HTTPS/localhost.
- **Capacitor** `App`, `Geolocation`, `StatusBar`, `CapacitorHttp`; `webDir=dist`; `androidScheme=https`; `appId=com.berk.istanbululasim`; `android/`. `Bridge` Capacitor yolu.
- **Scriptable** (Faz 5'te kaldırılacak) `Bridge` + `KV` + `__bridge*`; `window.__SCRIPTABLE__`; `scripts/build-scriptable.mjs`; `İstanbul Ulaşım.js`/`legacy`.

---

## 10. Build, test, veri üretimi

### Build

`npm ci` ile kilitli bağımlılıkları kurun ve `npm run build` ile Vite 6 çıktısını `dist/` dizinine yazın. `npm run dev`, port 5173'te açılır ve `/api/proxy` isteklerini `npm start` ile başlatılan yerel sunucuya iletir. `npm run preview` statik derlemeyi sunar. Android için `npx cap sync android` ve `gradlew` kullanılır.

### Test (`npm test`)

`npm test`, `pretest` ile web uygulamasını derler ve `tests/verify-all.mjs` betiğini çalıştırır. Varsayılan test internet bağlantısı gerektirmez.

1. Birim testleri `Zaman`, `Core`, `API.marmaray` ve `Plan.kur/ara` bileşenlerini kapsar.
2. Yerel sunucu ve proxy entegrasyon testleri statik dosya sunumunu, `/health` yanıtını ve SSRF `403` kontrolünü doğrular. İETT `GetDuyurular_json`, Şehir Hatları ve İSPARK için sabit yerel yanıtlar kullanılır. `npm test -- --live` bu üç kontrolü canlı servislerle yapar ve internet bağlantısı gerektirir.
3. Betik `releases/Istanbul-Ulasim-v4.0-iOS-Scriptable.js` dosyasını `node --check` ile denetler. `releases/Istanbul-Ulasim-v4.0-Android.apk` varsa boyutu ve ZIP dosya başlığı doğrulanır. `npm test -- --require-apk` APK'nın bulunmasını zorunlu kılar. Artefakt adlarındaki `v4.0` tarihsel dosya adının parçasıdır.

`node tests/benchmark-and-verify.mjs` ayrı performans ve ek kontrol betiğidir.

### Veri üretimi

`node scripts/build-static-data.mjs` (npm script yok; canlı ağ; UA; SOAP; HTML; `public/data/*.json`). `npm run icons`. `npm run build:scriptable` (`dist`→`releases`; önce build; Faz 5).

---

## 11. Güvenlik ve gizlilik notları

- Proxy çekirdeği SSRF allowlist'i, yöntem ve header süzme, CORS, zaman aşımı, circuit breaker ve sabit `User-Agent` uygular. Yerel Node sunucusu gövde boyutunu ve IP bazlı istek sayısını sınırlar.
- API anahtarları (ör. Google) **sunucu** tarafında; istemciye gömülmez. Harici veri yalnızca izinli hedeflere proxy'lenir.
- Kişisel veri harici sunucuda tutulmaz; önbellek cihazda / proxy üzerinde; `KV` yerel. (Transitous koordinatları hedefe gider; bkz. §6.1.)

---

## 12. Kararlar ve planlanan değişiklikler

### Faz 1

Üretim hedefi Cloudflare. Pages ve Workers aynı `/api/proxy` sözleşmesini ve çekirdeği paylaşır. Her iki yapılandırma da `2025-11-01` uyumluluk tarihini ve `nodejs_compat` bayrağını kullanır. Yerel önizleme komutları README'dedir.

### Faz 4

Capacitor ve resmi eklentiler 8.x'e yükseltildi. Android 7.0 (API 24) ve üzeri desteklenir. Android sistem çubukları için `SystemBars.initialViewportFitValueHint` değeri, web uygulamasının `viewport-fit=cover` ayarını başlangıçta bildirir.

### Faz 5

- `İstanbul Ulaşım.js`, `legacy/İstanbul Ulaşım.v3.8.js`, `scripts/build-scriptable.mjs`, `npm run build:scriptable`, `releases/`, `window.__SCRIPTABLE__` köprüsü, `src/core/storage.js` Scriptable/localStorage uyumu, `api.js` Scriptable yolları, `tests/verify-all.mjs` Scriptable artefakt kontrolü.

---

## 13. Faz 0 kapsamı

Faz 0, uygulamanın `5.0.0` sürümünü, derleme ve test onarımını, `README.md` ve `docs/ARCHITECTURE.md` belgelerini bir araya getirir. Temiz kurulum `npm ci`, üretim derlemesi `npm run build` ve doğrulama `npm test` ile yapılır.
