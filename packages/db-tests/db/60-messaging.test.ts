/**
 * İletişim modülü: grup/birebir sohbet izolasyonu, @etiket, tekrar gönderim,
 * ek dosyaları (storage.objects RLS), mesajdan göreve dönüştürme, silme,
 * üyelik kaldırma ve kapalı modül.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { TestDb, expectDenied, newId, type TestUser } from '../src/db';

let db: TestDb;
let owner: TestUser, ayse: TestUser, mehmet: TestUser, can: TestUser, lider: TestUser;
let otherOwner: TestUser, otherEmp: TestUser;
let company: string, otherCompany: string;
let group: string, groupConv: string, otherConv: string;

const BUCKET = 'message-attachments';

async function convOfGroup(groupId: string): Promise<string> {
  return (await db.admin<{ id: string }>('select id from public.conversations where group_id = $1', [groupId]))[0]!.id;
}

function send(user: TestUser, conv: string, body: string, extra: Record<string, unknown> = {}) {
  // jsonb parametresi: dizi PostgreSQL dizisi olarak değil JSON metni olarak gönderilmeli
  if (Array.isArray(extra.p_attachments)) extra = { ...extra, p_attachments: JSON.stringify(extra.p_attachments) };
  return db.rpcOne<{ id: string; body: string; deleted_at: string | null }>(user, 'send_message', {
    p_conversation: conv,
    p_body: body,
    p_client_request_id: newId(),
    ...extra,
  });
}

/** İstemcinin Storage'a yüklemesini taklit eder: kullanıcının kendi rolüyle storage.objects'e satır (RLS uygulanır). */
async function upload(user: TestUser, companyId: string, conv: string, fileName = 'rapor.pdf', mime = 'application/pdf', size = 2048) {
  const path = `${companyId}/${conv}/${randomUUID()}/${fileName}`;
  await db.query(user, `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, $3, $4, $5)`, [
    BUCKET,
    path,
    user.id,
    user.id,
    JSON.stringify({ mimetype: mime, size }),
  ]);
  return path;
}

const canReadObject = async (user: TestUser, path: string) =>
  (await db.query(user, 'select name from storage.objects where bucket_id = $1 and name = $2', [BUCKET, path])).length === 1;

const visibleMessages = (user: TestUser, conv: string) =>
  db.query<{ id: string; body: string }>(user, 'select id, body from public.messages where conversation_id = $1', [conv]);

beforeAll(async () => {
  db = new TestDb(inject('dbUrl'));
  owner = await db.createUser('Sahip');
  ayse = await db.createUser('Ayse');
  mehmet = await db.createUser('Mehmet');
  can = await db.createUser('Can Grup Disi');
  lider = await db.createUser('Grup Lideri');
  otherOwner = await db.createUser('Diger Sahip');
  otherEmp = await db.createUser('Diger Calisan');

  company = await db.createCompany(owner, 'Mesaj Şirketi');
  for (const u of [ayse, mehmet, can, lider]) await db.invite(owner, company, u);
  group = await db.createGroup(owner, company, 'Teknik', [ayse, mehmet], [lider]);
  groupConv = await convOfGroup(group);

  otherCompany = await db.createCompany(otherOwner, 'Başka Şirket');
  await db.invite(otherOwner, otherCompany, otherEmp);
  const og = await db.createGroup(otherOwner, otherCompany, 'Başka grup', [otherEmp]);
  otherConv = await convOfGroup(og);
});
afterAll(() => db.close());

describe('grup sohbeti', () => {
  it('grup oluşunca sohbeti de oluşur; yalnızca grup üyeleri görür (şirket sahibi dahil üye olmayan göremez)', async () => {
    for (const u of [ayse, mehmet, lider]) {
      expect((await db.query(u, 'select id from public.conversations where id = $1', [groupConv])).length, u.name).toBe(1);
    }
    for (const u of [can, owner, otherEmp]) {
      expect(await db.query(u, 'select id from public.conversations where id = $1', [groupConv]), u.name).toEqual([]);
    }
  });

  it('üye mesaj gönderir ve diğer üye okur; üye olmayan ne okuyabilir ne yazabilir', async () => {
    const m = await send(ayse, groupConv, 'Servis aracı yarın 09:00 hazır olsun.');
    expect((await visibleMessages(mehmet, groupConv)).map((r) => r.id)).toContain(m.id);
    for (const u of [can, owner, otherEmp]) {
      expect(await visibleMessages(u, groupConv), u.name).toEqual([]);
      await expectDenied(send(u, groupConv, 'izinsiz'), { hint: 'not_found' });
    }
    // Doğrudan tabloya yazma yetkisi yok
    await expectDenied(
      db.query(ayse, `insert into public.messages (company_id, conversation_id, author_id, body, client_request_id) values ($1, $2, $3, 'x', $4)`, [
        company,
        groupConv,
        ayse.id,
        newId(),
      ]),
      { code: '42501' },
    );
  });

  it('aynı istek kimliğiyle tekrar gönderim tek mesaj üretir (eşzamanlı dahil)', async () => {
    const crid = newId();
    const args = { p_conversation: groupConv, p_body: 'Yeniden bağlanınca tekrar gönderildi', p_client_request_id: crid };
    const results = await Promise.all([1, 2, 3, 4].map(() => db.rpcOne<{ id: string }>(ayse, 'send_message', args)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    const again = await db.rpcOne<{ id: string }>(ayse, 'send_message', args);
    expect(again.id).toBe(results[0]!.id);
    const n = await db.admin('select count(*)::int as n from public.messages where author_id = $1 and client_request_id = $2', [ayse.id, crid]);
    expect(n[0].n).toBe(1);
  });

  it('boş veya çok uzun mesaj reddedilir', async () => {
    await expectDenied(send(ayse, groupConv, '   '), { hint: 'invalid' });
    await expectDenied(send(ayse, groupConv, 'x'.repeat(4001)), { hint: 'invalid' });
  });

  it('sohbet listesi okunmamış sayısını verir; okununca sıfırlanır', async () => {
    const list = async (u: TestUser) =>
      (await db.rpc<{ id: string; unread_count: string; title: string; can_post: boolean }>(u, 'conversation_list', { p_company: company })).find(
        (c) => c.id === groupConv,
      );
    const before = await list(mehmet);
    expect(before?.title).toBe('Teknik');
    expect(Number(before?.unread_count)).toBeGreaterThan(0);
    expect(before?.can_post).toBe(true);
    await db.rpc(mehmet, 'mark_conversation_read', { p_conversation: groupConv });
    expect(Number((await list(mehmet))?.unread_count)).toBe(0);
    // Gönderenin kendi mesajı okunmamış sayılmaz
    expect(Number((await list(ayse))?.unread_count)).toBe(0);
    // Üye olmayanın listesinde yok
    expect(await list(can)).toBeUndefined();
  });
});

describe('@etiket', () => {
  it('yalnızca konuşma üyeleri etiketlenebilir; etiketlenene tek bildirim gider (tekrar denemede çoğalmaz)', async () => {
    await expectDenied(send(ayse, groupConv, '@Can bakar mısın', { p_mentions: [can.id] }), { hint: 'invalid' });
    await expectDenied(send(ayse, groupConv, '@Diğer', { p_mentions: [otherEmp.id] }), { hint: 'invalid' });

    const crid = newId();
    const args = { p_conversation: groupConv, p_body: '@Mehmet kalibrasyon raporunu ekler misin?', p_client_request_id: crid, p_mentions: [mehmet.id, ayse.id] };
    const m = await db.rpcOne<{ id: string }>(ayse, 'send_message', args);
    await db.rpcOne(ayse, 'send_message', args);

    const notifs = await db.query<{ type: string; title: string }>(mehmet, `select type, title from public.notifications where entity_id = $1`, [m.id]);
    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toMatchObject({ type: 'message_mention' });
    // Kendini etiketleme bildirim üretmez; etiket görev ataması değildir
    expect(await db.admin('select id from public.notifications where user_id = $1 and entity_id = $2', [ayse.id, m.id])).toEqual([]);
    expect(await db.admin('select id from public.tasks where source_message_id = $1', [m.id])).toEqual([]);
    // Üye olmayan kişi bildirimi göremez, kendi etiketi yok
    expect(await db.query(can, `select id from public.notifications where entity_id = $1`, [m.id])).toEqual([]);
  });

  it('konuşmayı okuyunca o konuşmadaki etiket bildirimleri okundu olur', async () => {
    const m = await send(ayse, groupConv, '@Mehmet son kontrol', { p_mentions: [mehmet.id] });
    await db.rpc(mehmet, 'mark_conversation_read', { p_conversation: groupConv });
    const n = await db.query<{ read_at: string | null }>(mehmet, 'select read_at from public.notifications where entity_id = $1', [m.id]);
    expect(n[0]?.read_at).not.toBeNull();
    const mentions = await db.rpc<{ message_id: string; is_read: boolean }>(mehmet, 'my_mentions', { p_company: company });
    expect(mentions.find((x) => x.message_id === m.id)?.is_read).toBe(true);
  });
});

describe('birebir sohbet', () => {
  it('tekildir (iki taraftan da aynı sohbet) ve yalnızca iki katılımcı görür', async () => {
    const a = await db.rpcValue<string>(ayse, 'get_or_create_direct_conversation', { p_company: company, p_user: can.id });
    const b = await db.rpcValue<string>(can, 'get_or_create_direct_conversation', { p_company: company, p_user: ayse.id });
    const [c1, c2] = await Promise.all([
      db.rpcValue<string>(ayse, 'get_or_create_direct_conversation', { p_company: company, p_user: can.id }),
      db.rpcValue<string>(ayse, 'get_or_create_direct_conversation', { p_company: company, p_user: can.id }),
    ]);
    expect(new Set([a, b, c1, c2]).size).toBe(1);

    const m = await send(ayse, a, 'Merhaba Can, depo anahtarı sende mi?');
    expect((await visibleMessages(can, a)).map((r) => r.id)).toContain(m.id);
    for (const u of [mehmet, owner, otherEmp]) expect(await visibleMessages(u, a), u.name).toEqual([]);
    await expectDenied(send(mehmet, a, 'araya giriyorum'), { hint: 'not_found' });
    // Birebir sohbette yalnızca karşı taraf etiketlenebilir
    await expectDenied(send(ayse, a, '@Mehmet', { p_mentions: [mehmet.id] }), { hint: 'invalid' });
  });

  it('başka şirketin kullanıcısıyla veya kendinle birebir sohbet açılamaz', async () => {
    await expectDenied(db.rpc(ayse, 'get_or_create_direct_conversation', { p_company: company, p_user: otherEmp.id }), { hint: 'invalid' });
    await expectDenied(db.rpc(ayse, 'get_or_create_direct_conversation', { p_company: otherCompany, p_user: otherEmp.id }), { hint: 'forbidden' });
    await expectDenied(db.rpc(ayse, 'get_or_create_direct_conversation', { p_company: company, p_user: ayse.id }), { hint: 'invalid' });
  });
});

describe('ek dosyalar (Storage RLS)', () => {
  it('yalnızca yazabildiği konuşmanın yoluna yükleyebilir', async () => {
    await upload(ayse, company, groupConv);
    for (const [u, c, conv] of [
      [can, company, groupConv],
      [otherEmp, company, groupConv],
      [ayse, otherCompany, otherConv],
      [ayse, otherCompany, groupConv], // yol şirketi konuşmanın şirketiyle uyuşmuyor
    ] as const) {
      await expectDenied(upload(u, c, conv), { code: '42501' });
    }
    // Biçimi bozuk yol reddedilir
    await expectDenied(
      db.query(ayse, `insert into storage.objects (bucket_id, name, owner, owner_id) values ($1, $2, $3, $4)`, [BUCKET, `${company}/${groupConv}/x.pdf`, ayse.id, ayse.id]),
      { code: '42501' },
    );
  });

  it('mesaja eklenen dosyayı konuşma üyeleri görür; üye olmayan ve başka şirket göremez', async () => {
    const path = await upload(ayse, company, groupConv, 'servis-formu.pdf', 'application/pdf', 4096);
    expect(await canReadObject(ayse, path)).toBe(true); // gönderilmemiş kendi yüklemesi
    expect(await canReadObject(mehmet, path)).toBe(false); // henüz mesaja bağlanmadı

    const m = await send(ayse, groupConv, 'Form ekte', { p_attachments: [{ path, name: 'Servis formu (imzalı).pdf' }] });
    const att = await db.query<{ file_name: string; size_bytes: string; mime_type: string; is_image: boolean }>(
      mehmet,
      'select file_name, size_bytes, mime_type, is_image from public.message_attachments where message_id = $1',
      [m.id],
    );
    expect(att).toEqual([{ file_name: 'Servis formu (imzalı).pdf', size_bytes: '4096', mime_type: 'application/pdf', is_image: false }]);
    expect(await canReadObject(mehmet, path)).toBe(true);
    for (const u of [can, owner, otherEmp]) {
      expect(await canReadObject(u, path), u.name).toBe(false);
      expect(await db.query(u, 'select id from public.message_attachments where message_id = $1', [m.id])).toEqual([]);
    }
  });

  it('başkasının yüklemesi, başka konuşmanın dosyası veya zaten bağlı dosya eklenemez', async () => {
    const mehmetsUpload = await upload(mehmet, company, groupConv);
    await expectDenied(send(ayse, groupConv, 'onun dosyası', { p_attachments: [{ path: mehmetsUpload }] }), { hint: 'invalid' });

    const dm = await db.rpcValue<string>(ayse, 'get_or_create_direct_conversation', { p_company: company, p_user: can.id });
    const dmUpload = await upload(ayse, company, dm);
    await expectDenied(send(ayse, groupConv, 'yanlış konuşma', { p_attachments: [{ path: dmUpload }] }), { hint: 'invalid' });

    const linked = await upload(ayse, company, groupConv);
    await send(ayse, groupConv, 'ilk', { p_attachments: [{ path: linked }] });
    await expectDenied(send(ayse, groupConv, 'ikinci kez', { p_attachments: [{ path: linked }] }), { hint: 'invalid' });
  });

  // Gerçek Supabase, storage tablolarından SQL ile silmeyi engeller (yalnızca Storage API);
  // orada aynı kural uçtan uca testte Storage API ile sınanır (e2e/phase2-messaging.test.ts).
  it.runIf(inject('dbMode') === 'embedded')('mesaja bağlı dosya silinemez; gönderilmemiş kendi yüklemesi silinebilir', async () => {
    const linked = await upload(ayse, company, groupConv);
    await send(ayse, groupConv, 'bağlı', { p_attachments: [{ path: linked }] });
    await db.query(ayse, 'delete from storage.objects where bucket_id = $1 and name = $2', [BUCKET, linked]);
    expect((await db.admin('select 1 from storage.objects where name = $1', [linked])).length).toBe(1);
    const pending = await upload(ayse, company, groupConv);
    await db.query(mehmet, 'delete from storage.objects where bucket_id = $1 and name = $2', [BUCKET, pending]);
    expect((await db.admin('select 1 from storage.objects where name = $1', [pending])).length).toBe(1);
    await db.query(ayse, 'delete from storage.objects where bucket_id = $1 and name = $2', [BUCKET, pending]);
    expect(await db.admin('select 1 from storage.objects where name = $1', [pending])).toEqual([]);
  });

  it('yalnızca dosyadan oluşan mesaj gönderilebilir; fotoğraf olarak işaretlenir', async () => {
    const photo = await upload(ayse, company, groupConv, 'cihaz.jpg', 'image/jpeg', 120_000);
    const m = await send(ayse, groupConv, '', { p_attachments: [{ path: photo, name: 'cihaz.jpg' }] });
    const att = await db.query<{ is_image: boolean }>(ayse, 'select is_image from public.message_attachments where message_id = $1', [m.id]);
    expect(att[0]?.is_image).toBe(true);
  });
});

describe('mesajdan göreve dönüştürme', () => {
  it('çalışan, mesajı kendine görev yapar; görev grup ve kaynak mesaja bağlanır; tekrar dönüştürme çoğaltmaz', async () => {
    const m = await send(mehmet, groupConv, 'Kuvöz 3 alarm veriyor, kontrol edilmeli.');
    const t1 = await db.rpcOne<{ id: string; group_id: string; source_message_id: string; description: string; assignee_id: string }>(
      ayse,
      'create_task_from_message',
      { p_message: m.id, p_title: 'Kuvöz 3 alarm kontrolü', p_assignee: ayse.id, p_client_request_id: newId() },
    );
    expect(t1).toMatchObject({ group_id: group, source_message_id: m.id, assignee_id: ayse.id, description: 'Kuvöz 3 alarm veriyor, kontrol edilmeli.' });

    // Aynı kişi yeni istekle ya da başka üye tekrar denerse aynı görev döner
    const t2 = await db.rpcOne<{ id: string }>(ayse, 'create_task_from_message', { p_message: m.id, p_title: 'tekrar', p_assignee: ayse.id, p_client_request_id: newId() });
    const t3 = await db.rpcOne<{ id: string }>(mehmet, 'create_task_from_message', { p_message: m.id, p_title: 'başkası', p_assignee: mehmet.id, p_client_request_id: newId() });
    expect(new Set([t1.id, t2.id, t3.id]).size).toBe(1);
    expect((await db.admin('select count(*)::int as n from public.tasks where source_message_id = $1', [m.id]))[0].n).toBe(1);

    // Mesaj sahibine "göreve dönüştürüldü" bildirimi (bir kez)
    const n = await db.query<{ type: string }>(mehmet, `select type from public.notifications where type = 'message_converted' and entity_id = $1`, [t1.id]);
    expect(n).toHaveLength(1);
  });

  it('eşzamanlı dönüştürme tek görev üretir', async () => {
    const m = await send(mehmet, groupConv, 'Yedek parça siparişi verilecek.');
    const ids = await Promise.all(
      [ayse, ayse, mehmet].map((u) =>
        db.rpcOne<{ id: string }>(u, 'create_task_from_message', { p_message: m.id, p_title: 'Sipariş', p_assignee: u.id, p_client_request_id: newId() }),
      ),
    );
    expect(new Set(ids.map((t) => t.id)).size).toBe(1);
  });

  it('çalışan başkasına atayamaz; grup lideri olmayan yetkisizdir; üye olmayan dönüştüremez', async () => {
    const m = await send(ayse, groupConv, 'Faturayı kontrol et.');
    await expectDenied(
      db.rpc(ayse, 'create_task_from_message', { p_message: m.id, p_title: 'Fatura', p_assignee: mehmet.id, p_client_request_id: newId() }),
      { hint: 'forbidden' },
    );
    await expectDenied(
      db.rpc(can, 'create_task_from_message', { p_message: m.id, p_title: 'Fatura', p_assignee: can.id, p_client_request_id: newId() }),
      { hint: 'not_found' },
    );
    // Sahip grup üyesi değil → mesajı göremez
    await expectDenied(
      db.rpc(owner, 'create_task_from_message', { p_message: m.id, p_title: 'Fatura', p_assignee: owner.id, p_client_request_id: newId() }),
      { hint: 'not_found' },
    );
  });

  it('kaynak mesaj bağlantısı şirket sınırını aşamaz (bileşik yabancı anahtar)', async () => {
    const foreign = await send(otherEmp, otherConv, 'başka şirketin mesajı');
    await expectDenied(
      db.admin(
        `insert into public.tasks (company_id, title, assignee_id, created_by, source_message_id, client_request_id) values ($1, 'x', $2, $2, $3, $4)`,
        [company, ayse.id, foreign.id, newId()],
      ),
      { code: '23503' },
    );
  });
});

describe('mesaj silme', () => {
  it('yazar kendi mesajını siler; içerik, ek ve etiket bildirimi erişilemez olur', async () => {
    const path = await upload(ayse, company, groupConv);
    const m = await send(ayse, groupConv, '@Mehmet yanlış kişiye yazdım', { p_mentions: [mehmet.id], p_attachments: [{ path }] });
    expect(await canReadObject(mehmet, path)).toBe(true);
    await expectDenied(db.rpc(mehmet, 'delete_message', { p_message: m.id }), { hint: 'forbidden' });

    await db.rpc(ayse, 'delete_message', { p_message: m.id });
    const row = await db.query<{ body: string; deleted_at: string | null }>(mehmet, 'select body, deleted_at from public.messages where id = $1', [m.id]);
    expect(row[0]).toMatchObject({ body: '' });
    expect(row[0]?.deleted_at).not.toBeNull();
    expect(await canReadObject(mehmet, path)).toBe(false);
    expect(await db.query(mehmet, 'select id from public.notifications where entity_id = $1', [m.id])).toEqual([]);
    await expectDenied(
      db.rpc(ayse, 'create_task_from_message', { p_message: m.id, p_title: 'x', p_assignee: ayse.id, p_client_request_id: newId() }),
      { hint: 'invalid' },
    );
  });

  it('grup lideri (messages.moderate) grup sohbetinde başkasının mesajını silebilir ve işlem geçmişine yazılır', async () => {
    const m = await send(mehmet, groupConv, 'uygunsuz içerik');
    await db.rpc(lider, 'delete_message', { p_message: m.id });
    const audit = await db.admin(`select action from public.audit_log where entity_id = $1`, [m.id]);
    expect(audit.map((a: { action: string }) => a.action)).toEqual(['message.deleted_by_moderator']);
  });
});

describe('üyeliğin kaldırılması', () => {
  it('gruptan çıkarılan kişi grup mesajlarını ve dosyalarını anında göremez; geri eklenince görür', async () => {
    const path = await upload(ayse, company, groupConv);
    await send(ayse, groupConv, 'Çıkarılmadan önce', { p_attachments: [{ path }] });
    expect((await visibleMessages(mehmet, groupConv)).length).toBeGreaterThan(0);

    await db.rpc(owner, 'remove_group_member', { p_group: group, p_user: mehmet.id });
    expect(await visibleMessages(mehmet, groupConv)).toEqual([]);
    expect(await canReadObject(mehmet, path)).toBe(false);
    expect(await db.query(mehmet, `select id from public.notifications where type = 'message_mention'`)).toEqual([]);
    await expectDenied(send(mehmet, groupConv, 'hâlâ buradayım'), { hint: 'not_found' });
    await expectDenied(upload(mehmet, company, groupConv), { code: '42501' });

    await db.rpc(owner, 'add_group_members', { p_group: group, p_user_ids: [mehmet.id] });
    expect((await visibleMessages(mehmet, groupConv)).length).toBeGreaterThan(0);
  });

  it('arşivlenmiş grupta geçmiş okunur ama yeni mesaj gönderilemez', async () => {
    const g = await db.createGroup(owner, company, 'Geçici proje', [ayse, mehmet]);
    const conv = await convOfGroup(g);
    await send(ayse, conv, 'Proje bitti');
    await db.rpc(owner, 'archive_group', { p_group: g });
    expect((await visibleMessages(mehmet, conv)).length).toBe(1);
    await expectDenied(send(ayse, conv, 'arşivden sonra'), { hint: 'forbidden' });
  });
});

describe('İletişim modülü kapalıyken', () => {
  it('mesajlar okunamaz, gönderilemez, dosya yüklenemez; arşiv yetkilisi yalnızca kendi konuşmasını görür; açınca geri gelir', async () => {
    const ownerDm = await db.rpcValue<string>(owner, 'get_or_create_direct_conversation', { p_company: company, p_user: ayse.id });
    const dmMsg = await send(ayse, ownerDm, 'Sahibe birebir mesaj');
    await send(ayse, groupConv, 'Kapanmadan önce');

    await db.rpc(owner, 'set_module_enabled', { p_company: company, p_module: 'messaging', p_enabled: false });
    try {
      expect(await visibleMessages(mehmet, groupConv)).toEqual([]);
      expect(await visibleMessages(ayse, ownerDm)).toEqual([]);
      await expectDenied(send(ayse, groupConv, 'kapalıyken'), { hint: 'not_found' });
      await expectDenied(db.rpc(ayse, 'get_or_create_direct_conversation', { p_company: company, p_user: mehmet.id }), { hint: 'module_disabled' });
      await expectDenied(upload(ayse, company, groupConv), { code: '42501' });
      expect(await db.rpc(ayse, 'conversation_list', { p_company: company })).toEqual([]);

      // Sahip (archive.view) kendi birebir konuşmasını salt okunur görür ama üyesi olmadığı grup sohbetini göremez
      expect((await visibleMessages(owner, ownerDm)).map((r) => r.id)).toContain(dmMsg.id);
      expect(await visibleMessages(owner, groupConv)).toEqual([]);
      await expectDenied(send(owner, ownerDm, 'arşivden yazma'), { hint: 'module_disabled' });

      // Mesajdan görev de engelli (iki modül gerekir)
      await expectDenied(
        db.rpc(owner, 'create_task_from_message', { p_message: dmMsg.id, p_title: 'x', p_assignee: owner.id, p_client_request_id: newId() }),
        { hint: 'module_disabled' },
      );
    } finally {
      await db.rpc(owner, 'set_module_enabled', { p_company: company, p_module: 'messaging', p_enabled: true });
    }
    expect((await visibleMessages(mehmet, groupConv)).length).toBeGreaterThan(0);
  });

  it('Görevler kapalıyken mesajlaşma çalışır ama mesajdan görev oluşturulamaz', async () => {
    const m = await send(ayse, groupConv, 'Görevler kapalıyken mesaj');
    await db.rpc(owner, 'set_module_enabled', { p_company: company, p_module: 'task_approval', p_enabled: false });
    await db.rpc(owner, 'set_module_enabled', { p_company: company, p_module: 'tasks', p_enabled: false });
    try {
      await expectDenied(
        db.rpc(ayse, 'create_task_from_message', { p_message: m.id, p_title: 'x', p_assignee: ayse.id, p_client_request_id: newId() }),
        { hint: 'module_disabled' },
      );
      await send(mehmet, groupConv, 'mesajlaşma devam ediyor');
    } finally {
      await db.rpc(owner, 'set_module_enabled', { p_company: company, p_module: 'tasks', p_enabled: true });
      await db.rpc(owner, 'set_module_enabled', { p_company: company, p_module: 'task_approval', p_enabled: true });
    }
  });
});

describe('şirketten çıkarma', () => {
  it('çıkarılan kişi birebir mesajları göremez; kalan kişi geçmişi görür ama yeni mesaj yazamaz', async () => {
    const leaver = await db.createUser('Ayrilan');
    await db.invite(owner, company, leaver);
    const dm = await db.rpcValue<string>(ayse, 'get_or_create_direct_conversation', { p_company: company, p_user: leaver.id });
    await send(leaver, dm, 'Görüşmek üzere');
    await db.rpc(owner, 'remove_member', { p_company: company, p_user: leaver.id });

    expect(await visibleMessages(leaver, dm)).toEqual([]);
    expect((await visibleMessages(ayse, dm)).length).toBe(1);
    await expectDenied(send(ayse, dm, 'orada mısın'), { hint: 'forbidden' });
    const entry = (await db.rpc<{ id: string; can_post: boolean }>(ayse, 'conversation_list', { p_company: company })).find((c) => c.id === dm);
    expect(entry?.can_post).toBe(false);
  });
});
