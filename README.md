# İstanbul Ulaşım

İstanbul toplu taşıma için canlı, harita tabanlı uygulama: **Canlı Otobüs, Metrobüs, Metro, Marmaray, Vapur, İSPARK ve akıllı rota planlayıcı**. Tek sayfa uygulama (Vite), PWA ve **Capacitor Android** hedefli; veriler İBB/İETT, Metro İstanbul, Şehir Hatları, İBB trafik ve Transitous açık veri kaynaklarından **CORS-güvenli bir proxy** üzerinden çekilir, statik `public/data` yedeği ve tarayıcı önbelleğiyle çevrimdışı dayanıklılık sağlanır. Türkçe/İngilizce (i18n), karanlık tema.

- Uygulama sürümü `5.0.0` (`package.json`). Uygulama kimliği `com.berk.istanbululasim`.
- Ek meta bilgi: `package.json`.

> Mimari ayrıntılar için bkz. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Amaç

- İstanbul'da otobüs/metrobüs canlı konum, tahmini varış (ETA), durak panoları, hat/durak araması.
- Metro, tramvay, funiküler, teleferik, Marmaray ve vapur sefer saatleri; Marmaray seferleri yerel statik istasyon listesinden sentezlenir.
- İSPARK otopark kapasite/boşluk bilgisi; TKM trafik yoğunluğu katmanı; harita katmanları.
- Akıllı rota planlayıcı: çok bacaklı A* (otobüs + metrobüs + raylı + vapur + yürüme, aktarmalı), Web Worker'da hesaplanır; opsiyonel Google Routes/Places entegrasyonu (sunucu tarafı).
- Bildirim motoru (ETA eşiği), canlı güncelleme döngüsü, yerel sunucuda SSE, çevrimdışı önbellek + statik veri fallback'i, PWA service worker.

---

## Kurulum

### Gereksinimler

- **Node.js 22+**. Aşağıdaki Wrangler komutları için **22.12+** gerekir.
- **npm**. Windows PowerShell'de yürütme ilkesi betikleri engellerse `npm.cmd` ve `npx.cmd` kullanın.
- Android derlemesi için **JDK 21**, **Android SDK Platform 36** ve **SDK Build-Tools 35.0.0** gerekir. IDE kullanıyorsanız **Android Studio Otter (2025.2.1) veya üstünü** kullanın. `@capacitor/android` ve `@capacitor/cli` `devDependencies` içindedir. Capacitor CLI'ı `npx cap` ile çalıştırabilirsiniz.

### 1) Bağımlılıkları kur

```sh
npm ci
```

### 2) Geliştirme sunucusu

```sh
npm run dev
```

Vite varsayılan olarak **http://localhost:5173** adresinde çalışır ve `/api/proxy` isteklerini **http://127.0.0.1:4173** adresine iletir. Proxy için ikinci bir terminalde `npm start` çalıştırın. Proxyye ulaşılamadığında uygulama `public/data` statik verisini ve doğrudan CORS erişimi sağlayan canlı kaynakları kullanır.

### 3) Üretim derlemesi

```sh
npm run build
```

`vite build`; çıktı **`dist/`** (`assets/` altında, sourcemap kapalı, esbuild minify, `base: "./"`).

Derlemeyi yerel sunucuyla servis etmek için:

```sh
npm run preview   # vite preview
# veya
npm start         # yerel Node sunucusu — statik dosyalar ve API (127.0.0.1:4173, port için PORT)
```

### 4) Test

```sh
npm test
```

`npm test` önce `npm run build`, ardından `node tests/verify-all.mjs` çalıştırır. Birim testlerini (Zaman, geo `Core`, Marmaray, rota motoru `Plan`), yerel sunucu ve proxy kontrollerini (`/health` ve SSRF allowlist 403 dahil), Android APK kontrolünü ve `tests/smoke/` altındaki PWA ve platform duman testlerini kapsar. İETT `GetDuyurular_json`, Şehir Hatları ve İSPARK için varsayılan test sabit yerel yanıtlar kullanır ve internet bağlantısı gerektirmez.

- `npm test -- --live` İETT, Şehir Hatları ve İSPARK kontrollerini canlı servislerle çalıştırır ve internet bağlantısı gerektirir.
- `npm test -- --require-apk` Gradle'ın `android/app/build/outputs/apk/debug/app-debug.apk` çıktısını zorunlu kılar. Varsayılan test APK'yı varsa doğrular, dosya yoksa ilgili kontrolü atlar.

`node tests/benchmark-and-verify.mjs` ayrı performans ve ek kontrol betiğidir.

### Yardımcı scriptler

| Komut | Karşılık gelen script | Açıklama |
| --- | --- | --- |
| `npm run icons` | `icons` | `sharp` ile `assets-src/icon-master.png`'den PWA/Android ikonlarını `public/icons/`'a üretir. |
| `node scripts/build-static-data.mjs` | — (npm script yok) | İETT/Vapur/İSPARK verisini çekip `public/data/*.json` statik fallback dosyalarını yeniden üretir (canlı ağ gerekir). |

---

## Capacitor Android build

Proje **Capacitor 8** (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli`, `@capacitor/app`, `@capacitor/geolocation`, `@capacitor/status-bar`). Yapılandırma `capacitor.config.json` dosyasındadır.

- `appId`: `com.berk.istanbululasim`
- `appName`: `İstanbul Ulaşım`
- `webDir`: `dist`
- `server.androidScheme`: `https`
- `SystemBars.initialViewportFitValueHint`: `cover` (HTML'deki `viewport-fit=cover` ile uyumlu)
- `CapacitorHttp.enabled`: `false` (web fetch + proxy yolu kullanılır)

Native proje **`android/`** dizinindedir. Uygulama kimliği `com.berk.istanbululasim`, minimum sürüm **Android 7.0 (API 24)**, derleme ve hedef SDK sürümü **API 36**'dır. Proje **Gradle Wrapper 8.14.3** ve **Android Gradle Plugin 8.13.0** kullanır. `cap sync` web varlıklarını `dist/` dizininden kopyalar.

### Adımlar

```sh
npm ci
npm run build          # web derlemesi -> dist/
npx cap sync android   # dist/ + plugin'leri android/ içine kopyala
npx cap open android   # Android Studio'da aç; oradan APK/AAB üret
```

Komut satırında `JAVA_HOME` değişkenini JDK 21 dizinine, `ANDROID_HOME` değişkenini Android SDK dizinine ayarlayın.

```sh
npx cap sync android

cd android
./gradlew assembleDebug      # Windows PowerShell: .\gradlew.bat assembleDebug
./gradlew assembleRelease    # Windows PowerShell: .\gradlew.bat assembleRelease
```

Çıktılar `android/app/build/outputs/apk/debug/app-debug.apk` ve `.../release/` altında yer alır. Konum izni `@capacitor/geolocation` ile istenir. `App.backButton` ve `StatusBar` köprüsü `src/main.js`/`src/core/bridge.js` içindedir. Debug APK'yı doğrulamak için proje kökünden `npm test -- --require-apk` komutunu çalıştırın.

---

## Klasör yapısı

```text
.
├── README.md                     # bu belge
├── docs/
│   └── ARCHITECTURE.md           # mimari ayrıntılar
├── index.html                    # giriş sayfası (Vite kökü)
├── capacitor.config.json         # Capacitor 8 yapılandırması
├── vite.config.js                # Vite 6, /api/proxy dev yönlendirmesi, dist çıktısı
├── package.json                  # scriptler ve bağımlılıklar
│
├── src/                          # uygulama kaynağı (ES modules)
│   ├── main.js                   # önyükleme, yönlendirme (S.yigin), olaylar, periyodik canlı döngüler, PWA
│   ├── core/                     # platformdan bağımsız çekirdek
│   │   ├── api.js                # API sağlayıcıları: iett, metro, marmaray, vapur, trafik, iskeleler, ispark, transitous, ag; MARMARAY_STATIONS
│   │   ├── bridge.js             # Bridge: runtime tespiti (web/capacitor/node), http, proxy URL, konum
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
│   └── generate-icons.mjs        # npm run icons
│
├── functions/
│   └── api/proxy.js              # Cloudflare Pages Function adapter'ı
├── server/                       # paylaşılan sunucu çekirdeği
│   ├── proxyCore.js              # SSRF allowlist, cache TTL, circuit breaker, coalescing, fetch
│   ├── cacheLayer.js             # iki katmanlı cache + Redis fallback
│   ├── apiGateway.js             # rate limit, circuit breaker, metrics, provider tespiti
│   ├── sseHub.js                 # SSE + filo bbox (yerel Node sunucusu)
│   ├── googleMapsProxy.js        # Google Routes/Places/Geocode proxy (yerel)
│   └── localServer.js           # geliştirme ve test sunucusu (npm start)
│
├── worker.js + wrangler.worker.jsonc # Cloudflare Worker ve statik dosyalar
├── wrangler.jsonc               # Cloudflare Pages yapılandırması
│
├── android/                      # Capacitor native Android projesi
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
   - **Capacitor**: `CapacitorHttp` denenir; hata olursa `customProxyBase + /api/proxy`.
   - **Web/PWA**: bazı host'lara doğrudan (`isDirectCorsHost`: `api.ibb.gov.tr/MetroIstanbul`, `tkmservices.ibb.gov.tr`, `api.transitous.org`); aksi halde `customProxyBase ? <base>/api/proxy : ./api/proxy`. `404/405` → `proxyMissing` → "Static hosting (proxy yok)" ve statik fallback. `customProxyBase` kullanıcı ayarı `ulasim.proxyUrl` / `KV proxyUrl`.
   - **Node**: doğrudan `fetch`.
4. **Proxy ucu** `POST/GET /api/proxy` → `server/proxyCore.js handleProxyRequest()`. Hedef host **SSRF allowlist**'i: `api.ibb.gov.tr`, `sehirhatlari.istanbul`, `www.sehirhatlari.istanbul`, `tkmservices.ibb.gov.tr`, `api.transitous.org`. Sadece `GET/POST`. İletilen header'lar sınırlı (`content-type`, `soapaction`, `accept`). Sabit `User-Agent`. 25 sn timeout. CORS `*`. Kalıcı olmayan/kalıcı `Cache-Control`, `X-Proxy-Cache: HIT/MISS/STALE-FAILOVER`, endpoint'e göre TTL, istek **coalescing**, **circuit breaker**, hata/timeout'ta **stale failover**.
5. **Veri kaynakları**: İETT (SOAP `api.ibb.gov.tr/iett`, JSON uçları), Metro İstanbul (`api.ibb.gov.tr/MetroIstanbul/.../V2`, REST), Marmaray (yerel sentez; canlı API yok), Şehir Hatları (`sehirhatlari.istanbul`, HTML parçalama; vapur fallback'i `vapur.json`), TKM (`tkmservices.ibb.gov.tr`, trafik segmentleri + indeks + iskeleler), İSPARK (`api.ibb.gov.tr/ispark/Park`, fallback `ispark.json`), Transitous (`api.transitous.org`, geocode/plan/stops; rota fallback'i), opsiyonel Google (sunucu proxy, anahtar gerekir).
6. **Rota**: `Plan` grafiği `src/workers/router.worker.js` Web Worker'ında `INIT_GRAPH` ile kurulur; istekler worker'a mesajla gider. Transitous itinerary'leri ile birleştirilir.
7. **Kalıcılık**: `KV` IndexedDB `istanbul-ulasim-v4`, `localStorage`/`ulasim.proxyUrl`, PWA `sw.js`. Veri hiçbir kişisel sunucuda saklanmaz.

## Cloudflare dağıtımı

Üretim için `npm ci` ve `npm run build` çalıştırın. Cloudflare Pages, `dist/` ve `functions/api/proxy.js` dosyasını kullanır. Cloudflare Workers, `worker.js` ile `/api/proxy` ve `/health` yollarını karşılar ve `dist/` dosyalarını `ASSETS` üzerinden sunar. İki adapter da `server/proxyCore.js` çekirdeğini çağırır.

```sh
# Pages'i yerel olarak önizle
npx wrangler@4.168.0 pages dev

# Workers'ı yerel olarak önizle
npx wrangler@4.168.0 dev --config wrangler.worker.jsonc
```

Yayın sırasında Pages için `npx wrangler@4.168.0 pages deploy`, Workers için `npx wrangler@4.168.0 deploy --config wrangler.worker.jsonc` kullanılır. Git bağlantılı Pages projesinde derleme komutu `npm run build`, çıktı dizini `dist` olmalıdır. Her iki Wrangler yapılandırması da çekirdeğin Node.js API'leri için `2025-11-01` uyumluluk tarihini ve `nodejs_compat` bayrağını kullanır.

SSE, filo, metrikler ve Google Maps uçları `npm start` ile açılan yerel Node sunucusunda kullanılabilir.

---

## Planlanan değişiklikler

- Statik yedek verileri elle yenilemek için `npm run data` komutunun eklenmesi öneriliyor. Mevcut komut `node scripts/build-static-data.mjs`.

---

## Doğrulama

README'deki `npm` komutlarının `package.json` `scripts`'leriyle eşleştiği kontrol edilebilir (bkz. `package.json`: `dev`, `build`, `preview`, `start`, `icons`, `test`).
