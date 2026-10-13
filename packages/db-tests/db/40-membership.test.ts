/**
 * Üyelik kaldırıldığında erişim kesilir; davet akışı güvenlidir.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { TestDb, expectDenied, newId, type TestUser } from '../src/db';

let db: TestDb;
let owner: TestUser, emp: TestUser, emp2: TestUser;
let company: string, group: string;

beforeAll(async () => {
  db = new TestDb(inject('dbUrl'));
  owner = await db.createUser('Sahip');
  emp = await db.createUser('Ayrilacak Calisan');
  emp2 = await db.createUser('Kalan Calisan');
  company = await db.createCompany(owner);
  await db.invite(owner, company, emp);
  await db.invite(owner, company, emp2);
  group = await db.createGroup(owner, company, 'Ekip', [emp, emp2]);
});
afterAll(() => db.close());

describe('gruptan çıkarma', () => {
  it('grup görevlerine erişim kalkar; kendisine atanmış görev kalır', async () => {
    const groupTask = await db.createTask(owner, company, emp2, { p_group: group, p_title: 'Grup işi' });
    const ownTask = await db.createTask(owner, company, emp, { p_group: group, p_title: 'Kendi işi' });
    const g2 = await db.createGroup(owner, company, 'Geçici grup', [emp]);
    expect((await db.query(emp, 'select id from public.tasks where id = $1', [groupTask.id])).length).toBe(1);

    await db.rpc(owner, 'remove_group_member', { p_group: group, p_user: emp.id });
    await db.rpc(owner, 'remove_group_member', { p_group: g2, p_user: emp.id });

    expect(await db.query(emp, 'select id from public.tasks where id = $1', [groupTask.id])).toEqual([]);
    expect((await db.query(emp, 'select id from public.tasks where id = $1', [ownTask.id])).length).toBe(1);
    expect(await db.query(emp, 'select id from public.groups where id = $1', [group])).toEqual([]);
    // Gruba eklenme bildirimi de artık okunamaz (gruba erişimi yok)
    expect(await db.query(emp, `select id from public.notifications where entity_id = $1`, [g2])).toEqual([]);
    await db.rpc(owner, 'add_group_members', { p_group: group, p_user_ids: [emp.id] });
  });
});

describe('şirketten çıkarma', () => {
  it('çıkarılan kişi hiçbir veriyi göremez ve işlem yapamaz', async () => {
    const t = await db.createTask(owner, company, emp, { p_title: 'Çıkarılmadan önceki görev' });
    expect((await db.query(emp, 'select id from public.tasks where id = $1', [t.id])).length).toBe(1);
    expect((await db.query(emp, 'select id from public.notifications where user_id = $1', [emp.id])).length).toBeGreaterThan(0);

    await db.rpc(owner, 'remove_member', { p_company: company, p_user: emp.id });

    expect(await db.query(emp, 'select id from public.companies where id = $1', [company])).toEqual([]);
    expect(await db.query(emp, 'select id from public.tasks where company_id = $1', [company])).toEqual([]);
    expect(await db.query(emp, 'select id from public.groups where company_id = $1', [company])).toEqual([]);
    expect(await db.query(emp, 'select user_id from public.company_members where company_id = $1', [company])).toEqual([]);
    expect(await db.query(emp, 'select id from public.notifications where user_id = $1', [emp.id])).toEqual([]);
    await expectDenied(db.rpc(emp, 'set_task_status', { p_task: t.id, p_status: 'done' }), { hint: 'not_found' });
    await expectDenied(db.createTask(emp, company, emp), { hint: 'forbidden' });
    await expectDenied(
      db.rpc(emp, 'add_task_comment', { p_task: t.id, p_body: 'hâlâ buradayım', p_client_request_id: newId() }),
      { hint: 'not_found' },
    );
    // grup üyeliği de silinmiştir
    expect((await db.admin('select count(*)::int as n from public.group_members where user_id = $1', [emp.id]))[0].n).toBe(0);
  });

  it('çıkarılan kişiye yeni bildirim üretilmez ve yeni görev atanamaz', async () => {
    await expectDenied(db.createTask(owner, company, emp), { hint: 'invalid' });
    const before = (await db.admin('select count(*)::int as n from public.notifications where user_id = $1', [emp.id]))[0].n;
    const t = await db.createTask(owner, company, emp2, { p_group: group });
    await db.rpc(owner, 'add_task_comment', { p_task: t.id, p_body: 'not', p_client_request_id: newId() });
    const after = (await db.admin('select count(*)::int as n from public.notifications where user_id = $1', [emp.id]))[0].n;
    expect(after).toBe(before);
  });

  it('kalan çalışanlar çıkarılan kişinin adını geçmiş kayıtlarda görebilir', async () => {
    const rows = await db.query(emp2, 'select id, full_name from public.profiles where id = $1', [emp.id]);
    expect(rows.length).toBe(1);
  });
});

describe('davetler', () => {
  it('davet bağlantısı yalnızca davet edilen e-postayla, bir kez ve süresi içinde kullanılabilir', async () => {
    const invited = await db.createUser('Davetli');
    const stranger = await db.createUser('Yabanci');
    const inv = await db.rpcOne(owner, 'create_invitation', { p_company: company, p_email: invited.email, p_role: 'employee', p_group_ids: [group] });
    expect(inv.token).toMatch(/^[0-9a-f]{64}$/);

    const preview = await db.rpcOne(null, 'get_invitation', { p_token: inv.token });
    expect(preview.status).toBe('pending');
    expect(preview.email).toBe(invited.email);
    expect(await db.rpc(null, 'get_invitation', { p_token: 'yanlis-token' })).toEqual([]);

    await expectDenied(db.rpc(stranger, 'accept_invitation', { p_token: inv.token }), { hint: 'forbidden' });
    const companyId = await db.rpcValue(invited, 'accept_invitation', { p_token: inv.token });
    expect(companyId).toBe(company);
    // tekrar deneme aynı sonucu verir
    expect(await db.rpcValue(invited, 'accept_invitation', { p_token: inv.token })).toBe(company);
    // davet gruba da ekler
    expect((await db.query(invited, 'select id from public.groups where id = $1', [group])).length).toBe(1);
    // token veritabanında açık metin tutulmaz
    const stored = await db.admin('select token_hash from public.invitations where id = $1', [inv.invitation_id]);
    expect(stored[0].token_hash).not.toBe(inv.token);
  });

  it('süresi dolmuş veya iptal edilmiş davet kullanılamaz', async () => {
    const u1 = await db.createUser('Gec Kalan');
    const u2 = await db.createUser('Iptal Edilen');
    const i1 = await db.rpcOne(owner, 'create_invitation', { p_company: company, p_email: u1.email, p_role: 'employee' });
    await db.admin(`update public.invitations set expires_at = now() - interval '1 minute' where id = $1`, [i1.invitation_id]);
    await expectDenied(db.rpc(u1, 'accept_invitation', { p_token: i1.token }), { hint: 'invalid' });

    const i2 = await db.rpcOne(owner, 'create_invitation', { p_company: company, p_email: u2.email, p_role: 'employee' });
    await db.rpc(owner, 'revoke_invitation', { p_invitation: i2.invitation_id });
    await expectDenied(db.rpc(u2, 'accept_invitation', { p_token: i2.token }), { hint: 'invalid' });
  });

  it('aynı adrese yeni davet eskisini geçersiz kılar', async () => {
    const u = await db.createUser('Iki Davetli');
    const old = await db.rpcOne(owner, 'create_invitation', { p_company: company, p_email: u.email, p_role: 'employee' });
    const fresh = await db.rpcOne(owner, 'create_invitation', { p_company: company, p_email: u.email, p_role: 'employee' });
    await expectDenied(db.rpc(u, 'accept_invitation', { p_token: old.token }), { hint: 'invalid' });
    expect(await db.rpcValue(u, 'accept_invitation', { p_token: fresh.token })).toBe(company);
  });

  it('yönetici daveti yalnızca sahip tarafından gönderilir; zaten üye olan davet edilemez', async () => {
    const admin = await db.createUser('Yonetici Adayi');
    await db.invite(owner, company, admin, { role: 'admin' });
    await expectDenied(
      db.rpc(admin, 'create_invitation', { p_company: company, p_email: 'baska@example.com', p_role: 'admin' }),
      { hint: 'forbidden' },
    );
    await expectDenied(db.rpc(owner, 'create_invitation', { p_company: company, p_email: emp2.email, p_role: 'employee' }), {
      hint: 'conflict',
    });
  });

  it('şirketten çıkarılan kişi yeni davetle geri dönebilir', async () => {
    await db.invite(owner, company, emp);
    expect((await db.query(emp, 'select id from public.companies where id = $1', [company])).length).toBe(1);
  });
});
