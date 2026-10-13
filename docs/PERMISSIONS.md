# Yetki tablosu

Kaynak: `packages/shared/src/permissions.ts` ve migration'lardaki `public.permissions`, `public.role_permissions`,
`public.group_role_permissions`. `packages/db-tests/db/00-schema.test.ts` iki tarafın aynı olduğunu doğrular.
Kontrol veritabanında `private.user_has_perm(user, company, permission, group)` fonksiyonundadır; arayüz yalnızca aynı
mantığın kopyasıyla buton göster/gizle kararı verir.

## Roller
- **Şirket sahibi (owner)** — her izin, şirket genelinde.
- **Yönetici (admin)** — kapsamı iki türlü olabilir (`company_members.admin_scope`):
  - `company` → yönetici izinleri şirket genelinde.
  - `groups` → yönetici izinleri **yalnızca** `member_scope_groups` içindeki gruplarda ve yalnızca "grupla sınırlanabilir"
    izinlerde geçerli. Şirket geneli izinlerde kısıtlı yönetici çalışan haklarına sahiptir.
- **Çalışan (employee)** — taban izinler (herkes alır).
- **Grup yöneticisi** (`group_members.role = 'manager'`) — şirket rolünden bağımsız; yalnızca kendi grubunda geçerli.

## İzinler

| İzin | Modül | Kapsam | Sahip | Yönetici | Çalışan | Grup yöneticisi |
|---|---|---|:-:|:-:|:-:|:-:|
| `company.manage` Şirket bilgileri/ayarları | Temel | Şirket | ✓ | — | — | — |
| `modules.manage` Modül aç/kapat | Temel | Şirket | ✓ | ✓ | — | — |
| `members.invite` Çalışan davet | Temel | Şirket | ✓ | ✓ | — | — |
| `members.manage` Rol değiştirme, şirketten çıkarma | Temel | Şirket | ✓ | ✓* | — | — |
| `groups.create` Grup oluşturma/arşivleme | Temel | Şirket | ✓ | ✓ | — | — |
| `groups.manage` Grup bilgisi ve üyeleri | Temel | Grup | ✓ | ✓ | — | ✓ (kendi grubu) |
| `audit.view` İşlem geçmişi | Temel | Şirket | ✓ | ✓ | — | — |
| `archive.view` Kapalı modül verisini salt okunur görme | Temel | Şirket | ✓ | ✓ | — | — |
| `dashboard.manage_defaults` Varsayılan ana sayfa | Temel | Şirket | ✓ | ✓ | — | — |
| `tasks.create` Kendine görev oluşturma | Görevler | Şirket | ✓ | ✓ | ✓ | — |
| `tasks.assign` Başkasına görev atama | Görevler | Grup | ✓ | ✓ | — | — |
| `tasks.view_all` Kapsamdaki tüm görevleri görme | Görevler | Grup | ✓ | ✓ | — | — |
| `tasks.manage_all` Kapsamdaki görevleri düzenleme/yeniden atama | Görevler | Grup | ✓ | ✓ | — | — |
| `messages.direct` Birebir mesaj başlatma | İletişim | Şirket | ✓ | ✓ | ✓ | — |
| `messages.moderate` Grup sohbetinde başkasının mesajını silme | İletişim | Grup | ✓ | ✓ | — | ✓ (kendi grubu) |

\* Ek kurallar (RPC içinde): rolleri yalnızca **sahip** değiştirir; yöneticiyi yalnızca sahip çıkarır; sahip çıkarılamaz,
rolü değiştirilemez; kimse kendi rolünü değiştiremez veya kendini çıkaramaz. Yönetici davetini yalnızca sahip gönderir.

Onay (`tasks.approve`) izni Aşama 3'te eklenecek.

## Mesajlar üzerindeki haklar
| İşlem | Kim |
|---|---|
| Grup sohbetini okumak/yazmak | Yalnızca grubun **aktif üyeleri**. Şirket sahibi ve yöneticiler de üye değilse göremez; gerekirse kendini gruba ekler (işlem geçmişine yazılır) |
| Birebir sohbet | Yalnızca iki katılımcı; karşı taraf şirketten ayrılınca geçmiş okunur, yeni mesaj yazılamaz |
| Dosya yüklemek / indirmek | Konuşmaya yazabilen yükler; konuşmayı görebilen, silinmemiş mesajın dosyasını kısa süreli imzalı bağlantıyla indirir (kova herkese açık değil) |
| @etiketlemek | Yalnızca konuşmanın üyeleri etiketlenebilir; etiket bildirim üretir, görev ataması değildir |
| Mesaj silmek | Yazarı; grup sohbetinde `messages.moderate` izni olan (işlem geçmişine yazılır) |
| Göreve dönüştürmek | Mesajı görebilen; görev atama kuralları aynen geçerli (çalışan yalnızca kendine) |
| Arşivlenmiş grup | Geçmiş okunur, yeni mesaj yazılamaz |

## Görev üzerindeki haklar
| İşlem | Kim |
|---|---|
| Görmek | Sorumlu, görevi veren, katkıda bulunanlar, bağlı grubun üyeleri, kapsamında `tasks.view_all` olan |
| Durum değiştirmek (Başla / Beklemeye al / Tamamla / Yeniden aç) | Sorumlu, görevi veren, kapsamında `tasks.manage_all` olan |
| Üstlenmek, "görüldü" | Yalnızca sorumlu |
| Başlık/açıklama/son tarih/sorumlu/grup değiştirmek | Görevi veren, kapsamında `tasks.manage_all` olan (yeni kişiye atamak ayrıca `tasks.assign` ister) |
| Yorum yazmak | Görevi gören herkes |
| @etiketlemek | Yalnızca görevi görebilen kişi etiketlenebilir |

Kısıtlı yönetici yalnızca kapsam grubuna bağlı görevlerde ve o grubun üyelerine atama yapabilir.

## Erişimin kaldırılması
- **Gruptan çıkarma**: grup kaydı silinir → grup görevleri, grup bildirimleri, **grup mesajları ve dosyaları** RLS ile anında görünmez (açık oturum ve Realtime dahil).
  Kişinin sorumlu/katkıda bulunan olduğu görevler görünmeye devam eder.
- **Şirketten çıkarma**: üyelik `removed` olur, grup ve kapsam kayıtları silinir. Her sorgu aktif üyeliği kontrol ettiğinden
  açık oturum olsa bile (web, mobil, Realtime) erişim anında kesilir. Geçmiş kayıtlar silinmez; ad gösterimi korunur.
