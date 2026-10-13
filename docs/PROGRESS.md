# İlerleme kaydı

## 2026-10-13 — Aşama 1 gerçek Supabase üzerinde doğrulandı

Docker Desktop kuruldu; yerel Supabase (Postgres 17.11, Auth, PostgREST, Realtime, Storage) ayağa kalktı, iki migration hatasız uygulandı.

### Doğrulananlar (gerçekten çalıştırıldı)
| Kontrol | Nasıl | Sonuç |
|---|---|---|
| Uçtan uca akış (davet → hesap → webden grup+görev → mobil istemcide görünür + bildirim → uygulama yeniden açılınca oturum ve veri korunur → mobilde tamamla → web Realtime olayı alır → başka şirket REST/RPC/doğrudan UPDATE ile erişemez → şirketten çıkarılanın açık oturumu kesilir → istemci anahtarıyla yönetim API'si reddedilir) | `pnpm test:e2e` (gerçek Supabase) | ✓ 7/7, art arda 3 çalıştırma + değişiklik sonrası 1 |
| 68 RLS/RPC testi gerçek Supabase veritabanında | `TEST_DATABASE_URL=… pnpm test:db` | ✓ 68/68 (gömülü PG17'de de ✓) |
| Web arayüzü gerçek veriyle (sahip): giriş, ana sayfa bileşenleri, görev listesi, yeni görev formu, görev detayı, ekip, gruplar, bildirimler, ayarlar + yetki tablosu, işlem geçmişi | Tarayıcı (Next dev, `web-dev`) | ✓ |
| **Webden atanan görev mobil kodda tamamlanır, web sayfa yenilenmeden güncellenir**: web formuyla görev → mobil kod (Expo web) Ayşe olarak görür → açınca "Görüldü" webde canlı → Başla (Üstlenildi) → Tamamlandı → web detay ve bildirim sayısı canlı güncellendi | İki tarayıcı sekmesi | ✓ |
| Mobil kod sayfa tamamen yeniden yüklenince oturum ve veri korunuyor | Expo web (AsyncStorage) | ✓ — telefondaki SecureStore yolu **doğrulanmadı** |
| @etiket bildirimi doğru kişiye canlı ulaşır | Web'den yorum + etiket → mobil rozet 6→7 yenilemesiz | ✓ |
| Modül kapatma: web menü/bileşen ve mobil sekme kalkar; çalışanın REST okuması 0 kayıt, RPC durum değiştirme ve görev oluşturma reddedilir, doğrudan UPDATE 42501; yeniden açınca veri ve bildirimler geri gelir | Arayüz + gerçek oturumla API denemesi | ✓ |
| Yönetim anahtarı web istemci paketinde yok | `.next/static` taraması (değer ve ad) | ✓ |

### Bu doğrulamada bulunan ve düzeltilen hatalar
- **Realtime web'de hiç çalışmıyordu** ("Bağlantı yok"): kanal, oturum token'ı çerezden okunmadan anonim katılıyordu; sunucu
  aboneliği reddediyordu. Ayrıca "canlı" durumu, değişiklik akışı hazır olmadan bildiriliyordu (e2e Realtime testi bu yüzden
  düştü). Düzeltme ve kurallar: `ARCHITECTURE.md` ADR-8. Gömülü Postgres testleri bu hatayı yakalayamazdı; gerçek Supabase gerekti.
- Menü sırası modül sırasına göre oluşuyordu (Görevler en altta) → `MenuItem.order` + birim testi.
- Görevler sayfası sahip/yöneticide boş "Bana verilen" listesiyle açılıyordu → tüm görevleri görebilen için varsayılan "Ekip".
- Mobil filtre/sekme seçili durumu web derlemesinde ekran okuyucuya iletilmiyordu → `aria-selected`/`aria-checked`/`aria-busy`.
- E2E'deki doğrudan UPDATE kontrolü her durumda geçen zayıf bir doğrulamaydı → `42501` ve durumun değişmediği kontrol ediliyor.
- "Okundu" düğmesi → "Okundu işaretle"; eksik favicon eklendi.

### Gerçek iPhone testi (Expo Go, SDK 57, iPhone USB internet paylaşımı) — 19:32–19:33
| Adım | Kanıt | Sonuç |
|---|---|---|
| Uygulama gerçek iPhone'da paketlenip açıldı, `demo.ayse` ile giriş | Metro: "iOS Bundled … (1497 modules)", kullanıcı "Merhaba Ayşe" ekranını gördü | ✓ |
| Webden atanan görev telefona dokunmadan geldi | Kullanıcı beyanı | ✓ |
| Telefonda açma → Görüldü 19:32:48, Başla → Üstlenildi 19:32:55 / Devam ediyor, Tamamlandı 19:32:59 | Veritabanı izlemesi (2 sn aralık) | ✓ |
| Web görev detayı, sayfa yenilenmeden dört zaman damgası + işlem geçmişi + sahip bildirim sayısı 7→9 | Tarayıcıda okundu | ✓ |
| Expo Go tamamen kapatılıp açılınca şifre sormadan açıldı (SecureStore oturumu) | Kullanıcı beyanı | ✓ |

### Hâlâ doğrulanamayanlar
- **Android cihaz** denenmedi (yalnızca iPhone). Uygulama mağaza derlemesi (EAS/dev build) değil, Expo Go içinde çalıştı.
- Telefonda arka planda uzun süre kalıp dönme, ağ kesilip geri gelme (uçak modu) senaryoları denenmedi.
- Telefonda görülen supabase-js `lock` seçeneği uyarısı için ayar kaldırıldı; uyarının kalktığı bir sonraki açılışta doğrulanacak.
- Davet e-postası (SMTP yok; bağlantı kopyalanıyor). Davetle hesap açma web arayüzünden tarayıcıda denenmedi (e2e'de API ile).
- Realtime aboneliği sunucu tarafından reddedilirse (ör. süresi dolmuş token) kanal otomatik yeniden abone olmuyor; veri yine
  odak/çevrimiçi olaylarında yenileniyor. Modül aç/kapa değişikliği diğer açık oturumlara canlı yansımıyor (sonraki yenilemede).

### Sıradaki somut adım
**Aşama 2 (İletişim)** — aşağıdaki plan geçerli. Telefonda yeniden denemek için README "Kabloyla".

## 2026-10-12 — Aşama 1 (temel + ilk çalışan akış): kod tamam, uçtan uca doğrulama Docker bekliyor

### Yapılanlar
- **Depo**: pnpm workspace (`apps/web`, `apps/mobile`, `packages/shared`, `packages/db-tests`, `supabase`). Sürümler npm kayıtlarından
  doğrulandı (bkz. `ARCHITECTURE.md` ADR-11). `supabase init` ile `config.toml` oluşturuldu ve 8 GB RAM için sadeleştirildi.
- **Veritabanı** (`supabase/migrations`):
  - `…0100_core.sql`: şirket, profil, üyelik (sahip/yönetici/çalışan, kapsamlı yönetici), gruplar (üye/grup yöneticisi), izin tablosu,
    modül kaydı ve aç/kapa, davetler (SHA-256 token), bildirim kutusu (dedupe), işlem geçmişi, RLS, RPC'ler, API yetkileri.
  - `…0200_tasks.sql`: görevler, katkıda bulunanlar, işlem geçmişi, yorum + @etiket, tekrar-güvenli RPC'ler,
    bildirildi/görüldü/üstlenildi/tamamlandı, saat dilimli son tarih, gecikme, ekip özeti, Realtime yayını.
- **Ortak paket**: yetki tablosu + izin hesabı, modül tanımları (menü, izin, bağımlılık, bileşen), görev kuralları
  (durum/öncelik metin+simge, gecikme, "bugünkü işler", olay açıklamaları), Asia/Famagusta tarih biçimleme, Zod şemaları
  (Türkçe hata), hata eşleme, web ve mobilin ortak kullandığı veri erişim katmanı ve Realtime aboneliği.
- **Web (Next.js 16)**: giriş, şirket kaydı, şirket oluşturma, davet kabul (hesabı olan/olmayan), ana sayfa (bugünkü işlerim,
  geciken, verdiğim, ekip özeti), görev listesi (bana verilen/verdiğim/ekip/geciken + durum filtresi), yeni görev, görev detayı
  (durum, beklemede nedeni, üstlenme, yorum/etiket, düzenleme, sorumlu takibi, işlem geçmişi), ekip (davet bağlantısı, rol,
  kapsam, çıkarma, bekleyen davetler), gruplar (oluşturma, üye/yönetici, arşiv), bildirimler, ayarlar (şirket, modüller,
  yetki tablosu), işlem geçmişi. Realtime canlı yenileme + bağlantı/odak/çevrimiçi olunca yenileme. Yüklenme, boş, hata durumları.
- **Mobil (Expo SDK 57)**: giriş, Bugün, Görevler (bana verilen/verdiğim, açık/tamamlanan), görev detayı (Başla, Tamamlandı,
  Beklemeye al + neden, Üstlendim, yorum, işlem geçmişi, otomatik "görüldü"), Bildirimler, Profil (şirket değiştirme, çıkış).
  Oturum SecureStore'da; Realtime + AppState + ağ durumu ile yenileme; aşağı çekerek yenileme.
- **Belgeler**: `CLAUDE.md`, `README.md`, `docs/PRODUCT_SCOPE.md`, `ARCHITECTURE.md`, `PERMISSIONS.md`, `MODULES.md`.

### Doğrulananlar (gerçekten çalıştırıldı)
| Kontrol | Nasıl | Sonuç |
|---|---|---|
| Migration'lar Postgres 17'ye uygulanıyor | `pnpm test:db` (gömülü Postgres 17) | ✓ |
| Güvenlik/iş kuralı testleri | `pnpm test:db` — 68 test | ✓ 68/68 |
| İki şirket birbirinin verisine erişemiyor (okuma, RPC, FK) | `10-tenancy.test.ts` | ✓ |
| Grup üyesi olmayan grubu/grup görevlerini göremiyor | `20-groups-roles`, `30-tasks` | ✓ |
| Çalışan yetkisi dışındaki görevi değiştiremiyor | `30-tasks.test.ts` | ✓ |
| Üyelik (grup/şirket) kaldırılınca erişim kesiliyor | `40-membership.test.ts` | ✓ |
| Kapalı modül doğrudan RPC/sorguyla kullanılamıyor | `50-modules.test.ts` | ✓ |
| Tekrar denemede mükerrer görev/olay/bildirim/yorum yok (eşzamanlı dahil) | `30-tasks.test.ts` | ✓ |
| Son tarih Famagusta kış/yaz saatine göre doğru | `30-tasks`, `shared.test.ts` | ✓ |
| Ortak iş kuralları | `pnpm test:shared` — 16 test | ✓ 16/16 |
| Tip denetimi (4 paket) | `pnpm typecheck` | ✓ |
| Web üretim derlemesi (Türkçe yol, Turbopack) | `pnpm build:web` | ✓ |
| Yönetim anahtarı tarayıcı paketinde yok | `.next/static` taraması | ✓ |
| Mobil JS paketi (Android/Hermes ve web) derleniyor | `expo export` | ✓ |
| Web arayüzü: giriş/kayıt formu, alan hataları, sunucuya ulaşılamadığında Türkçe hata, korumalı sayfa yönlendirmesi, mobil genişlik | Tarayıcıda (backend bilerek kapalı) | ✓ |

### Doğrulanamayanlar (tamamlanmış sayılmaz)
- **Gerçek Supabase üzerinde uçtan uca akış** (davet → webden görev → mobilde tamamla → webde canlı güncelleme → yeniden açınca
  oturumun korunması): test yazıldı (`packages/db-tests/e2e/phase1-flow.test.ts`) ama **Docker yok**, 7 test atlandı.
- **Web arayüzünün oturum açılmış ekranları** (ana sayfa, görevler, ekip…) gerçek veriyle tarayıcıda gezilmedi (backend yok).
- **Mobil uygulama gerçek cihazda / emülatörde** çalıştırılmadı (Android SDK yok; Expo Go için Expo hesabı gerekiyor).
- E-posta ile davet gönderimi yok (SMTP yok); davet bağlantısı kopyalanıp iletiliyor.

### Engel ve gereken kurulum
1. **Docker Desktop** (yönetici izni gerekir) → `pnpm db:start` → `pnpm db:status` çıktısıyla `apps/web/.env.local` ve
   `apps/mobile/.env` doldurulur. (Alternatif: Supabase Cloud projesi — README "Supabase Cloud ile".)
2. Telefonda test: Expo Go (SDK 57) + Expo hesabı; telefon ve bilgisayar aynı ağda; mobil `.env` içinde bilgisayarın LAN IP'si.

### Sıradaki somut adım
1. Docker kurulunca: `pnpm db:start` → `pnpm test:e2e` (7 test) → `pnpm test:db` ile aynı testleri `TEST_DATABASE_URL` vererek
   gerçek Supabase veritabanında da koştur → `pnpm db:seed-demo` → web'de yönetici olarak görev ata, mobilde (Expo Go veya
   `pnpm --filter @istakip/mobile web`) çalışan olarak tamamla, web'de canlı güncellemeyi gözle.
2. Ardından **Aşama 2 (İletişim)**: `…0300_messaging.sql` (konuşmalar: grup = grup üyeliği, birebir; mesajlar `client_request_id`
   ile tekil; ekler özel Storage kovası + `storage.objects` RLS; @etiket yalnızca konuşmaya erişimi olana; mesajdan görev →
   `tasks.source_message_id` FK + `create_task_from_message`), web/mobil mesaj ekranları, yeniden bağlanma testleri.

### Bilinen eksikler / pilot öncesi yapılacaklar
- Davetle hesap açma ve girişte hız sınırlama (rate limit); davet e-postası (SMTP veya e-posta servisi).
- Şirketten ayrılan kişiye atanmış açık görevler için "yeniden ata" uyarısı listede de gösterilsin (detayda var).
- Aşama 3: modül aç/kapa arayüzü var ama düzenlenebilir ana sayfa, görev onayı, push bildirimleri yok.
- Web'de @etiket şimdilik onay kutusu ile; Aşama 2'de mesaj yazarken "@" ile kişi seçme bileşeni gelecek.
