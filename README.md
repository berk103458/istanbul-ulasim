# İstanbul Ulaşım

İstanbul toplu taşıma için canlı, harita tabanlı uygulama: **Canlı Otobüs, Metrobüs, Metro, Marmaray, Vapur, İSPARK ve akıllı rota planlayıcı**. Tek sayfa uygulama (Vite), PWA ve **Capacitor Android** hedefli; veriler İBB/İETT, Metro İstanbul, Şehir Hatları, İBB trafik ve Transitous açık veri kaynaklarından **CORS-güvenli bir proxy** üzerinden çekilir, statik `public/data` yedeği ve tarayıcı önbelleğiyle çevrimdışı dayanıklılık sağlanır. Türkçe/İngilizce (i18n), karanlık tema.

- Sürüm: `4.0.0` (`package.json`); bazı iç modüller kendi başlıklarında `v5.0` der. Uygulama kimliği `com.berk.istanbululasim`.
- Ek meta bilgi: `package.json`.

> Bu belge Faz 0'da yazılmıştır; mimari ayrıntılar için bkz. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Amaç

- İstanbul'da otobüs/metrobüs canlı konum, tahmini varış (ETA), durak panoları, hat/durak araması.
- Metro, tramvay, funiküler, teleferik, Marmaray ve vapur sefer saatleri; Marmaray seferleri yerel statik istasyon listesinden sentezlenir.
- İSPARK otopark kapasite/boşluk bilgisi; TKM trafik yoğunluğu katmanı; harita katmanları.
- Akıllı rota planlayıcı: çok bacaklı A* (otobüs + metrobüs + raylı + vapur + yürüme, aktarmalı), Web Worker'da hesaplanır; opsiyonel Google Routes/Places entegrasyonu (sunucu tarafı).
- Bildirim motoru (ETA eşiği), canlı güncelleme döngüsü, SSE akışı (tam sunucuda), çevrimdışı önbellek + statik veri fallback'i, PWA service worker.

---

## Kurulum

### Gereksinimler

- **Node.js 18+** (CI'de Node 22; bu depoda geliştirme Node 26 ile doğrulandı). `package.json` `"type": "module"`.
- **npm**. Windows PowerShell'de `npm`, yürütme ilkesiyle engellenirse `npm.cmd` kullanın (örn. `npm.cmd run build`).
- Android derlemesi için ek: **JDK 17**, **Android SDK**, (opsiyonel) **Android Studio**. `@capacitor/android` ve `@capacitor/cli` `devDependencies` içindedir; harici `cap` kurulumu gerekmez.

### 1) Bağımlılıkları kur

```sh
npm install
```

Yeni bağımlılık eklenmemiştir; kilit dosyası `package-lock.json`.

### 2) Geliştirme sunucusu

```sh
npm run dev
```

`vite` çalışır; varsayılan adres **http://localhost:5173** (`vite.config.js`, `base: "./"`). `/api/proxy` istekleri `http://localhost:4173` adresine proxy'lenir; tam proxy deneyimi için ikinci bir terminalde `npm start` (port **4173**) çalıştırın. Backend/proxy yoksa uygulama `public/data` statik verisine ve canlı doğrudan CORS host'larına düşer.

### 3) Üretim derlemesi

```sh
npm run build
```

`vite build`; çıktı **`dist/`** (`assets/` altında, sourcemap kapalı, esbuild minify, `base: "./"`).

Derlemeyi yerel sunucuyla servis etmek için:

```sh
npm run preview   # vite preview
# veya
npm start         # node server.js — statik + /api/* (port 4173, PORT env ile değiştirilebilir)
```

### 4) Test

```sh
npm test
```

`node tests/verify-all.mjs`. Birim testleri (Zaman, geo `Core`, Marmaray, rota motoru `Plan`), **canlı ağ gerektiren proxy entegrasyon testleri** (İETT `GetDuyurular_json`, Şehir Hatları, İSPARK; SSRF allowlist 403 kontrolü; `/api/health`), ve sürüm artefaktı kontrolleri (`releases/Istanbul-Ulasim-v4.0-iOS-Scriptable.js`, `releases/Istanbul-Ulasim-v4.0-Android.apk`) çalışır. İzole/ağsız ortamda canlı proxy bölümü veya artefakt kontrolü başarısız olabilir. Ayrıca `node tests/benchmark-and-verify.mjs` performans/ek kontrol betiği mevcuttur (npm script'i yok).

### Yardımcı scriptler

| Komut | Karşılık gelen script | Açıklama |
| --- | --- | --- |
| `npm run icons` | `icons` | `sharp` ile `assets-src/icon-master.png`'den PWA/Android ikonlarını `public/icons/`'a üretir. |
| `node scripts/build-static-data.mjs` | — (npm script yok) | İETT/Vapur/İSPARK verisini çekip `public/data/*.json` statik fallback dosyalarını yeniden üretir (canlı ağ gerekir). |
| `npm run build:scriptable` | `build:scriptable` | Önce `npm run build`; `dist/` çıktısını tek dosya Scriptable paketine dönüştürür → `releases/`. **Faz 5'te kaldırılacak.** |

---

## Capacitor Android build

Proje **Capacitor 6** (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli`, `@capacitor/app`, `@capacitor/geolocation`, `@capacitor/status-bar`). Konfigürasyon `capacitor.config.json`:

- `appId`: `com.berk.istanbululasim`
- `appName`: `İstanbul Ulaşım`
- `webDir`: `dist`
- `server.androidScheme`: `https`
- `CapacitorHttp.enabled`: `false` (web fetch + proxy yolu kullanılır)

Native proje **`android/`** dizinindedir (`namespace`/`applicationId` `com.berk.istanbululasim`, `minSdkVersion 22`, `targetSdkVersion 34`, `compileSdkVersion 34`, Gradle; `gradlew`/`gradlew.bat` dahil). Web varlıkları derleme sırasında `dist/`'ten kopyalanır.

### Adımlar

```sh
npm install
npm run build          # web derlemesi -> dist/
npx cap sync android   # dist/ + plugin'leri android/ içine kopyala
npx cap open android   # Android Studio'da aç; oradan APK/AAB üret
```

Android Studio olmadan CLI ile (JDK 17 + Android SDK; `ANDROID_HOME`/`ANDROID_SDK_ROOT` tanımlı olmalı):

```sh
npx cap sync android

cd android
./gradlew assembleDebug      # Windows PowerShell: .\gradlew.bat assembleDebug
./gradlew assembleRelease    # Windows PowerShell: .\gradlew.bat assembleRelease
```

Çıktılar tipik olarak `android/app/build/outputs/apk/debug/app-debug.apk` ve `.../release/`. Konum izni `@capacitor/geolocation` ile istenir; `App.backButton` ve `StatusBar` köprüsü `src/main.js`/`src/core/bridge.js` içindedir. `npm test` içindeki APK kontrolü `releases/Istanbul-Ulasim-v4.0-Android.apk` yolunu bekler; `npx cap` üretimi `android/app/build/outputs/...` altındadır.

---

## Klasör yapısı

```text
.
├── README.md                     # bu belge
├── docs/
│   └── ARCHITECTURE.md           # mimari ayrıntılar (Faz 0)
├── index.html                    # giriş sayfası (Vite kökü)
├── capacitor.config.json         # Capacitor 6 konfigürasyonu
├── vite.config.js                # Vite 5; base "./", /api/proxy dev proxy, dist çıktısı
├── package.json                  # scripts + bağımlılıklar (bağımlılık eklenmedi)
│
├── src/                          # uygulama kaynağı (ES modules)
│   ├── main.js                   # önyükleme, yönlendirme (S.yigin), olaylar, periyodik canlı döngüler, PWA
│   ├── core/                     # platformdan bağımsız çekirdek
│   │   ├── api.js                # API sağlayıcıları: iett, metro, marmaray, vapur, trafik, iskeleler, ispark, transitous, ag; MARMARAY_STATIONS
│   │   ├── bridge.js             # Bridge: runtime tespiti (web/capacitor/scriptable/node), http, proxy URL, konum
│   │   ├── geo.js                # Core: mesafe, yön, geometri (haritadan bağımsız)
│   │   ├── router.js             # Plan: rota planlayıcı v5 (çok bacaklı A*, aktarma, ETA)
│   │   ├── storage.js            # KV: IndexedDB + localStorage fallback kalıcı depolama
│   │   └── time.js               # Zaman: dk/saat, gece yarısı +1440, Türkçe kalan süre
│   ├── engines/                  # veri/iş motorları
│   │   ├── dataProvider.js       # DataProvider: in-flight coalescing, stale-while-revalidate, sağlayıcı sağlığı, SSE, filo bbox, proxy tespiti
│   │   ├── etaEngine.js          # 9-faktör ETA tahmini
│   │   ├── trackingEngine.js     # canlı araç takibi
│   │   ├── trafficEngine.js      # TKM trafik işleme
│   │   ├── routeEngine.js        # rota yardımcıları
│   │   └── notificationEngine.js # ETA eşikli bildirimler, toast
│   ├── views/                    # görünümler (DOM üretir)
│   │   ├── nearbyView.js         # "yakın" sekmesi (eager)
│   │   ├── busView.js            # otobüs hat/araç (lazy)
│   │   ├── railView.js           # metro/Marmaray/tramvay (lazy)
│   │   ├── ferryView.js          # vapur (lazy)
│   │   ├── routeView.js          # rota planlayıcı UI (lazy)
│   │   └── stopModal.js          # durak panosu + İSPARK + ayarlar modalı (lazy)
│   ├── map/
│   │   └── mapController.js      # Leaflet kontrolcüsü: canlı araçlar, trafik, İSPARK, filo radarı, tahmini iz
│   ├── workers/
│   │   └── router.worker.js      # Web Worker: INIT_GRAPH + rota istekleri, rota birleştirme
│   ├── services/
│   │   └── googleMapsService.js  # opsiyonel Google Maps servisi istemcisi
│   ├── i18n/
│   │   └── index.js              # tr/en sözlükleri, t()
│   ├── ui/
│   │   └── icons.js              # SVG ikonlar
│   └── styles/                   # tokens/layout/components/map CSS
│
├── public/                       # olduğu gibi kopyalanan statik varlıklar
│   ├── data/                     # statik fallback verileri (aşağıya bkz.)
│   ├── icons/                    # PWA ikonları
│   ├── manifest.webmanifest      # PWA manifest
│   └── sw.js                     # service worker
│
├── scripts/                      # Node ESM yardımcı betikleri
│   ├── build-static-data.mjs     # canlı kaynaklardan public/data/*.json üretir (npm script yok)
│   ├── generate-icons.mjs        # npm run icons
│   └── build-scriptable.mjs      # npm run build:scriptable (Faz 5'te kaldırılacak)
│
├── functions/
│   └── api/proxy.js              # Cloudflare Pages Function proxy (hedef dağıtım; onRequest)
├── server/                       # paylaşılan sunucu çekirdeği
│   ├── proxyCore.js              # SSRF allowlist, cache TTL, circuit breaker, coalescing, fetch
│   ├── cacheLayer.js             # iki katmanlı cache + Redis fallback
│   ├── apiGateway.js             # rate limit, circuit breaker, metrics, provider tespiti
│   ├── sseHub.js                 # SSE + filo bbox (tam Node sunucusu)
│   └── googleMapsProxy.js        # Google Routes/Places/Geocode proxy (opsiyonel anahtar)
│
├── server.js                     # tam Node sunucusu (statik + /api/*; Render hedefi — Faz 1'de kaldırılacak)
├── api/proxy.js                  # Vercel serverless proxy (Faz 1'de kaldırılacak)
├── worker.js + wrangler.jsonc    # bağımsız Cloudflare Worker varyantı
├── render.yaml                   # Render (Faz 1'de kaldırılacak)
├── vercel.json                   # Vercel (Faz 1'de kaldırılacak)
├── .github/workflows/deploy-pages.yml  # GitHub Pages (Faz 1'de kaldırılacak)
│
├── android/                      # Capacitor native Android projesi
├── İstanbul Ulaşım.js            # Scriptable v3.8 tek dosya uygulaması (Faz 5'te kaldırılacak)
├── legacy/İstanbul Ulaşım.v3.8.js# Scriptable legacy kopya (Faz 5'te kaldırılacak)
├── releases/                     # Scriptable/APK sürüm artefaktları
├── assets-src/                   # ikon kaynağı (icon-master.png)
├── tests/                        # verify-all.mjs + benchmark-and-verify.mjs
└── ...                            # package-lock.json, .gitignore
```

### `public/data` (statik fallback)

Canlı kaynak başarısız olursa `src/core/api.js` `fetchStaticJson()` ile `./data/<dosya>` okunur; `src/engines/dataProvider.js` SWR önbelleğiyle birlikte çevrimdışı dayanıklılık sağlar. `scripts/build-static-data.mjs` ile yenilenir:

- `iett-hatlar.json` — İETT hat listesi
- `iett-ag.json` — otobüs ağı (hat + durak geometrisi)
- `iett-duyurular.json` — duyurular
- `iett-sefer-populer.json` — popüler hatlar için planlanan seferler
- `vapur.json` — vapur hatları + tarifeler
- `ispark.json` — İSPARK otoparkları

---

## Veri akışı ve proxy

Özet (ayrıntı: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)):

1. **Arayüz** (`src/views`, `src/map`) `src/core/api.js` (`API.*`) çağırır.
2. `api.js`, `src/core/bridge.js` `Bridge.http()` ile istek yapar. `API` kendi katmanlı önbelleğini (bellek + `KV` IndexedDB, `cached()`) kullanır; `DataProvider` ek SWR + in-flight coalescing + sağlayıcı sağlığı ekler.
3. **Proxy kararı** (`Bridge.http`):
   - **Scriptable** (`window.__SCRIPTABLE__`): native köprü — Faz 5'te kaldırılacak.
   - **Capacitor**: `CapacitorHttp` denenir; hata olursa `customProxyBase + /api/proxy`.
   - **Web/PWA**: bazı host'lara doğrudan (`isDirectCorsHost`: `api.ibb.gov.tr/MetroIstanbul`, `tkmservices.ibb.gov.tr`, `api.transitous.org`); aksi halde `customProxyBase ? <base>/api/proxy : ./api/proxy`. `404/405` → `proxyMissing` → "Static hosting (proxy yok)" ve statik fallback. `customProxyBase` kullanıcı ayarı `ulasim.proxyUrl` / `KV proxyUrl`.
   - **Node**: doğrudan `fetch`.
4. **Proxy ucu** `POST/GET /api/proxy` → `server/proxyCore.js handleProxyRequest()`. Hedef host **SSRF allowlist**'i: `api.ibb.gov.tr`, `sehirhatlari.istanbul`, `www.sehirhatlari.istanbul`, `tkmservices.ibb.gov.tr`, `api.transitous.org`. Sadece `GET/POST`. İletilen header'lar sınırlı (`content-type`, `soapaction`, `accept`). Sabit `User-Agent`. 25 sn timeout. CORS `*`. Kalıcı olmayan/kalıcı `Cache-Control`, `X-Proxy-Cache: HIT/MISS/STALE-FAILOVER`, endpoint'e göre TTL, istek **coalescing**, **circuit breaker**, hata/timeout'ta **stale failover**.
5. **Veri kaynakları**: İETT (SOAP `api.ibb.gov.tr/iett`, JSON uçları), Metro İstanbul (`api.ibb.gov.tr/MetroIstanbul/.../V2`, REST), Marmaray (yerel sentez; canlı API yok), Şehir Hatları (`sehirhatlari.istanbul`, HTML parçalama; vapur fallback'i `vapur.json`), TKM (`tkmservices.ibb.gov.tr`, trafik segmentleri + indeks + iskeleler), İSPARK (`api.ibb.gov.tr/ispark/Park`, fallback `ispark.json`), Transitous (`api.transitous.org`, geocode/plan/stops; rota fallback'i), opsiyonel Google (sunucu proxy, anahtar gerekir).
6. **Rota**: `Plan` grafiği `src/workers/router.worker.js` Web Worker'ında `INIT_GRAPH` ile kurulur; istekler worker'a mesajla gider. Transitous itinerary'leri ile birleştirilir.
7. **Kalıcılık**: `KV` IndexedDB `istanbul-ulasim-v4`, `localStorage`/`ulasim.proxyUrl`, PWA `sw.js`. Veri hiçbir kişisel sunucuda saklanmaz.

### Tam Node sunucusu vs Cloudflare

`npm start` (`server.js`) statik `dist/` servis eder + `/api/proxy`, `/api/stream` (SSE), `/api/fleet`, `/api/health`, `/api/metrics`, Google `/api/google/*` ekler; rate limit + gzip. Bağımsız Cloudflare Worker `worker.js` (`wrangler.jsonc`, `/api/proxy` + `/health` + ASSETS). **Karar:** hedef dağıtım **yalnızca Cloudflare**; `functions/api/proxy.js` **tek** proxy olacak.

---

## Kararlar ve planlanan değişiklikler

**Karar — hedef dağıtım yalnızca Cloudflare.** Uygulama statik `dist/` + **Cloudflare Pages Function `functions/api/proxy.js`** (`onRequest`) olarak dağıtılır; proxy çekirdeği `server/proxyCore.js` paylaşılır. Başka dağıtım hedefi hedeflenmez.

**Planlanan değişiklikler (henüz uygulanmadı; yalnızca dokümantasyon notu):**

- **Faz 1:** Render, Vercel ve GitHub Pages hedefleri **kaldırılacak**:
  - Render → `render.yaml`, `npm start`/`server.js` dağıtımı;
  - Vercel → `vercel.json`, `api/proxy.js` serverless fonksiyonu;
  - GitHub Pages → `.github/workflows/deploy-pages.yml`.
  Tek dağıtım yolu Cloudflare (`functions/api/proxy.js`) kalacak. (Bu değişiklikler bu görevde **kod olarak yapılmadı**.)
- **Faz 5:** **Scriptable/legacy kaldırılacak** → `İstanbul Ulaşım.js`, `legacy/`, `scripts/build-scriptable.mjs`, `npm run build:scriptable`, `releases/`, `window.__SCRIPTABLE__` köprü dalı (`src/core/bridge.js`, `src/core/storage.js`, `api.js` Scriptable yolları), `tests/verify-all.mjs` Scriptable artefakt kontrolü. (Bu değişiklikler bu görevde **kod olarak yapılmadı**.)

---

## Doğrulama

README'deki `npm` komutlarının `package.json` `scripts`'leriyle eşleştiği kontrol edilebilir (bkz. `package.json`: `dev`, `build`, `preview`, `start`, `icons`, `build:scriptable`, `test`).
