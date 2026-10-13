/**
 * Push: cihaz kaydı yalnızca sahibine görünür; kuyruk yalnızca doğrulanmış bildirimlerden ve bir kez dolar;
 * gönderici fonksiyonları istemciye kapalıdır; gönderim anında erişim yeniden doğrulanır.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { TestDb, expectDenied, newId, type TestUser } from '../src/db';

let db: TestDb;
let owner: TestUser, emp: TestUser, emp2: TestUser;
let company: string;
const token = (s: string) => `ExponentPushToken[${s.padEnd(12, 'x')}]`;

/** Sunucudaki gönderici gibi service_role ile çalıştırır */
async function asService<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await db.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role service_role');
    const r = await c.query(sql, params);
    await c.query('commit');
    return r.rows as T[];
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

const outboxFor = (u: TestUser) => db.admin('select * from public.push_outbox where user_id = $1 order by id', [u.id]);

beforeAll(async () => {
  db = new TestDb(inject('dbUrl'));
  owner = await db.createUser('Push Sahip');
  emp = await db.createUser('Push Calisan');
  emp2 = await db.createUser('Push Calisan Iki');
  company = await db.createCompany(owner, 'Push Şirketi');
  await db.invite(owner, company, emp);
  await db.invite(owner, company, emp2);
});
afterAll(() => db.close());

describe('cihaz kaydı', () => {
  it('geçerli token kaydedilir; geçersiz reddedilir; kişi yalnızca kendi cihazını görür', async () => {
    await db.rpc(emp, 'register_push_device', { p_token: token('calisancihaz'), p_platform: 'ios', p_device_name: 'iPhone' });
    await expectDenied(db.rpc(emp, 'register_push_device', { p_token: 'rastgele-metin', p_platform: 'ios' }), { hint: 'invalid' });
    expect((await db.query(emp, 'select expo_token from public.push_devices')).length).toBe(1);
    expect(await db.query(owner, 'select expo_token from public.push_devices where user_id = $1', [emp.id])).toEqual([]);
    // İstemci doğrudan yazamaz
    await expectDenied(
      db.query(emp, `insert into public.push_devices (user_id, expo_token, platform) values ($1, $2, 'ios')`, [emp.id, token('dogrudan')]),
      { code: '42501' },
    );
  });

  it('aynı cihazda başka kullanıcı oturum açınca token ona geçer (eski kullanıcıya push gitmez)', async () => {
    await db.rpc(emp2, 'register_push_device', { p_token: token('ortakcihaz'), p_platform: 'android' });
    await db.rpc(owner, 'register_push_device', { p_token: token('ortakcihaz'), p_platform: 'android' });
    const rows = await db.admin<{ user_id: string }>('select user_id from public.push_devices where expo_token = $1', [token('ortakcihaz')]);
    expect(rows).toEqual([{ user_id: owner.id }]);
    await db.rpc(owner, 'unregister_push_device', { p_token: token('ortakcihaz') });
  });
});

describe('push kuyruğu', () => {
  it('doğrulanmış bildirim kuyruğa bir kez girer; tekrar denemede çoğalmaz; cihazı olmayana girmez', async () => {
    const crid = newId();
    const args = { p_company: company, p_title: 'Push görevi', p_assignee: emp.id, p_client_request_id: crid };
    await db.rpc(owner, 'create_task', args);
    await db.rpc(owner, 'create_task', args); // tekrar deneme
    expect(await outboxFor(emp)).toHaveLength(1);
    await db.createTask(owner, company, emp2); // emp2'nin etkin cihazı yok (token sahibe geçti)
    expect(await outboxFor(emp2)).toEqual([]);
  });

  it('istemci kuyruğu göremez ve gönderici fonksiyonlarını çağıramaz', async () => {
    expect(await db.query(emp, 'select * from public.push_outbox')).toEqual([]);
    await expectDenied(db.query(emp, 'select * from public.push_claim_batch(10)'), { code: '42501' });
    await expectDenied(db.query(emp, `select public.push_complete(1, 'sent')`), { code: '42501' });
  });

  it('gönderici (service_role) kaydı alır, sonucu işler; geçersiz token devre dışı kalır', async () => {
    const jobs = await asService<{ outbox_id: number; type: string; tokens: string[]; entity_type: string }>('select * from public.push_claim_batch(50)');
    const mine = jobs.filter((j) => j.tokens.includes(token('calisancihaz')));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ type: 'task_assigned', entity_type: 'task' });
    // Aynı kayıt ikinci kez alınmaz (sending)
    const again = await asService('select * from public.push_claim_batch(50)');
    expect(again.filter((j: any) => j.outbox_id === mine[0]!.outbox_id)).toEqual([]);

    await asService(`select public.push_complete($1, 'sent', null, '[]'::jsonb, $2)`, [mine[0]!.outbox_id, [token('calisancihaz')]]);
    const ob = await db.admin<{ status: string; sent_at: string | null }>('select status, sent_at from public.push_outbox where id = $1', [mine[0]!.outbox_id]);
    expect(ob[0]).toMatchObject({ status: 'sent' });
    const dev = await db.admin<{ disabled_at: string | null }>('select disabled_at from public.push_devices where expo_token = $1', [token('calisancihaz')]);
    expect(dev[0]?.disabled_at).not.toBeNull();
  });

  it('gönderim anında erişim yeniden doğrulanır: şirketten çıkarılan kişiye push gitmez', async () => {
    const leaver = await db.createUser('Push Ayrilan');
    await db.invite(owner, company, leaver);
    await db.rpc(leaver, 'register_push_device', { p_token: token('ayrilancihaz'), p_platform: 'ios' });
    await db.createTask(owner, company, leaver, { p_title: 'Ayrılmadan önce' });
    expect(await outboxFor(leaver)).toHaveLength(1);
    await db.rpc(owner, 'remove_member', { p_company: company, p_user: leaver.id });
    const jobs = await asService<{ tokens: string[] }>('select * from public.push_claim_batch(50)');
    expect(jobs.some((j) => j.tokens.includes(token('ayrilancihaz')))).toBe(false);
    const ob = await outboxFor(leaver);
    expect(ob[0]).toMatchObject({ status: 'skipped' });
  });

  it('çıkış yapan cihaza yeni push kuyruğa girmez', async () => {
    await db.rpc(emp2, 'register_push_device', { p_token: token('emp2cihaz'), p_platform: 'ios' });
    await db.rpc(emp2, 'unregister_push_device', { p_token: token('emp2cihaz') });
    const before = (await outboxFor(emp2)).length;
    await db.createTask(owner, company, emp2, { p_title: 'Çıkıştan sonra' });
    expect((await outboxFor(emp2)).length).toBe(before);
  });
});
