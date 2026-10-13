/**
 * Görev onayı modülü: tamamlandı ≠ onaylandı, onaylayıcı yetkisi, düzeltme döngüsü,
 * tekrar/eşzamanlı karar, modül kapalıyken davranış, onaylayıcı ayrılınca devralma.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { TestDb, expectDenied, type TestUser } from '../src/db';

let db: TestDb;
let owner: TestUser, admin: TestUser, lead: TestUser, emp: TestUser, emp2: TestUser, other: TestUser;
let company: string, group: string, otherCompany: string;

type Row = {
  id: string;
  status: string;
  approval_status: string | null;
  approval_note: string | null;
  completed_at: string | null;
  approval_requested_at: string | null;
  approval_decided_by: string | null;
};

const task = (id: string) => db.admin<Row>('select * from public.tasks where id = $1', [id]).then((r) => r[0]!);
const notifs = (u: TestUser, taskId: string, type: string) =>
  db.query(u, 'select id, body from public.notifications where entity_id = $1 and type = $2', [taskId, type]);

async function approvalTask(extra: Record<string, unknown> = {}) {
  return db.createTask(owner, company, emp, { p_title: 'Onaylı iş', p_requires_approval: true, p_approver: owner.id, ...extra });
}

beforeAll(async () => {
  db = new TestDb(inject('dbUrl'));
  owner = await db.createUser('Onay Sahip');
  admin = await db.createUser('Onay Yonetici');
  lead = await db.createUser('Grup Lideri');
  emp = await db.createUser('Sorumlu Calisan');
  emp2 = await db.createUser('Diger Calisan');
  other = await db.createUser('Baska Sirket');
  company = await db.createCompany(owner, 'Onay Şirketi');
  await db.invite(owner, company, admin, { role: 'admin' });
  for (const u of [lead, emp, emp2]) await db.invite(owner, company, u);
  group = await db.createGroup(owner, company, 'Bakım', [emp, emp2], [lead]);
  otherCompany = await db.createCompany(other, 'Başka');
});
afterAll(() => db.close());

describe('onay akışı', () => {
  it('tamamlanınca "Onay bekliyor" olur; iş tamamlanmış ama onaylanmamıştır; onaylayıcıya bildirim gider', async () => {
    const t = await approvalTask();
    await db.rpc(emp, 'set_task_status', { p_task: t.id, p_status: 'done' });
    const r = await task(t.id);
    expect(r).toMatchObject({ status: 'done', approval_status: 'pending' });
    expect(r.completed_at).not.toBeNull();
    expect(r.approval_requested_at).not.toBeNull();
    expect(await notifs(owner, t.id, 'task_approval_requested')).toHaveLength(1);
  });

  it('sorumlu kendi görevini, yetkisiz çalışan başkasının görevini onaylayamaz', async () => {
    const t = await approvalTask({ p_group: group });
    await db.rpc(emp, 'set_task_status', { p_task: t.id, p_status: 'done' });
    await expectDenied(db.rpc(emp, 'approve_task', { p_task: t.id }), { hint: 'forbidden' });
    await expectDenied(db.rpc(emp2, 'approve_task', { p_task: t.id }), { hint: 'forbidden' });
    await expectDenied(db.rpc(emp2, 'request_task_changes', { p_task: t.id, p_note: 'olmamış' }), { hint: 'forbidden' });
    // Başka şirket görevi göremez
    await expectDenied(db.rpc(other, 'approve_task', { p_task: t.id }), { hint: 'not_found' });
  });

  it('onaylayınca "Onaylandı"; tekrar ve eşzamanlı onay tek karar ve tek bildirim üretir', async () => {
    const t = await approvalTask();
    await db.rpc(emp, 'set_task_status', { p_task: t.id, p_status: 'done' });
    await Promise.all([1, 2, 3].map(() => db.rpc(owner, 'approve_task', { p_task: t.id })));
    await db.rpc(owner, 'approve_task', { p_task: t.id });
    const r = await task(t.id);
    expect(r).toMatchObject({ status: 'done', approval_status: 'approved', approval_decided_by: owner.id });
    const events = await db.admin(`select id from public.task_events where task_id = $1 and type = 'approved'`, [t.id]);
    expect(events).toHaveLength(1);
    expect(await notifs(emp, t.id, 'task_approved')).toHaveLength(1);
  });

  it('düzeltme istemek not ister; görev "Devam ediyor"a döner, not sorumluya gider; yeniden tamamlanınca tekrar onaya düşer', async () => {
    const t = await approvalTask();
    await db.rpc(emp, 'set_task_status', { p_task: t.id, p_status: 'done' });
    await expectDenied(db.rpc(owner, 'request_task_changes', { p_task: t.id, p_note: ' ' }), { hint: 'invalid' });

    await db.rpc(owner, 'request_task_changes', { p_task: t.id, p_note: 'Fotoğraflar eksik, seri numarası okunmuyor.' });
    let r = await task(t.id);
    expect(r).toMatchObject({ status: 'in_progress', approval_status: 'changes_requested', approval_note: 'Fotoğraflar eksik, seri numarası okunmuyor.' });
    expect(r.completed_at).toBeNull();
    const n = await notifs(emp, t.id, 'task_changes_requested');
    expect(n).toHaveLength(1);
    expect(n[0].body).toContain('Fotoğraflar eksik');

    // Onay beklemeyen görev onaylanamaz
    await expectDenied(db.rpc(owner, 'approve_task', { p_task: t.id }), { hint: 'invalid' });

    await db.rpc(emp, 'set_task_status', { p_task: t.id, p_status: 'done' });
    r = await task(t.id);
    expect(r).toMatchObject({ status: 'done', approval_status: 'pending', approval_note: null });
    expect(await notifs(owner, t.id, 'task_approval_requested')).toHaveLength(2); // her onay isteği ayrı olay
    await db.rpc(owner, 'approve_task', { p_task: t.id });
    expect((await task(t.id)).approval_status).toBe('approved');
  });

  it('onaylanmış görev yeniden açılırsa onay geçersizleşir; tekrar tamamlanınca yeniden onay istenir', async () => {
    const t = await approvalTask();
    await db.rpc(emp, 'set_task_status', { p_task: t.id, p_status: 'done' });
    await db.rpc(owner, 'approve_task', { p_task: t.id });
    await db.rpc(owner, 'set_task_status', { p_task: t.id, p_status: 'in_progress' });
    expect((await task(t.id)).approval_status).toBeNull();
    await db.rpc(emp, 'set_task_status', { p_task: t.id, p_status: 'done' });
    expect((await task(t.id)).approval_status).toBe('pending');
  });

  it('onay gerektirmeyen görevde onay alanları boş kalır', async () => {
    const t = await db.createTask(owner, company, emp, { p_title: 'Onaysız iş' });
    await db.rpc(emp, 'set_task_status', { p_task: t.id, p_status: 'done' });
    expect((await task(t.id)).approval_status).toBeNull();
    await expectDenied(db.rpc(owner, 'approve_task', { p_task: t.id }), { hint: 'forbidden' });
  });
});

describe('onaylayıcı seçimi', () => {
  it('sorumlu kendi onaylayıcısı olamaz; tasks.approve izni olmayan veya başka şirketten kişi seçilemez', async () => {
    await expectDenied(approvalTask({ p_approver: emp.id }), { hint: 'invalid' });
    await expectDenied(approvalTask({ p_approver: emp2.id }), { hint: 'invalid' });
    await expectDenied(approvalTask({ p_approver: other.id }), { hint: 'invalid' });
    await expectDenied(approvalTask({ p_approver: null }), { hint: 'invalid' });
  });

  it('grup lideri kendi grubunun görevini onaylayabilir; grup dışı görevde onaylayıcı olamaz', async () => {
    const t = await approvalTask({ p_group: group, p_approver: lead.id });
    await db.rpc(emp, 'set_task_status', { p_task: t.id, p_status: 'done' });
    await db.rpc(lead, 'approve_task', { p_task: t.id });
    expect((await task(t.id)).approval_status).toBe('approved');
    await expectDenied(approvalTask({ p_approver: lead.id }), { hint: 'invalid' });
  });

  it('çalışan kendine açtığı göreve yöneticisini onaylayıcı seçebilir', async () => {
    const t = await db.createTask(emp, company, emp, { p_title: 'Kendi işim', p_requires_approval: true, p_approver: admin.id });
    await db.rpc(emp, 'set_task_status', { p_task: t.id, p_status: 'done' });
    expect(await notifs(admin, t.id, 'task_approval_requested')).toHaveLength(1);
    await db.rpc(admin, 'approve_task', { p_task: t.id });
  });

  it('sonradan onay gerekli yapılabilir; tamamlanmış görev hemen onaya düşer', async () => {
    const t = await db.createTask(owner, company, emp, { p_title: 'Sonradan onay' });
    await db.rpc(emp, 'set_task_status', { p_task: t.id, p_status: 'done' });
    await expectDenied(db.rpc(emp, 'set_task_approval', { p_task: t.id, p_requires_approval: true, p_approver: owner.id }), { hint: 'forbidden' });
    await db.rpc(owner, 'set_task_approval', { p_task: t.id, p_requires_approval: true, p_approver: admin.id });
    expect((await task(t.id)).approval_status).toBe('pending');
    expect(await notifs(admin, t.id, 'task_approval_requested')).toHaveLength(1);
    await db.rpc(owner, 'set_task_approval', { p_task: t.id, p_requires_approval: false });
    expect((await task(t.id)).approval_status).toBeNull();
  });

  it('onaylayıcı şirketten ayrılırsa kapsamında onay ve görev yönetim izni olan karar verebilir', async () => {
    const leaver = await db.createUser('Ayrilan Yonetici');
    await db.invite(owner, company, leaver, { role: 'admin' });
    const t = await approvalTask({ p_approver: leaver.id });
    await db.rpc(emp, 'set_task_status', { p_task: t.id, p_status: 'done' });
    await expectDenied(db.rpc(admin, 'approve_task', { p_task: t.id }), { hint: 'forbidden' });
    await db.rpc(owner, 'remove_member', { p_company: company, p_user: leaver.id });
    await expectDenied(db.rpc(leaver, 'approve_task', { p_task: t.id }), { hint: 'not_found' });
    await db.rpc(admin, 'approve_task', { p_task: t.id });
    expect((await task(t.id)).approval_status).toBe('approved');
  });
});

describe('Görev onayı modülü kapalıyken', () => {
  it('karar ve yeni onaylı görev engellenir, bildirim üretilmez, veri kalır; açılınca bekleyen onay görünür', async () => {
    const t = await approvalTask();
    await db.rpc(owner, 'set_module_enabled', { p_company: company, p_module: 'task_approval', p_enabled: false });
    try {
      await expectDenied(approvalTask(), { hint: 'module_disabled' });
      await db.rpc(emp, 'set_task_status', { p_task: t.id, p_status: 'done' });
      expect((await task(t.id)).approval_status).toBe('pending'); // veri tutulur
      expect(await notifs(owner, t.id, 'task_approval_requested')).toEqual([]); // bildirim yok
      await expectDenied(db.rpc(owner, 'approve_task', { p_task: t.id }), { hint: 'module_disabled' });
      await expectDenied(db.rpc(owner, 'set_task_approval', { p_task: t.id, p_requires_approval: false }), { hint: 'module_disabled' });
      // Görevler modülü normal çalışmaya devam eder
      await db.createTask(owner, company, emp, { p_title: 'Onay modülü kapalıyken sıradan görev' });
    } finally {
      await db.rpc(owner, 'set_module_enabled', { p_company: company, p_module: 'task_approval', p_enabled: true });
    }
    const waiting = await db.query(owner, `select id from public.tasks where approver_id = $1 and approval_status = 'pending' and id = $2`, [owner.id, t.id]);
    expect(waiting).toHaveLength(1);
    await db.rpc(owner, 'approve_task', { p_task: t.id });
  });
});
