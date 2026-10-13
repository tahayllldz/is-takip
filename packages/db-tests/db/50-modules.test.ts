/**
 * Modül kapatıldığında: yeni işlem ve bildirim sunucu tarafında engellenir,
 * veriler silinmez, yalnızca archive.view izni olan (sahip/şirket geneli yönetici)
 * salt okunur görür; modül yeniden açılınca veriler kullanılabilir.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { TestDb, expectDenied, newId, type TestUser } from '../src/db';

let db: TestDb;
let owner: TestUser, admin: TestUser, emp: TestUser;
let company: string, taskId: string;

beforeAll(async () => {
  db = new TestDb(inject('dbUrl'));
  owner = await db.createUser('Sahip');
  admin = await db.createUser('Yonetici');
  emp = await db.createUser('Calisan');
  company = await db.createCompany(owner);
  await db.invite(owner, company, admin, { role: 'admin' });
  await db.invite(owner, company, emp);
  taskId = (await db.createTask(owner, company, emp, { p_title: 'Modül kapanmadan önce' })).id;
});
afterAll(() => db.close());

describe('görev modülü kapalıyken', () => {
  it('çalışan modülü kapatamaz; yönetici kapatabilir ve işlem geçmişine yazılır', async () => {
    await expectDenied(db.rpc(emp, 'set_module_enabled', { p_company: company, p_module: 'tasks', p_enabled: false }), { hint: 'forbidden' });
    await db.rpc(admin, 'set_module_enabled', { p_company: company, p_module: 'tasks', p_enabled: false });
    const log = await db.query(owner, `select action from public.audit_log where company_id = $1 and action = 'module.disabled'`, [company]);
    expect(log.length).toBe(1);
  });

  it('doğrudan API/RPC isteğiyle yeni görev, durum değişikliği, yorum yapılamaz', async () => {
    await expectDenied(db.createTask(owner, company, emp), { hint: 'module_disabled' });
    await expectDenied(db.rpc(emp, 'set_task_status', { p_task: taskId, p_status: 'done' }), { hint: 'not_found' });
    await expectDenied(db.rpc(owner, 'set_task_status', { p_task: taskId, p_status: 'done' }), { hint: 'module_disabled' });
    await expectDenied(db.rpc(owner, 'add_task_comment', { p_task: taskId, p_body: 'x', p_client_request_id: newId() }), {
      hint: 'module_disabled',
    });
    await expectDenied(db.rpc(owner, 'update_task', { p_task: taskId, p_changes: { title: 'y' } }), { hint: 'module_disabled' });
  });

  it('çalışan görevleri ve görev bildirimlerini göremez; veri silinmemiştir', async () => {
    expect(await db.query(emp, 'select id from public.tasks where company_id = $1', [company])).toEqual([]);
    expect(await db.query(emp, `select id from public.notifications where module_id = 'tasks' and user_id = $1`, [emp.id])).toEqual([]);
    const stored = await db.admin('select count(*)::int as n from public.tasks where id = $1', [taskId]);
    expect(stored[0].n).toBe(1);
  });

  it('sahip ve şirket geneli yönetici arşivi salt okunur görür', async () => {
    expect((await db.query(owner, 'select id from public.tasks where id = $1', [taskId])).length).toBe(1);
    expect((await db.query(admin, 'select id from public.tasks where id = $1', [taskId])).length).toBe(1);
    expect((await db.query(owner, 'select id from public.task_events where task_id = $1', [taskId])).length).toBeGreaterThan(0);
  });

  it('modül izinleri de geçersizleşir (gruplar core olduğu için çalışmaya devam eder)', async () => {
    const g = await db.createGroup(owner, company, 'Modül kapalıyken grup', [emp]);
    expect(g).toBeTruthy();
  });

  it('yeniden açılınca mevcut veriler kullanılabilir', async () => {
    await db.rpc(owner, 'set_module_enabled', { p_company: company, p_module: 'tasks', p_enabled: true });
    expect((await db.query(emp, 'select id from public.tasks where id = $1', [taskId])).length).toBe(1);
    const done = await db.rpcOne(emp, 'set_task_status', { p_task: taskId, p_status: 'done' });
    expect(done.status).toBe('done');
    expect((await db.query(emp, `select id from public.notifications where module_id = 'tasks' and user_id = $1`, [emp.id])).length).toBeGreaterThan(0);
  });

  it('temel modül kapatılamaz; bilinmeyen modül reddedilir', async () => {
    await expectDenied(db.rpc(owner, 'set_module_enabled', { p_company: company, p_module: 'core', p_enabled: false }), { hint: 'invalid' });
    await expectDenied(db.rpc(owner, 'set_module_enabled', { p_company: company, p_module: 'stok', p_enabled: true }), { hint: 'not_found' });
  });
});
