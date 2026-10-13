/**
 * Çok şirketli veri ayrımı: iki ayrı şirket birbirinin verisine erişemez ve
 * şirketler arası kullanıcı/grup/görev referansı oluşturulamaz.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { TestDb, expectDenied, newId, type TestUser } from '../src/db';

let db: TestDb;
let ownerA: TestUser, empA: TestUser, ownerB: TestUser, empB: TestUser;
let companyA: string, companyB: string, groupA: string, taskA: string;

beforeAll(async () => {
  db = new TestDb(inject('dbUrl'));
  ownerA = await db.createUser('Sahip A');
  empA = await db.createUser('Calisan A');
  ownerB = await db.createUser('Sahip B');
  empB = await db.createUser('Calisan B');
  companyA = await db.createCompany(ownerA, 'A Şirketi');
  companyB = await db.createCompany(ownerB, 'B Şirketi');
  await db.invite(ownerA, companyA, empA);
  await db.invite(ownerB, companyB, empB);
  groupA = await db.createGroup(ownerA, companyA, 'Depo', [empA]);
  taskA = (await db.createTask(ownerA, companyA, empA, { p_group: groupA, p_title: 'Gizli A görevi' })).id;
});
afterAll(() => db.close());

describe('iki şirket birbirinin verisini göremez', () => {
  it('B şirketinin kullanıcıları A şirketini, üyelerini, gruplarını, görevlerini görmez', async () => {
    for (const u of [ownerB, empB]) {
      expect(await db.query(u, 'select id from public.companies where id = $1', [companyA])).toEqual([]);
      expect(await db.query(u, 'select user_id from public.company_members where company_id = $1', [companyA])).toEqual([]);
      expect(await db.query(u, 'select id from public.groups where company_id = $1', [companyA])).toEqual([]);
      expect(await db.query(u, 'select id from public.tasks where company_id = $1', [companyA])).toEqual([]);
      expect(await db.query(u, 'select id from public.task_events where company_id = $1', [companyA])).toEqual([]);
      expect(await db.query(u, 'select * from public.company_modules where company_id = $1', [companyA])).toEqual([]);
      expect(await db.query(u, 'select id from public.profiles where id = $1', [empA.id])).toEqual([]);
    }
  });

  it('A şirketi çalışanının bildirimlerini B göremez', async () => {
    const own = await db.query(empA, 'select id from public.notifications where user_id = $1', [empA.id]);
    expect(own.length).toBeGreaterThan(0);
    expect(await db.query(ownerB, 'select id from public.notifications where user_id = $1', [empA.id])).toEqual([]);
  });

  it('B, A şirketinde görev oluşturamaz, görevi değiştiremez, yorum yazamaz', async () => {
    await expectDenied(db.createTask(ownerB, companyA, ownerB), { hint: 'forbidden' });
    await expectDenied(db.rpc(ownerB, 'set_task_status', { p_task: taskA, p_status: 'done' }), { hint: 'not_found' });
    await expectDenied(
      db.rpc(ownerB, 'add_task_comment', { p_task: taskA, p_body: 'merhaba', p_client_request_id: newId() }),
      { hint: 'not_found' },
    );
    await expectDenied(db.rpc(ownerB, 'update_task', { p_task: taskA, p_changes: { title: 'x' } }), { hint: 'not_found' });
  });

  it('şirketler arası referans oluşturulamaz (kullanıcı, grup)', async () => {
    // B kendi şirketindeki göreve A'nın çalışanını atayamaz
    await expectDenied(db.createTask(ownerB, companyB, empA), { hint: 'invalid' });
    // B kendi görevine A'nın grubunu bağlayamaz
    await expectDenied(db.createTask(ownerB, companyB, empB, { p_group: groupA }), { hint: 'invalid' });
    // B kendi grubuna A'nın çalışanını ekleyemez
    await expectDenied(db.createGroup(ownerB, companyB, 'Karışık', [empA]), { hint: 'invalid' });
    // A'nın grubunu yönetemez
    await expectDenied(db.rpc(ownerB, 'add_group_members', { p_group: groupA, p_user_ids: [empB.id] }), { hint: 'not_found' });
    // Davetle A'nın grubuna kişi sokamaz
    await expectDenied(
      db.rpc(ownerB, 'create_invitation', { p_company: companyB, p_email: 'yeni@example.com', p_role: 'employee', p_group_ids: [groupA] }),
      { hint: 'invalid' },
    );
  });

  it('veritabanı kısıtı: doğrudan (süper kullanıcı) eklemede bile şirketler arası FK reddedilir', async () => {
    await expectDenied(
      db.admin(
        `insert into public.tasks (company_id, title, assignee_id, created_by, client_request_id) values ($1, 'x', $2, $3, gen_random_uuid())`,
        [companyB, empA.id, ownerB.id],
      ),
      { code: '23503' },
    );
    await expectDenied(
      db.admin(`insert into public.group_members (company_id, group_id, user_id) values ($1, $2, $3)`, [companyB, groupA, empB.id]),
      { code: '23503' },
    );
  });

  it('istemci tablolara doğrudan yazamaz (RLS + yetki)', async () => {
    await expectDenied(db.query(ownerA, `update public.tasks set status = 'done' where id = $1`, [taskA]), { code: '42501' });
    await expectDenied(
      db.query(ownerA, `insert into public.company_members (company_id, user_id, role) values ($1, $2, 'admin')`, [companyA, ownerB.id]),
      { code: '42501' },
    );
    await expectDenied(db.query(empA, `update public.company_members set role = 'owner' where user_id = $1`, [empA.id]), { code: '42501' });
    await expectDenied(db.query(empA, `delete from public.notifications`), { code: '42501' });
  });

  it('oturumsuz (anon) istek hiçbir tabloyu okuyamaz', async () => {
    await expectDenied(db.query(null, 'select * from public.tasks'), { code: '42501' });
    await expectDenied(db.query(null, 'select * from public.companies'), { code: '42501' });
    await expectDenied(db.rpc(null, 'create_company', { p_name: 'Hacker' }), { code: '42501' });
  });
});
