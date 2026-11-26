# Mimari — İstanbul Ulaşım

> Faz 0 mimarisi. Uygulama sürümü `5.0.0` ve `package.json` dosyasında tanımlıdır. Tam Node sunucusunun `/api/health` ucu uygulama sürümünü raporlar.

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
  • functions/api/proxy.js   — Cloudflare Pages Function  [HEDEF]
  • server.js (/api/proxy)   — tam Node sunucusu          [Faz 1'de kaldırılacak]
  • worker.js (/api/proxy)   — bağımsız Cloudflare Worker [hedef dışı varyant]
  • api/proxy.js             — Vercel serverless          [Faz 1'de kaldırılacak]

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
| **node** | `typeof window === "undefined"` | doğrudan `fetch`, UA `IstanbulUlasim/5.0` | testler, `server.js`, build scriptleri |

`Bridge.getProxyUrl()` / `setProxyUrl()` kullanıcı proxy adresi (`customProxyBase`; kalıcı `ulasim.proxyUrl` + `KV proxyUrl`). Boş → aynı-origin `./api/proxy`.

### Dağıtım adapter'ları

- **Cloudflare Pages (HEDEF):** statik `dist/` + `functions/api/proxy.js`. `functions/` altında Cloudflare Pages Function; `onRequest`, `OPTIONS`, `GET ?url=`, `POST` JSON; `handleProxyRequest`. **Yalnızca Cloudflare.**
- **Cloudflare Worker (varyant):** `worker.js` + `wrangler.jsonc`; `main: worker.js`, `assets.directory ./dist`, `run_worker_first ["/api/*","/health"]`, `single-page-application`; `/api/proxy`, `/health`, `env.ASSETS`. Basitleştirilmiş proxy (circuit breaker/coalescing yok). Hedef dışı; planlanan konsolidasyon Cloudflare `functions/api/proxy.js`.
- **Tam Node sunucusu (Faz 1'de kaldırılacak):** `server.js` (`npm start`, port 4173/`PORT`); `dist/` (yoksa `public/`), SPA fallback, gzip, MIME, cache headers; `/api/proxy`, `/api/stream`, `/api/fleet`, `/api/health`, `/api/metrics`, `/api/google/routes|places|geocode`; IP rate limit; `server/sseHub.js`, `server/googleMapsProxy.js`, `server/cacheLayer.js`, `server/apiGateway.js`. **Render** `render.yaml` + `npm start`.
- **Vercel (Faz 1'de kaldırılacak):** `vercel.json` + `api/proxy.js` (`handleProxyRequest`, CORS, `OPTIONS`, `GET/POST`), build `npm run build`, output `dist`, `/sw.js no-cache`, rewrite `/api/proxy`.
- **GitHub Pages (Faz 1'de kaldırılacak):** `.github/workflows/deploy-pages.yml`; Node 22, `npm ci || npm install`, `npm run build`, `cp dist/index.html dist/404.html`, Pages deploy; `base: "./"`.
- **Capacitor Android:** `capacitor.config.json` + `android/`; `npm run build` → `npx cap sync android` → Android Studio / `gradlew`. Bkz. README.
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

functions/api/proxy.js       Cloudflare Pages Function [HEDEF proxy]
server/                      proxyCore.js, cacheLayer.js, apiGateway.js, sseHub.js, googleMapsProxy.js
server.js                    tam Node sunucusu [Faz 1]
api/proxy.js                 Vercel [Faz 1]
worker.js + wrangler.jsonc   Cloudflare Worker varyantı
android/                     Capacitor native Android (com.berk.istanbululasim; minSdk 22; target/compile 34)
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
| `start` | `node server.js` |
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
| **Google (opsiyonel)** | `server/googleMapsProxy.js` + `src/services/googleMapsService.js` | sunucu anahtarı; `/api/google/routes|places|geocode`; tam Node sunucusu; hedef proxy setinde değil; `google` sağlık anahtarı |
| **SSE (tam sunucu)** | `/api/stream`, `/api/fleet` (`server/sseHub.js`) | `DataProvider.connectStream`, `fetchFleetBbox`; proxy yoksa kapalı; Cloudflare hedef proxy'de yok |

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
6. `DataProvider` sağlayıcı sağlığını günceller; UI `panelYenile` + `surgicalLiveUpdate`; `NotificationEngine.checkUpdates`; SSE (tam sunucu) `konumIsle` + `aracCiz`.
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

> Bağımsız `worker.js` varyantında sadeleştirilmiş TTL (ör. `GetHatOtoKonum` 4 sn; `GetFiloAracKonum` yok; `currentAnnouncement` yok) ve stale/coalescing/breaker yok. Hedef `functions/api/proxy.js` `proxyCore.js` çekirdeğini kullanır.

### 6.3 Proxy güvenliği (SSRF ve sınırlar)

- `ALLOWED_HOSTS` kesin küme; `http/https`; başka host `403`. `isAllowedUrl` `URL` parse + protokol + hostname.
- `GET/POST` only; `OPTIONS`.
- İletilen header'lar **sadece** `content-type`, `soapaction`, `accept`; sabit `User-Agent`; `SOAPAction` İETT için.
- 25 sn `AbortController`; `clearTimeout`.
- CORS `Access-Control-Allow-Origin: *`, `GET, POST, OPTIONS`, `Content-Type, SOAPAction`.
- `proxyCore` hata gövdeleri JSON. Tam `server.js` ek: `2MB` gövde sınırı, IP rate limit `429`, `gzip`, path normalize + traversal koruması, `/api/health` + `/api/metrics`.
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

`npm install` → `npm run build` (`vite build`, `dist/`, `assets/`, `base:"./"`, sourcemap kapalı, esbuild, `outDir dist`). Dev `npm run dev` (5173 + `/api/proxy`→4173; `npm start` 4173 ile tam backend); `npm run preview`. Capacitor `npx cap sync android` + `gradlew`. `npm start` `server.js` 4173/`PORT`.

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

- SSRF allowlist; method/CORS/header süzme; timeout; body sınırı (tam sunucu); rate limit (tam sunucu); circuit breaker; statik `User-Agent`.
- API anahtarları (ör. Google) **sunucu** tarafında; istemciye gömülmez. Harici veri yalnızca izinli hedeflere proxy'lenir.
- Kişisel veri harici sunucuda tutulmaz; önbellek cihazda / proxy üzerinde; `KV` yerel. (Transitous koordinatları hedefe gider; bkz. §6.1.)
- Scriptable/legacy ve ekstra dağıtım yüzeyleri **kapsam dışına** alınacak (aşağı).

---

## 12. Kararlar ve planlanan değişiklikler

### Karar: hedef dağıtım yalnızca Cloudflare

Tek üretim hedefi **Cloudflare**; statik `dist/` + **Cloudflare Pages Function `functions/api/proxy.js`**. **Proxy tek uçtur.** Proxy çekirdeği `server/proxyCore.js`. (Şu an kod birden çok adapter içerir; **planlanan** konsolidasyon.)

### Planlanan değişiklikler (bu görevde UYGULANMADI; yalnızca not)

**Faz 1 — kaldırılacak dağıtım hedefleri:**

- **Render** `render.yaml` (+ `npm start`/`server.js` dağıtımı).
- **Vercel** `vercel.json` + `api/proxy.js`.
- **GitHub Pages** `.github/workflows/deploy-pages.yml`.
- Sonuç: **Render, Vercel, GitHub Pages Faz 1'de kaldırılacak**; **hedef dağıtım yalnızca Cloudflare (`functions/api/proxy.js`)** kalacak. `server.js`, `server/*`, `worker.js`/`wrangler.jsonc` ele alınacak.

**Faz 5 — Scriptable/legacy kaldırılacak:**

- `İstanbul Ulaşım.js`, `legacy/İstanbul Ulaşım.v3.8.js`, `scripts/build-scriptable.mjs`, `npm run build:scriptable`, `releases/`, `window.__SCRIPTABLE__` köprüsü, `src/core/storage.js` Scriptable/localStorage uyumu, `api.js` Scriptable yolları, `tests/verify-all.mjs` Scriptable artefakt kontrolü.

---

## 13. Faz 0 kapsamı

Faz 0, uygulamanın `5.0.0` sürümünü, derleme ve test onarımını, `README.md` ve `docs/ARCHITECTURE.md` belgelerini bir araya getirir. Temiz kurulum `npm ci`, üretim derlemesi `npm run build` ve doğrulama `npm test` ile yapılır.
