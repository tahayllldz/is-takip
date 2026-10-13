# CLAUDE.md — İş Takip (çalışma adı)

KKTC'deki şirketlere satılacak, modüler ekip iletişimi ve görev takip ürünü.
İlk pilot adayı: Taşçıoğlu Medikal. Ürün çok şirketlidir; pilot şirkete özel kod yazılmaz.

## Önce bunları oku
- `docs/PROGRESS.md` — nerede kaldık, sıradaki somut adım
- `docs/PRODUCT_SCOPE.md` — doğrulanmış ihtiyaçlar ve kapsam dışı
- `docs/ARCHITECTURE.md` — mimari kararlar (ADR) ve güvenlik modeli
- `docs/PERMISSIONS.md` — yetki tablosu, `docs/MODULES.md` — modül/bağımlılık kuralları

## Depo
pnpm workspace monorepo (Node ≥ 22.13, pnpm 10):
- `apps/web` — Next.js 16.4 App Router (yönetim paneli + çalışan web). `proxy.ts` (eski middleware).
- `apps/mobile` — Expo SDK 57 + Expo Router (iOS/Android).
- `packages/shared` — tipler, Zod şemaları, modül tanımları, yetki tablosu, iş kuralları, veri erişim katmanı (`api.ts`).
- `packages/db-tests` — gerçek Postgres 17 üzerinde RLS/RPC testleri (Docker gerekmez) + gerçek Supabase'e karşı uçtan uca testler + demo verisi betiği.
- `supabase/` — `config.toml`, `migrations/` (şemanın tek kaynağı), `seed.sql` (bilerek boş).

## Değişmez kurallar
- Yetki asla yalnızca arayüzde verilmez. Her yazma işlemi `public` şemasındaki SECURITY DEFINER RPC fonksiyonundan geçer ve
  üyelik + izin + modül + şirket sınırını kendisi kontrol eder. İstemci rolünün tablolarda yalnızca SELECT yetkisi vardır (RLS süzer).
- Yeni tablo → RLS aç, politikayı yaz, `select private.apply_api_grants();` ile migration'ı bitir. `00-schema.test.ts` bunu denetler.
- Şirketler arası referans: bileşik yabancı anahtar `(company_id, x)` kullan.
- Bildirim yalnızca `private.notify(...)` ile, `dedupe_key` vererek üretilir (tekrar denemede çoğalmaz, alıcının erişimi kontrol edilir).
  Push bu bildirimlerden kuyrukla üretilir; push metni GENELDİR (içerik, kişi, şirket adı yok) — `packages/shared/src/push.ts`.
- Yalnızca service_role çağırabilecek fonksiyonlar `private.apply_api_grants()` içinde istemciden geri alınır (ör. `push_claim_batch`).
- İstemci kaynaklı oluşturma işlemleri `client_request_id` ile tekrar-güvenlidir.
- Tarihler `timestamptz` (UTC) saklanır, şirketin `timezone` alanıyla (varsayılan Asia/Famagusta) gösterilir. Gün hesabı veritabanında yapılır.
- Yönetim anahtarı (`SUPABASE_SECRET_KEY`) yalnızca `apps/web/lib/supabase/admin.ts` içinde (server-only). Mobil/tarayıcıya asla.
- Görev durumları yalnızca renkle anlatılmaz (metin + simge). Türkçe arayüz, en az 16px yazı, 44–48px dokunma alanı.
- Demo verisi yalnızca `is_demo = true` şirkette ve `pnpm db:seed-demo` ile; gerçek modda örnek veri yok. Sahte giriş/bildirim yok.
- Şema değişikliği yalnızca yeni migration dosyasıyla. Paylaşılan yetki tablosu (`packages/shared/src/permissions.ts`) değişirse
  aynı değişikliği migration'a da yaz; test iki tarafı karşılaştırır.

## Komutlar
```
pnpm install
pnpm test:shared          # ortak paket birim testleri
pnpm test:db              # RLS/RPC testleri (gömülü Postgres 17, Docker gerekmez)
pnpm db:start             # yerel Supabase (Docker gerekir)
pnpm test:e2e             # gerçek Supabase'e karşı uçtan uca (çalışmıyorsa ATLANIR)
pnpm db:seed-demo         # sentetik demo şirketi
pnpm dev:web              # http://localhost:3000
pnpm dev:mobile           # Expo
pnpm push:dispatch        # yerel push gönderici (web sunucusu çalışırken; PUSH_DISPATCH_SECRET)
pnpm typecheck
```

## Ortam notları (bu makine)
- Proje yolu Türkçe karakter içeriyor (`İS TAKİP`). Postgres ikilileri bu yüzden ASCII önbelleğe kopyalanıp oradan çalışır
  (`packages/db-tests/src/local-postgres.ts`). Next.js/Turbopack ve Metro bu yolda sorunsuz derleniyor (doğrulandı).
- Docker Desktop kurulu (2026-10-13, 29.8.2; WSL2'ye ~3.9 GB bellek). Kurulumdan önce açılmış kabuklarda PATH eski kalır:
  `C:\Program Files\Docker\Docker\resources\bin` PATH'e eklenmeli. Docker kapalıysa uçtan uca testler atlanır.
- `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:db` aynı RLS testlerini gerçek Supabase
  veritabanında koşturur ama test kullanıcılarını `auth.users`'a bırakır → ardından `pnpm db:reset && pnpm db:seed-demo`.
- Mobil kod tarayıcıda: `.claude/launch.json` → `mobile-web` (port 8081). Web: `web-dev` (port 3000).
- pnpm eş bağımlılıkları en yeni sürüme otomatik kurar; Expo SDK sürümleriyle hizalamak için RN araç paketleri
  `apps/mobile/package.json` içinde açıkça sabitlendi.

## Çalışma biçimi
- Kullanıcıyla Türkçe iletişim. Her aşama sonunda çalıştır, doğrula, `docs/PROGRESS.md`'yi güncelle.
- Derleme başarısını "uçtan uca çalışıyor" diye raporlama; hangi testin gerçekten çalıştığını yaz.
