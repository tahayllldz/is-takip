# İş Takip (çalışma adı)

KKTC'deki şirketler için Türkçe, modüler ekip iletişimi ve görev takip ürünü: web yönetim paneli + iOS/Android uygulaması.

- Ürün kapsamı: [docs/PRODUCT_SCOPE.md](docs/PRODUCT_SCOPE.md)
- Mimari kararlar: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Yetki tablosu: [docs/PERMISSIONS.md](docs/PERMISSIONS.md) · Modüller: [docs/MODULES.md](docs/MODULES.md)
- İlerleme: [docs/PROGRESS.md](docs/PROGRESS.md)

## Gereksinimler
- Node.js ≥ 22.13 (bu makinede 24.20) ve pnpm 10 (`corepack enable` veya mevcut pnpm)
- **Docker Desktop** — yerel Supabase için (Auth, veritabanı, Realtime, Storage). Kurulum yönetici izni ister.
  Docker yoksa yalnızca birim ve veritabanı (RLS) testleri çalışır; uygulama sunucusuz açılmaz (sahte veri gösterilmez).
- Telefonda deneme için: Expo Go (SDK 57) veya geliştirme derlemesi + Expo hesabı

## Kurulum

```bash
pnpm install
```

### 1) Yerel Supabase'i başlat (Docker gerekir)

```bash
pnpm db:start
```

İlk çalıştırmada imajlar indirilir (birkaç dakika). Migration'lar otomatik uygulanır. Bağlantı bilgilerini görmek için:

```bash
pnpm db:status
```

> 8 GB RAM'li makinelerde `db:start` Studio, analitik ve edge-runtime'ı başlatmaz. Studio gerekiyorsa `pnpm exec supabase start`.

### 2) Ortam değişkenleri

`apps/web/.env.local` (örnek: `apps/web/.env.example`):

| Değişken | Nereden |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `db:status` → API URL (yerelde `http://127.0.0.1:54321`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `db:status` → Publishable key |
| `SUPABASE_SECRET_KEY` | `db:status` → Secret key — **yalnızca sunucu**, asla `NEXT_PUBLIC_` önekiyle yazmayın |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` |
| `ALLOW_COMPANY_SIGNUP` | `true` (yeni şirket kaydına izin) |

`apps/mobile/.env` (örnek: `apps/mobile/.env.example`):

| Değişken | Not |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Telefonda: bilgisayarın yerel ağ IP'si, ör. `http://192.168.1.20:54321` |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yayınlanabilir anahtar (yönetim anahtarı mobil uygulamaya konmaz) |

### 3) Çalıştır

```bash
pnpm dev:web
```

Web: http://localhost:3000 → "Kayıt olun" ile şirket hesabı açın (yerelde e-posta onayı kapalıdır; yerel e-postalar
http://127.0.0.1:54324 adresindeki Mailpit'e düşer).

```bash
pnpm dev:mobile
```

Expo QR kodunu telefondaki Expo Go ile okutun (telefon ve bilgisayar aynı ağda olmalı; Expo Go artık Expo hesabıyla giriş istiyor).
Tarayıcıda önizleme: `pnpm --filter @istakip/mobile web` (yalnızca geliştirme; gerçek cihaz testi yerine geçmez).

Telefonda denerken:
- `apps/mobile/.env` içinde `EXPO_PUBLIC_SUPABASE_URL` = `http://<bilgisayarın Wi‑Fi IP'si>:54321` (`ipconfig` → Wi‑Fi IPv4).
- Bilgisayarın ağ profili **Özel (Private)** olmalı veya Windows Güvenlik Duvarı'nda 54321 (Supabase) ve 8081 (Expo) TCP
  portlarına izin verilmeli (yönetici izni gerekir). Kafe/otel gibi genel ağlar cihazların birbirine erişimini çoğu zaman engeller;
  bu durumda telefonun kişisel erişim noktasına bağlanın.
- **Kabloyla (doğrulandı, iPhone):** iPhone'da Kişisel Erişim Noktası açık + USB kablo → bilgisayar `172.20.10.x` adresini alır.
  `apps/mobile/.env` → `http://172.20.10.3:54321` (adresi `ipconfig` ile kontrol edin) ve Expo'yu bu adresle başlatın:
  `$env:REACT_NATIVE_PACKAGER_HOSTNAME='172.20.10.3'; pnpm --filter @istakip/mobile exec expo start --clear`.
  Telefon–bilgisayar trafiği kablodan geçer, mobil veri harcamaz.
- Expo Go, bilgisayardaki Expo CLI ile **aynı Expo hesabıyla** oturum açmış olmalı (yoksa "signed in to Expo CLI as … but not
  signed in to Expo Go" hatası). Hesapsız denemek için `expo start --offline`.
- Docker Desktop kurulduktan sonra açık kalan terminaller `docker` komutunu tanımayabilir: yeni terminal açın.

### Demo verisi (isteğe bağlı, yalnızca yerel)

```bash
pnpm db:seed-demo
```

"Örnek Medikal Ltd. (DEMO)" adlı, **DEMO VERİ** uyarısıyla gösterilen, tamamen sentetik bir şirket kurar. Giriş e-postaları
`demo.*@example.com`; şifre `packages/db-tests/src/seed-demo.ts` içindeki `DEMO_PASSWORD`. Gerçek çalışma modunda veritabanına
hiçbir örnek veri eklenmez (`supabase/seed.sql` bilerek boş).

## Testler

```bash
pnpm test:shared
```
Ortak iş kuralları (saat dilimi, gecikme, modül bağımlılıkları, izinler, doğrulama).

```bash
pnpm test:db
```
Migration'ları gerçek Postgres 17'ye uygular ve RLS/RPC güvenliğini sınar: şirketler arası ayrım, grup görünürlüğü, kapsamlı
yönetici, görev yetkileri, üyelik kaldırma, davet güvenliği, modül kapatma, tekrar-güvenlik, saat dilimi. **Docker gerekmez.**
Yerel Supabase veritabanına karşı çalıştırmak için `TEST_DATABASE_URL` verin.

```bash
pnpm test:e2e
```
Gerçek Supabase (Auth + REST + Realtime) üzerinden: davet → webden görev atama → mobil istemcide görme/tamamlama → web
istemcisinde Realtime olayı ve güncel durum → uygulama yeniden açılınca oturumun korunması → başka şirketin erişememesi →
çıkarılan çalışanın erişiminin kesilmesi. Supabase çalışmıyorsa testler **atlanır**.

```bash
pnpm typecheck
```

## Supabase Cloud ile (Docker yerine)
1. supabase.com'da proje açın (bölge: Frankfurt `eu-central-1` önerilir).
2. `pnpm exec supabase login` ve `pnpm exec supabase link --project-ref <ref>`; ardından `pnpm exec supabase db push`.
3. Project Settings → API'deki URL ve anahtarlarla `.env` dosyalarını doldurun; Auth → URL Configuration'a site adresini ekleyin.

## Klasör yapısı
```
apps/web            Next.js yönetim paneli ve çalışan web arayüzü
apps/mobile         Expo (iOS/Android) uygulaması
packages/shared     tipler, şemalar, modül/yetki tanımları, iş kuralları, veri erişimi
packages/db-tests   RLS/RPC testleri, uçtan uca testler, demo verisi
supabase            config.toml, migrations/
docs                kapsam, mimari, yetkiler, modüller, ilerleme
```
