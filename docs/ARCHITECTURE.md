# Mimari ve kararlar

## Genel bakış
```
apps/web (Next.js 16, sunucu)  ─┐                         ┌─ Postgres 17: RLS + RPC (iş kuralları, yetki)
                                 ├─ @istakip/shared (api) ─┤─ Supabase Auth (oturum, JWT)
apps/mobile (Expo SDK 57)      ─┘                         ├─ Realtime (postgres_changes, RLS'li)
                                                          └─ Storage (Aşama 2: özel kova, RLS'li)
apps/web sunucusu ── yalnızca Auth Admin API gereken dar işlemler (davetle hesap açma) ── SUPABASE_SECRET_KEY
```
Tek uygulama altyapısı; mikroservis veya dinamik eklenti yok.

## Kararlar (ADR)

### ADR-1 · İş kuralları ve yetki veritabanında
Tüm yazma işlemleri `public` şemasındaki `SECURITY DEFINER` RPC fonksiyonlarıyla yapılır (`create_task`, `set_task_status`,
`create_group`, `create_invitation` …). Her fonksiyon: oturum, aktif üyelik, izin (`user_has_perm`), modül durumu ve
şirket sınırını kendisi kontrol eder; `search_path = ''` ile sabitlenir. İstemci rolünün (`authenticated`) tablolarda yalnızca
`SELECT` yetkisi vardır ve satırları RLS süzer; `anon` rolü hiçbir tabloya erişemez.
**Neden:** Web ve mobil aynı kurallardan geçer; "butonu gizleyerek yetki" mümkün değildir; doğrudan API isteği de aynı kontrole takılır.
Yardımcı fonksiyonlar API'ye açık olmayan `private` şemasındadır.

### ADR-2 · Çok şirketli ayrım: company_id + bileşik yabancı anahtar
Her şirket verisi `company_id` taşır. Şirket içi referanslar `(company_id, x)` bileşik FK ile kurulur
(ör. `tasks(company_id, assignee_id) → company_members(company_id, user_id)`). Böylece başka şirketin kullanıcısı/grubu/görevi
**veritabanı düzeyinde** referans gösterilemez (süper kullanıcı eklemesinde bile; test edildi).

### ADR-3 · Kapsamlı yönetici
Yönetici yetkisi rol adından türemez: `admin_scope = 'groups'` olan yönetici yalnızca `member_scope_groups` gruplarında ve
yalnızca "grupla sınırlanabilir" izinlerde yetkilidir. Grup yöneticisi ayrı bir grup rolüdür. Ayrıntı: `PERMISSIONS.md`.

### ADR-4 · Tekrar-güvenlik (idempotency) ve mükerrer kayıt
- Oluşturma işlemleri istemcinin ürettiği `client_request_id` ile tekildir (`unique(created_by, client_request_id)`);
  aynı istek tekrar gelirse (ağ kopması, çift tıklama, eşzamanlı) mevcut kayıt döner. Eşzamanlı çakışma `on conflict` ile çözülür.
- Durum değişikliği: hedef durum zaten geçerliyse işlem/olay/bildirim üretilmez.
- Bildirimler `(user_id, dedupe_key)` ile tekildir; anahtar genellikle olay kimliğidir (`te:<task_event_id>`).
- İsteğe bağlı iyimser kilit: `p_expected_version` (görev `version` alanı); başkası değiştirdiyse `conflict`.
- Mesajdan görev (Aşama 2): `tasks.source_message_id` tekildir — bir mesajdan tek görev.

### ADR-5 · Bildirildi / görüldü / üstlenildi / tamamlandı ayrı alanlar
`notified_at` (atama bildirimi üretildi), `seen_at` (sorumlu ilk kez açtı), `accepted_at` ("Üstlendim" veya sorumlunun işe
başlaması), `completed_at` (durum Tamamlandı). Biri diğerinden türetilmez; tek istisna: sorumlu "Başla" derse üstlenme de
kaydedilir (işe başlamak üstlenmeyi zorunlu kılar). Yeniden atamada ilk üçü sıfırlanır.

### ADR-6 · Gecikme ve saat dilimi
Anlar `timestamptz` (UTC) saklanır. Son tarih kullanıcıdan "gün (+ isteğe bağlı saat)" olarak alınır ve **veritabanında**
şirketin `timezone` alanıyla (varsayılan `Asia/Famagusta`) UTC'ye çevrilir; saat yoksa gün sonu (23:59:59) ve `due_all_day`.
Cihaz saat dilimi kullanılmaz (Türkiye UTC+3 sabit; KKTC kışın UTC+2 — bir saat fark eder). Gecikme =
`due_at < now()` ve durum Tamamlandı değil (`public.is_overdue`); tamamlanan görev gecikmede sayılmaz, "gecikmeli tamamlandı" ayrıca gösterilir.

### ADR-7 · Bildirim üretimi ve sızıntı önleme
Bildirimler yalnızca doğrulanmış RPC'lerin içinden `private.notify` ile üretilir (istemcinin bildirim tablosuna yazma yetkisi yok).
`notify`: işlemi yapana göndermez, modül kapalıysa üretmez, alıcı aktif üye değilse veya kayda erişimi yoksa üretmez.
Okuma politikası da alıcının kayda **hâlâ** erişimi olmasını ister — gruptan çıkarılan kişi o grubun bildirim içeriğini artık göremez.
Push bildirimleri (Aşama 3) kilit ekranında içerik göstermeyecek (genel metin + uygulama içinde ayrıntı).

### ADR-8 · Realtime yalnızca "yenile" sinyali
`postgres_changes` aboneliği RLS'e tabidir. İstemci olay içeriğini kullanmaz; olay gelince ilgili sorguyu yeniden çalıştırır.
Bağlantı koptuğunda, uygulama ön plana geldiğinde veya internet geri geldiğinde de yeniler — kaçırılan olaylar tutarlı biçimde telafi edilir.

Gerçek Supabase'de doğrulanırken bulunan iki kural (`subscribeCompanyChanges`, 2026-10-13):
- **Kanala katılmadan önce oturum token'ı yüklenir** (`realtime.setAuth()`). Katılım isteği o anki token'la gider; token çerezden/
  SecureStore'dan henüz okunmadıysa katılım anonim olur ve sunucu, abone rolünün kolonu okuma yetkisi olmadığı için
  (`realtime.subscription_check_filters`) aboneliği reddeder. Web'de React'in çift yüklemesinde bu yarış her seferinde oluşuyordu.
- **"Canlı" durumu kanalın `SUBSCRIBED` olmasıyla değil, sunucunun `postgres_changes` sistem mesajıyla ("Subscribed to PostgreSQL")
  belirlenir.** İkisi arasındaki değişiklikler iletilmez; bu yüzden istemci her "canlı" geçişte (ilk bağlantı dahil) veriyi bir kez
  yeniden çeker. Abonelik reddedilirse durum "bağlantı yok" olur.
Web: `components/shell.tsx → LiveRefresh` (router.refresh). Mobil: TanStack Query + AppState + expo-network.

### ADR-13 · Mesajlaşma ve dosyalar (Aşama 2)
- **Grup sohbeti = grup**: her grubun tek sohbeti vardır (tetikleyiciyle oluşur); üyelik `group_members`'tan okunur, ayrı katılımcı
  listesi tutulmaz. Böylece gruptan çıkarma mesaj ve dosya erişimini de aynı anda keser.
- **Birebir sohbet**: `direct_key` (sıralı iki kullanıcı kimliği) ile şirket içinde tekil; `get_or_create_direct_conversation` tekrar-güvenli.
- **Mesaj tekilliği**: `(author_id, client_request_id)`. İstemci bekleyen mesajı (web: sekme oturumu, mobil: cihaz deposu) kimliğiyle
  saklar; bağlantı koptuğunda veya sayfa yenilendiğinde aynı kimlikle yeniden gönderir → tek kayıt.
- **Dosyalar**: özel `message-attachments` kovası (10 MB, izinli türler). Yol `<şirket>/<konuşma>/<yükleme>/<ad>`. Yükleme kullanıcının
  kendi oturumuyla yapılır; `storage.objects` politikaları konuşma yetki fonksiyonlarını kullanır. Mesaja bağlanırken boyut/tür
  istemciden değil Storage kaydından alınır; başkasının veya başka konuşmanın yüklemesi bağlanamaz. Görüntüleme 10 dakikalık imzalı
  bağlantıyla. Gerçek Supabase storage tablolarından SQL ile silmeyi engeller; gönderilmeyen yüklemeler Storage API ile silinir.
- **Mesajdan görev**: `tasks.source_message_id` bileşik FK ile aynı şirketteki mesaja bağlı ve tekil; eşzamanlı dönüştürme tek görev üretir.
- **Okunmamış**: kişi başına `conversation_reads.last_read_at`; konuşma okununca o konuşmadaki etiket bildirimleri de okundu sayılır.

### ADR-9 · Davet akışı
Yönetici `create_invitation` ile davet oluşturur; 64 karakterlik rastgele token **yalnızca bir kez** döner, veritabanında SHA-256
özeti tutulur; 7 gün geçerli, tek kullanımlık, iptal edilebilir, aynı adrese yeni davet eskisini geçersiz kılar.
Davet sayfası (`/davet/[token]`):
- Hesabı olan: giriş yapar ve kabul eder (`accept_invitation`, e-posta eşleşmesi veritabanında kontrol edilir).
- Hesabı olmayan: ad + şifre girer; **web sunucusu** token'ı doğrular, Auth Admin API ile davet edilen e-postaya hesap açar
  (`email_confirm: true` — tek kullanımlık gizli bağlantıya sahip olmak e-posta sahipliğinin kanıtı sayılır), kullanıcıyı oturum
  açtırır ve daveti kullanıcının kendi oturumuyla kabul eder.
Aşama 1'de bağlantı yönetici tarafından kopyalanıp iletilir (SMTP yapılandırılınca e-postayla da gönderilecek).
**Bilinen risk:** bağlantı yanlış kişiye iletilirse o kişi hesabı açabilir → kısa süre, tek kullanım, iptal, işlem geçmişi ile sınırlandı.
Hız sınırlama (rate limit) pilot öncesi eklenecek.

### ADR-10 · Modülerlik
Modül tanımı ortak pakette, açık/kapalı durumu veritabanında. Kapalı modül RPC'leri reddeder, bildirim üretmez, izinleri
geçersizleşir, verisi silinmez ve yalnızca `archive.view` ile salt okunur görünür. Ayrıntı: `MODULES.md`.

### ADR-11 · Teknoloji sürümleri (2026-10-12'de npm kayıtları ve resmi dokümanlardan doğrulandı)
- Next.js 16.4.0 (App Router, Turbopack, `proxy.ts`), React 19.2.3
- Expo SDK 57 (React Native 0.86.3, React 19.2.3, Expo Router 57) — web ve mobilde aynı React sürümü (monorepoda tek kopya)
- @supabase/supabase-js 2.117.3, @supabase/ssr 0.12.7 (`getClaims()`, yayınlanabilir anahtar), Supabase CLI 2.120.0, Postgres 17
- Zod 4.6, Tailwind CSS 4.3, TanStack Query 5, Vitest 5
- **TypeScript 6.0.3** (7.0 yerine): TS 7 (yerel derleyici) Next'in yerleşik denetleyicisinde deneysel bayrak gerektiriyor ve
  araç ekosistemi henüz tam uyumlu değil. TS 7.1 ile yeniden değerlendirilecek.
- pnpm izole kurulum (Expo SDK 54+ destekliyor); RN araç paketleri SDK sürümlerine açıkça sabitlendi.

### ADR-12 · Mobilde oturum saklama
Supabase oturumu telefonda `expo-secure-store` (Keychain/Keystore) içinde, parçalara bölünerek saklanır. Çıkışta sorgu
önbelleği temizlenir (başka hesabın verisi kalmaz).

## Veri modeli (Aşama 1)
`companies`, `profiles`, `company_members` (rol, admin_scope, status), `groups`, `group_members` (member/manager),
`member_scope_groups`, `invitations`, `modules`, `company_modules`, `permissions`, `role_permissions`, `group_role_permissions`,
`notifications`, `audit_log`, `tasks`, `task_contributors`, `task_events` (görev işlem geçmişi), `task_comments`, `task_comment_mentions`.

## Test stratejisi
- `packages/shared` — iş kuralı birim testleri (saat dilimi, gecikme, modül bağımlılığı, izin, şemalar).
- `packages/db-tests/db` — migration'ları gerçek Postgres 17'ye uygular ve RLS/RPC'yi kullanıcı oturumu taklidiyle sınar.
  Docker yoksa gömülü Postgres + Supabase'in `auth.uid()` vb. tanımlarını taklit eden **yalnızca test** katmanı
  (`src/supabase-shim.sql`). `TEST_DATABASE_URL` verilirse gerçek Supabase veritabanına karşı da çalışır.
- `packages/db-tests/e2e` — gerçek Supabase (Auth + REST + Realtime) üzerinden iki ayrı istemciyle (web yöneticisi, mobil çalışan)
  uçtan uca akış. Supabase çalışmıyorsa **atlanır**, başarılı sayılmaz.
