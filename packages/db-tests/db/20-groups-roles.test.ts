/**
 * Gruplar, kapsamlı yönetici ve grup yöneticisi yetkileri.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { TestDb, expectDenied, type TestUser } from '../src/db';

let db: TestDb;
let owner: TestUser, scopedAdmin: TestUser, fullAdmin: TestUser, e1: TestUser, e2: TestUser, e3: TestUser;
let company: string, g1: string, g2: string;

beforeAll(async () => {
  db = new TestDb(inject('dbUrl'));
  owner = await db.createUser('Sahip');
  scopedAdmin = await db.createUser('Kisitli Yonetici');
  fullAdmin = await db.createUser('Tam Yonetici');
  e1 = await db.createUser('Calisan Bir');
  e2 = await db.createUser('Calisan Iki');
  e3 = await db.createUser('Calisan Uc');
  company = await db.createCompany(owner);
  for (const u of [e1, e2, e3]) await db.invite(owner, company, u);
  // Aynı çalışan (e1) birden fazla gruba dahil
  g1 = await db.createGroup(owner, company, 'Servis', [e1, e2], [e2]);
  g2 = await db.createGroup(owner, company, 'Satış', [e1, e3]);
  await db.invite(owner, company, fullAdmin, { role: 'admin' });
  await db.invite(owner, company, scopedAdmin, { role: 'admin', adminScope: 'groups', scopeGroupIds: [g1] });
});
afterAll(() => db.close());

describe('gruplar', () => {
  it('aynı çalışan birden fazla grubun üyesi olabilir', async () => {
    const rows = await db.query(e1, 'select group_id from public.group_members where user_id = $1 order by group_id', [e1.id]);
    expect(rows.map((r) => r.group_id).sort()).toEqual([g1, g2].sort());
  });

  it('üye olmadığı grubu ve üyelerini göremez', async () => {
    expect(await db.query(e3, 'select id from public.groups where id = $1', [g1])).toEqual([]);
    expect(await db.query(e3, 'select user_id from public.group_members where group_id = $1', [g1])).toEqual([]);
    expect((await db.query(e2, 'select id from public.groups where id = $1', [g1])).length).toBe(1);
  });

  it('gruba eklenen kişiye bildirim gider', async () => {
    const n = await db.query(e1, `select type, entity_id from public.notifications where user_id = $1 and type = 'group_added'`, [e1.id]);
    expect(n.map((x) => x.entity_id).sort()).toEqual([g1, g2].sort());
  });

  it('çalışan grup oluşturamaz; sahip ve yönetici oluşturur', async () => {
    await expectDenied(db.createGroup(e1, company, 'Benim grubum', [e1]), { hint: 'forbidden' });
    const id = await db.createGroup(fullAdmin, company, 'Yönetici grubu', [e1]);
    expect(id).toBeTruthy();
  });

  it('aynı isimde ikinci grup açılamaz', async () => {
    await expectDenied(db.createGroup(owner, company, 'servis'), { hint: 'conflict' });
  });

  it('grup yöneticisi kendi grubunun üyelerini düzenleyebilir, başka grubu düzenleyemez', async () => {
    const added = await db.rpcValue<number>(e2, 'add_group_members', { p_group: g1, p_user_ids: [e3.id] });
    expect(added).toBe(1);
    await db.rpc(e2, 'remove_group_member', { p_group: g1, p_user: e3.id });
    await expectDenied(db.rpc(e2, 'add_group_members', { p_group: g2, p_user_ids: [e2.id] }), { hint: 'not_found' });
    // Grup yöneticisi olmayan üye ekleyemez
    await expectDenied(db.rpc(e1, 'add_group_members', { p_group: g1, p_user_ids: [e3.id] }), { hint: 'forbidden' });
  });

  it('üye kendini gruptan çıkarabilir (ayrılma)', async () => {
    const tmp = await db.createGroup(owner, company, 'Geçici', [e3]);
    await db.rpc(e3, 'remove_group_member', { p_group: tmp, p_user: e3.id });
    expect(await db.query(e3, 'select id from public.groups where id = $1', [tmp])).toEqual([]);
  });
});

describe('kapsamlı (gruplarla sınırlı) yönetici', () => {
  it('yalnızca kapsam grubunu görür', async () => {
    const ids = (await db.query(scopedAdmin, 'select id from public.groups where company_id = $1', [company])).map((r) => r.id);
    expect(ids).toContain(g1);
    expect(ids).not.toContain(g2);
  });

  it('kapsam grubunda grubun üyesine görev atayabilir', async () => {
    const t = await db.createTask(scopedAdmin, company, e2, { p_group: g1 });
    expect(t.assignee_id).toBe(e2.id);
  });

  it('kapsam dışı gruba, grupsuz göreve veya grup üyesi olmayana atayamaz', async () => {
    await expectDenied(db.createTask(scopedAdmin, company, e3, { p_group: g2 }), { hint: 'forbidden' });
    await expectDenied(db.createTask(scopedAdmin, company, e2), { hint: 'forbidden' });
    await expectDenied(db.createTask(scopedAdmin, company, e3, { p_group: g1 }), { hint: 'forbidden' });
  });

  it('kapsam grubundaki görevleri görür ve yönetir; diğer gruptakileri görmez', async () => {
    const inG1 = await db.createTask(owner, company, e1, { p_group: g1, p_title: 'G1 işi' });
    const inG2 = await db.createTask(owner, company, e1, { p_group: g2, p_title: 'G2 işi' });
    expect((await db.query(scopedAdmin, 'select id from public.tasks where id = $1', [inG1.id])).length).toBe(1);
    expect(await db.query(scopedAdmin, 'select id from public.tasks where id = $1', [inG2.id])).toEqual([]);
    await db.rpc(scopedAdmin, 'set_task_status', { p_task: inG1.id, p_status: 'in_progress' });
    await expectDenied(db.rpc(scopedAdmin, 'set_task_status', { p_task: inG2.id, p_status: 'done' }), { hint: 'not_found' });
  });

  it('şirket geneli işlemleri yapamaz (davet, grup açma, modül, rol)', async () => {
    await expectDenied(
      db.rpc(scopedAdmin, 'create_invitation', { p_company: company, p_email: 'x@example.com', p_role: 'employee' }),
      { hint: 'forbidden' },
    );
    await expectDenied(db.createGroup(scopedAdmin, company, 'Yeni'), { hint: 'forbidden' });
    await expectDenied(db.rpc(scopedAdmin, 'set_module_enabled', { p_company: company, p_module: 'tasks', p_enabled: false }), {
      hint: 'forbidden',
    });
    await expectDenied(db.rpc(scopedAdmin, 'remove_member', { p_company: company, p_user: e3.id }), { hint: 'forbidden' });
  });

  it('kapsam grubunu yönetebilir (üye ekleyebilir)', async () => {
    expect(await db.rpcValue<number>(scopedAdmin, 'add_group_members', { p_group: g1, p_user_ids: [e3.id] })).toBe(1);
    await db.rpc(scopedAdmin, 'remove_group_member', { p_group: g1, p_user: e3.id });
  });
});

describe('roller', () => {
  it('rolü yalnızca sahip değiştirir; yönetici değiştiremez', async () => {
    await expectDenied(db.rpc(fullAdmin, 'change_member_role', { p_company: company, p_user: e3.id, p_role: 'admin' }), {
      hint: 'forbidden',
    });
    // e3, g1'in üyesi değil; g1 kapsamlı yönetici yapılınca g1'i görmeye başlar
    expect(await db.query(e3, 'select id from public.groups where id = $1', [g1])).toEqual([]);
    await db.rpc(owner, 'change_member_role', { p_company: company, p_user: e3.id, p_role: 'admin', p_admin_scope: 'groups', p_scope_group_ids: [g1] });
    expect((await db.query(e3, 'select id from public.groups where id = $1', [g1])).length).toBe(1);
    await db.rpc(owner, 'change_member_role', { p_company: company, p_user: e3.id, p_role: 'employee' });
    expect(await db.query(e3, 'select * from public.member_scope_groups where user_id = $1', [e3.id])).toEqual([]);
  });

  it('sahip çıkarılamaz, rolü değiştirilemez; yönetici başka yöneticiyi çıkaramaz', async () => {
    await expectDenied(db.rpc(fullAdmin, 'remove_member', { p_company: company, p_user: owner.id }), { hint: 'forbidden' });
    await expectDenied(db.rpc(fullAdmin, 'remove_member', { p_company: company, p_user: scopedAdmin.id }), { hint: 'forbidden' });
    await expectDenied(db.rpc(owner, 'change_member_role', { p_company: company, p_user: owner.id, p_role: 'employee' }), {
      hint: 'invalid',
    });
  });

  it('çalışan, yöneticiyi ilgilendiren işlemleri yapamaz', async () => {
    await expectDenied(db.rpc(e1, 'remove_member', { p_company: company, p_user: e2.id }), { hint: 'forbidden' });
    await expectDenied(db.rpc(e1, 'create_invitation', { p_company: company, p_email: 'y@example.com', p_role: 'employee' }), {
      hint: 'forbidden',
    });
    expect(await db.query(e1, 'select id from public.invitations where company_id = $1', [company])).toEqual([]);
    expect(await db.query(e1, 'select id from public.audit_log where company_id = $1', [company])).toEqual([]);
  });

  it('yönetimsel işlemler işlem geçmişine yazılır ve sahip görür', async () => {
    const actions = (await db.query(owner, 'select action from public.audit_log where company_id = $1', [company])).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['company.created', 'member.invited', 'member.joined', 'group.created', 'member.role_changed']));
  });
});
