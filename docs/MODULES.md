# Modüler yapı

## Tanım
Her modül `packages/shared/src/modules.ts` içinde tanımlıdır:
- **kimlik** (`id`), ad, açıklama
- **menü öğeleri** (web yolu, mobil sekme)
- **izinler** (`permissions.ts` içinde `module` alanı)
- **bağımlılıklar** (`dependsOn`)
- **ana sayfa bileşenleri** (`widgets`)

Veritabanında `public.modules` (kayıt) ve `public.company_modules` (şirket başına açık/kapalı) tutulur.
Her modülün kendi migration dosyası modül kaydını, izinlerini, tablolarını ve RPC'lerini ekler.

## Modülü kapatınca ne olur (veritabanında zorlanır, yalnızca buton gizleme değildir)
1. **Menü ve ana sayfa bileşenleri** kalkar (`menuFor`, `widgetsFor` yalnızca açık modülleri döndürür).
2. **Yeni işlem engellenir**: modülün tüm RPC'leri `private.require_module` ile `module_disabled` hatası verir.
3. **Yeni bildirim üretilmez**: `private.notify` kapalı modül için bildirim yazmaz.
4. **Modül izinleri geçersizleşir**: `user_has_perm` kapalı modülün izinlerini kimseye vermez.
5. **Okuma**: normal kullanıcılar modül verisini göremez (RLS). Modülün mevcut bildirimleri de listelenmez.
6. **Veri silinmez.**
7. **Geçmişe erişim**: `archive.view` iznine sahip olanlar (şirket sahibi ve "Tüm şirket" kapsamlı yöneticiler) kapalı
   modülün kayıtlarını **salt okunur** görebilir (görev sayfasında "Arşiv görünümü" uyarısıyla). Yazma her durumda engellidir.
8. **Yeniden açınca** mevcut veriler, bildirimler ve işlemler kaldığı yerden kullanılabilir.

Testler: `packages/db-tests/db/50-modules.test.ts`.

## Bağımlılık kuralları
- `core` (Temel) kapatılamaz. **Gruplar, üyelik, davet, bildirim kutusu ve işlem geçmişi core'dadır.**
- Bir modül, bağımlı olduğu modüller açıkken açılabilir.
- Bir modül, ona bağımlı açık modül varken kapatılamaz (önce bağımlı olan kapatılır). Kontrol `set_module_enabled` içinde.

| Modül | Bağımlı olduğu | Not |
|---|---|---|
| Görevler (`tasks`) | — | Grup üyeliğini core'dan kullanır; **İletişim kapalıyken de grup görevleri çalışır.** |
| İletişim (`messaging`) | — | Aşama 2 |
| Görev onayı (`task_approval`) | Görevler | Aşama 3 |

**İki modül gerektiren özellikler** (`FEATURES`): "Mesajdan göreve dönüştür" İletişim **ve** Görevler açıkken çalışır.
İletişim kapatılırsa mesajdan oluşturulmuş görevler kalır; kaynak mesaj bağlantısı "İletişim modülü kapalı" olarak gösterilir.

## Yeni modül eklerken
1. `modules.ts` içine tanım, `permissions.ts` içine izinler.
2. Yeni migration: `modules` kaydı, `permissions`/`role_permissions`, `company_modules` (mevcut şirketler için), tablolar (RLS,
   bileşik FK), RPC'ler (`require_module`), `user_can_access_entity` genişletmesi, `select private.apply_api_grants();`.
3. `db-tests` içine: izolasyon, yetki, modül kapalıyken engelleme testleri.

Sonraki modüller (bakım, saha ziyareti, izin, stok, muhasebe, bordro) bu yapıya aynı şekilde eklenir; şimdi geliştirilmiyor.
