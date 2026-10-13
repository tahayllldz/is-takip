/**
 * Görevler: yetki, durum geçişleri, tekrar-güvenlik, bildirimler, saat dilimi,
 * yorum ve @etiketleme.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { TestDb, expectDenied, newId, type TestUser } from '../src/db';

let db: TestDb;
let owner: TestUser, emp: TestUser, emp2: TestUser, outsider: TestUser;
let company: string, group: string;

beforeAll(async () => {
  db = new TestDb(inject('dbUrl'));
  owner = await db.createUser('Sahip');
  emp = await db.createUser('Calisan');
  emp2 = await db.createUser('Calisan Iki');
  outsider = await db.createUser('Gruba Uye Olmayan');
  company = await db.createCompany(owner);
  for (const u of [emp, emp2, outsider]) await db.invite(owner, company, u);
  group = await db.createGroup(owner, company, 'Saha', [emp, emp2]);
});
afterAll(() => db.close());

const notifs = (u: TestUser, taskId: string) =>
  db.query(u, 'select type, title, dedupe_key from public.notifications where user_id = $1 and entity_id = $2 order by created_at', [u.id, taskId]);

describe('görev atama ve görünürlük', () => {
  it('yönetici görev atar; sorumluya bildirim gider ve "bildirildi" kaydı düşer', async () => {
    const t = await db.createTask(owner, company, emp, { p_title: 'Cihaz teslimi', p_priority: 'high' });
    expect(t.status).toBe('new');
    expect(t.notified_at).not.toBeNull();
    expect(t.seen_at).toBeNull();
    expect(t.accepted_at).toBeNull();
    const n = await notifs(emp, t.id);
    expect(n.map((x) => x.type)).toEqual(['task_assigned']);
  });

  it('çalışan kendine görev oluşturabilir ama başkasına atayamaz', async () => {
    const own = await db.createTask(emp, company, emp, { p_title: 'Kendi işim' });
    expect(own.notified_at).toBeNull(); // kendine bildirim gitmez
    await expectDenied(db.createTask(emp, company, emp2), { hint: 'forbidden' });
    await expectDenied(db.createTask(emp, company, emp, { p_contributors: [emp2.id] }), { hint: 'forbidden' });
  });

  it('grup görevini grup üyeleri görür, grup dışı çalışan görmez', async () => {
    const t = await db.createTask(owner, company, emp, { p_group: group });
    expect((await db.query(emp2, 'select id from public.tasks where id = $1', [t.id])).length).toBe(1);
    expect(await db.query(outsider, 'select id from public.tasks where id = $1', [t.id])).toEqual([]);
  });

  it('katkıda bulunan görevi görür ve bildirim alır', async () => {
    const t = await db.createTask(owner, company, emp, { p_contributors: [outsider.id] });
    expect((await db.query(outsider, 'select id from public.tasks where id = $1', [t.id])).length).toBe(1);
    expect((await notifs(outsider, t.id)).map((x) => x.type)).toEqual(['task_contributor_added']);
  });
});

describe('durum değişikliği yetkisi', () => {
  it('sorumlu durumu değiştirir; görevi veren bildirim alır', async () => {
    const t = await db.createTask(owner, company, emp);
    const s1 = await db.rpcOne(emp, 'set_task_status', { p_task: t.id, p_status: 'in_progress' });
    expect(s1.status).toBe('in_progress');
    expect(s1.started_at).not.toBeNull();
    expect(s1.accepted_at).not.toBeNull(); // işe başlamak üstlenmeyi kaydeder
    expect(s1.seen_at).not.toBeNull();
    const s2 = await db.rpcOne(emp, 'set_task_status', { p_task: t.id, p_status: 'done' });
    expect(s2.status).toBe('done');
    expect(s2.completed_at).not.toBeNull();
    const types = (await notifs(owner, t.id)).map((x) => x.type);
    expect(types).toEqual(['task_status_changed', 'task_completed']);
  });

  it('grup üyesi (sorumlu olmayan) görevi görür ama durumunu değiştiremez', async () => {
    const t = await db.createTask(owner, company, emp, { p_group: group });
    await expectDenied(db.rpc(emp2, 'set_task_status', { p_task: t.id, p_status: 'done' }), { hint: 'forbidden' });
    await expectDenied(db.rpc(emp2, 'update_task', { p_task: t.id, p_changes: { title: 'değişti' } }), { hint: 'forbidden' });
  });

  it('göremediği görevi değiştiremez (varlığı da sızmaz)', async () => {
    const t = await db.createTask(owner, company, emp);
    await expectDenied(db.rpc(outsider, 'set_task_status', { p_task: t.id, p_status: 'done' }), { hint: 'not_found' });
    await expectDenied(db.rpc(outsider, 'accept_task', { p_task: t.id }), { hint: 'not_found' });
  });

  it('sorumlu görevin başlığını/son tarihini değiştiremez; görevi veren değiştirebilir', async () => {
    const t = await db.createTask(owner, company, emp);
    await expectDenied(db.rpc(emp, 'update_task', { p_task: t.id, p_changes: { title: 'yeni' } }), { hint: 'forbidden' });
    const u = await db.rpcOne(owner, 'update_task', { p_task: t.id, p_changes: { title: 'Yeni başlık' } });
    expect(u.title).toBe('Yeni başlık');
  });

  it('beklemeye alırken neden zorunlu', async () => {
    const t = await db.createTask(owner, company, emp);
    await expectDenied(db.rpc(emp, 'set_task_status', { p_task: t.id, p_status: 'on_hold' }), { hint: 'invalid' });
    const s = await db.rpcOne(emp, 'set_task_status', { p_task: t.id, p_status: 'on_hold', p_reason: 'Parça bekleniyor' });
    expect(s.hold_reason).toBe('Parça bekleniyor');
    const back = await db.rpcOne(emp, 'set_task_status', { p_task: t.id, p_status: 'in_progress' });
    expect(back.hold_reason).toBeNull();
  });

  it('yeniden açılan görevin tamamlanma zamanı temizlenir', async () => {
    const t = await db.createTask(owner, company, emp);
    await db.rpc(emp, 'set_task_status', { p_task: t.id, p_status: 'done' });
    const r = await db.rpcOne(owner, 'set_task_status', { p_task: t.id, p_status: 'in_progress' });
    expect(r.completed_at).toBeNull();
  });

  it('eski sürüme dayanan değişiklik çakışma hatası verir', async () => {
    const t = await db.createTask(owner, company, emp);
    await db.rpc(owner, 'update_task', { p_task: t.id, p_changes: { priority: 'urgent' } });
    await expectDenied(
      db.rpc(emp, 'set_task_status', { p_task: t.id, p_status: 'in_progress', p_expected_version: t.version }),
      { hint: 'conflict' },
    );
  });
});

describe('bildirildi / görüldü / üstlenildi / tamamlandı ayrımı', () => {
  it('her adım ayrı zaman damgasıdır ve yalnızca sorumlu için işler', async () => {
    const t = await db.createTask(owner, company, emp);
    // görevi veren açınca "görüldü" düşmez
    const byOwner = await db.rpcOne(owner, 'mark_task_seen', { p_task: t.id });
    expect(byOwner.seen_at).toBeNull();
    const seen = await db.rpcOne(emp, 'mark_task_seen', { p_task: t.id });
    expect(seen.seen_at).not.toBeNull();
    expect(seen.accepted_at).toBeNull();
    const acc = await db.rpcOne(emp, 'accept_task', { p_task: t.id });
    expect(acc.accepted_at).not.toBeNull();
    expect(acc.status).toBe('new'); // üstlenmek durumu değiştirmez
    expect(acc.completed_at).toBeNull();
    await expectDenied(db.rpc(owner, 'accept_task', { p_task: t.id }), { hint: 'forbidden' });
    expect((await notifs(owner, t.id)).map((x) => x.type)).toEqual(['task_accepted']);
  });

  it('yeniden atamada görüldü/üstlenildi sıfırlanır, yeni sorumluya bildirim gider', async () => {
    const t = await db.createTask(owner, company, emp);
    await db.rpc(emp, 'accept_task', { p_task: t.id });
    const r = await db.rpcOne(owner, 'update_task', { p_task: t.id, p_changes: { assignee_id: emp2.id } });
    expect(r.assignee_id).toBe(emp2.id);
    expect(r.accepted_at).toBeNull();
    expect(r.seen_at).toBeNull();
    expect(r.notified_at).not.toBeNull();
    expect((await notifs(emp2, t.id)).map((x) => x.type)).toEqual(['task_assigned']);
    // eski sorumlu artık görevi göremez (görevle başka bağı yok)
    expect(await db.query(emp, 'select id from public.tasks where id = $1', [t.id])).toEqual([]);
  });
});

describe('tekrar denemelerde mükerrer kayıt oluşmaz', () => {
  it('aynı istek kimliğiyle görev iki kez oluşturulamaz', async () => {
    const crid = newId();
    const a = await db.rpcOne(owner, 'create_task', { p_company: company, p_title: 'Tek', p_assignee: emp.id, p_client_request_id: crid });
    const b = await db.rpcOne(owner, 'create_task', { p_company: company, p_title: 'Tek', p_assignee: emp.id, p_client_request_id: crid });
    expect(b.id).toBe(a.id);
    const count = await db.admin('select count(*)::int as n from public.tasks where client_request_id = $1', [crid]);
    expect(count[0].n).toBe(1);
    expect((await notifs(emp, a.id)).length).toBe(1);
  });

  it('eşzamanlı aynı istek de tek kayıt üretir', async () => {
    const crid = newId();
    const args = { p_company: company, p_title: 'Eşzamanlı', p_assignee: emp.id, p_client_request_id: crid };
    const [a, b] = await Promise.all([db.rpcOne(owner, 'create_task', args), db.rpcOne(owner, 'create_task', args)]);
    expect(a.id).toBe(b.id);
    const count = await db.admin('select count(*)::int as n from public.tasks where client_request_id = $1', [crid]);
    expect(count[0].n).toBe(1);
  });

  it('aynı durum değişikliği tekrarlanırsa tek olay ve tek bildirim', async () => {
    const t = await db.createTask(owner, company, emp);
    await db.rpc(emp, 'set_task_status', { p_task: t.id, p_status: 'done' });
    await db.rpc(emp, 'set_task_status', { p_task: t.id, p_status: 'done' });
    const ev = await db.admin(`select count(*)::int as n from public.task_events where task_id = $1 and type = 'status_changed'`, [t.id]);
    expect(ev[0].n).toBe(1);
    expect((await notifs(owner, t.id)).length).toBe(1);
  });

  it('aynı yorum tekrar gönderilirse tek yorum', async () => {
    const t = await db.createTask(owner, company, emp);
    const crid = newId();
    const a = await db.rpcOne(emp, 'add_task_comment', { p_task: t.id, p_body: 'Tamam', p_client_request_id: crid });
    const b = await db.rpcOne(emp, 'add_task_comment', { p_task: t.id, p_body: 'Tamam', p_client_request_id: crid });
    expect(a.id).toBe(b.id);
    expect((await db.admin('select count(*)::int as n from public.task_comments where task_id = $1', [t.id]))[0].n).toBe(1);
  });
});

describe('yorum ve @etiketleme', () => {
  it('etiketlenen kişi tek bildirim alır (etiket), diğer taraflar "yorum" bildirimi alır', async () => {
    const t = await db.createTask(owner, company, emp, { p_group: group });
    await db.rpc(owner, 'add_task_comment', { p_task: t.id, p_body: '@Çalışan İki bakar mısın?', p_client_request_id: newId(), p_mentions: [emp2.id] });
    expect((await notifs(emp2, t.id)).map((x) => x.type)).toEqual(['task_mention']);
    expect((await notifs(emp, t.id)).map((x) => x.type)).toEqual(['task_assigned', 'task_comment']);
  });

  it('görevi göremeyen kişi etiketlenemez (içerik sızmaz)', async () => {
    const t = await db.createTask(owner, company, emp);
    await expectDenied(
      db.rpc(owner, 'add_task_comment', { p_task: t.id, p_body: 'gizli', p_client_request_id: newId(), p_mentions: [outsider.id] }),
      { hint: 'invalid' },
    );
    expect(await notifs(outsider, t.id)).toEqual([]);
  });
});

describe('son tarih ve gecikme (Asia/Famagusta)', () => {
  it('gün sonu son tarih şirket saat diliminde hesaplanır (kış UTC+2, yaz UTC+3)', async () => {
    const winter = await db.createTask(owner, company, emp, { p_due_date: '2026-01-15' });
    const summer = await db.createTask(owner, company, emp, { p_due_date: '2026-07-15', p_due_time: '09:30' });
    const rows = await db.admin(
      `select id, to_char(due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as utc, due_all_day from public.tasks where id = any($1) `,
      [[winter.id, summer.id]],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[winter.id].utc).toBe('2026-01-15T21:59:59');
    expect(byId[winter.id].due_all_day).toBe(true);
    expect(byId[summer.id].utc).toBe('2026-07-15T06:30:00');
    expect(byId[summer.id].due_all_day).toBe(false);
  });

  it('gecikme son tarih ve duruma göre hesaplanır; tamamlanan gecikmede sayılmaz', async () => {
    const late = await db.createTask(owner, company, emp, { p_due_date: '2020-01-01' });
    const done = await db.createTask(owner, company, emp, { p_due_date: '2020-01-01' });
    await db.rpc(emp, 'set_task_status', { p_task: done.id, p_status: 'done' });
    const future = await db.createTask(owner, company, emp, { p_due_date: '2099-01-01' });
    const rows = await db.query(owner, 'select t.id, public.is_overdue(t) as o from public.tasks t where id = any($1)', [
      [late.id, done.id, future.id],
    ]);
    const o = Object.fromEntries(rows.map((r) => [r.id, r.o]));
    expect(o[late.id]).toBe(true);
    expect(o[done.id]).toBe(false);
    expect(o[future.id]).toBe(false);
  });

  it('ekip özeti yalnızca çağıranın görebildiği görevleri sayar', async () => {
    const all = await db.rpc(owner, 'task_summary', { p_company: company });
    const mine = await db.rpc(outsider, 'task_summary', { p_company: company });
    const total = (rows: { total: string }[]) => rows.reduce((s, r) => s + Number(r.total), 0);
    expect(total(all)).toBeGreaterThan(total(mine));
  });
});
