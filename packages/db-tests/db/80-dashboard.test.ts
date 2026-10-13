/**
 * Düzenlenebilir ana sayfa: bileşen kaydı ortak paketle aynı, kişisel düzen yalnızca kişiye ait,
 * izin gerektiren bileşen eklenemez, rol varsayılanı yetki ister, web ve mobil ayrı.
 */
import { WIDGETS, type WidgetDef } from '@istakip/shared';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { TestDb, expectDenied, type TestUser } from '../src/db';

let db: TestDb;
let owner: TestUser, admin: TestUser, scoped: TestUser, emp: TestUser, other: TestUser;
let company: string, group: string;

const layout = (u: TestUser, platform: 'web' | 'mobile') =>
  db.query<{ widgets: string[] }>(u, 'select widgets from public.dashboard_user_layouts where company_id = $1 and user_id = $2 and platform = $3', [
    company,
    u.id,
    platform,
  ]);

beforeAll(async () => {
  db = new TestDb(inject('dbUrl'));
  owner = await db.createUser('Panel Sahip');
  admin = await db.createUser('Panel Yonetici');
  scoped = await db.createUser('Kapsamli Yonetici');
  emp = await db.createUser('Panel Calisan');
  other = await db.createUser('Panel Disari');
  company = await db.createCompany(owner, 'Panel Şirketi');
  await db.invite(owner, company, admin, { role: 'admin' });
  await db.invite(owner, company, emp);
  group = await db.createGroup(owner, company, 'Panel grubu', [emp]);
  await db.invite(owner, company, scoped, { role: 'admin', adminScope: 'groups', scopeGroupIds: [group] });
  await db.createCompany(other, 'Dış şirket');
});
afterAll(() => db.close());

describe('bileşen kaydı', () => {
  it('veritabanındaki bileşenler ortak paketle birebir aynı', async () => {
    const rows = await db.admin<{ id: string; module_id: string; requires_perm: string | null }>(
      'select id, module_id, requires_perm from public.dashboard_widgets order by id',
    );
    const shared = (Object.values(WIDGETS) as WidgetDef[])
      .map((w) => ({ id: w.id, module_id: w.module, requires_perm: w.requires ?? null }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(rows).toEqual(shared);
  });
});

describe('kişisel düzen', () => {
  it('kaydedilir; tekrar edenler atılır, sıra korunur; web ve mobil ayrıdır', async () => {
    const saved = await db.rpcValue<string[]>(emp, 'save_my_dashboard', {
      p_company: company,
      p_platform: 'web',
      p_widgets: ['mentions', 'my_today', 'mentions'],
    });
    expect(saved).toEqual(['mentions', 'my_today']);
    expect(await layout(emp, 'web')).toEqual([{ widgets: ['mentions', 'my_today'] }]);
    expect(await layout(emp, 'mobile')).toEqual([]);
    await db.rpc(emp, 'save_my_dashboard', { p_company: company, p_platform: 'mobile', p_widgets: ['my_today'] });
    expect(await layout(emp, 'web')).toEqual([{ widgets: ['mentions', 'my_today'] }]);
  });

  it('bilinmeyen bileşen ve 12’den fazlası reddedilir', async () => {
    await expectDenied(db.rpc(emp, 'save_my_dashboard', { p_company: company, p_platform: 'web', p_widgets: ['stok_durumu'] }), { hint: 'invalid' });
    await expectDenied(
      db.rpc(emp, 'save_my_dashboard', { p_company: company, p_platform: 'web', p_widgets: Array(13).fill('my_today') }),
      { hint: 'invalid' },
    );
  });

  it('çalışan ekip özetini ekleyemez; yönetici ve grup kapsamlı yönetici ekleyebilir', async () => {
    await expectDenied(db.rpc(emp, 'save_my_dashboard', { p_company: company, p_platform: 'web', p_widgets: ['team_summary'] }), { hint: 'forbidden' });
    await db.rpc(admin, 'save_my_dashboard', { p_company: company, p_platform: 'web', p_widgets: ['team_summary'] });
    await db.rpc(scoped, 'save_my_dashboard', { p_company: company, p_platform: 'web', p_widgets: ['team_summary', 'overdue'] });
  });

  it('kapalı modülün bileşeni düzende saklanabilir (gösterilmez, modül açılınca geri gelir)', async () => {
    await db.rpc(owner, 'set_module_enabled', { p_company: company, p_module: 'messaging', p_enabled: false });
    try {
      await db.rpc(emp, 'save_my_dashboard', { p_company: company, p_platform: 'web', p_widgets: ['my_today', 'mentions'] });
      expect(await layout(emp, 'web')).toEqual([{ widgets: ['my_today', 'mentions'] }]);
    } finally {
      await db.rpc(owner, 'set_module_enabled', { p_company: company, p_module: 'messaging', p_enabled: true });
    }
  });

  it('başkasının düzeni okunamaz; üye olunmayan şirkete düzen kaydedilemez; sıfırlanabilir', async () => {
    expect(await db.query(admin, 'select * from public.dashboard_user_layouts where user_id = $1', [emp.id])).toEqual([]);
    await expectDenied(db.rpc(other, 'save_my_dashboard', { p_company: company, p_platform: 'web', p_widgets: ['my_today'] }), { hint: 'forbidden' });
    await db.rpc(emp, 'reset_my_dashboard', { p_company: company, p_platform: 'mobile' });
    expect(await layout(emp, 'mobile')).toEqual([]);
    expect(await layout(emp, 'web')).toHaveLength(1);
  });
});

describe('şirket/rol varsayılanı', () => {
  it('yalnızca dashboard.manage_defaults izni olan belirler; şirket üyeleri okur; işlem geçmişine yazılır', async () => {
    await expectDenied(
      db.rpc(emp, 'save_dashboard_default', { p_company: company, p_role: 'employee', p_platform: 'web', p_widgets: ['my_today'] }),
      { hint: 'forbidden' },
    );
    await db.rpc(admin, 'save_dashboard_default', { p_company: company, p_role: 'employee', p_platform: 'web', p_widgets: ['my_today', 'mentions'] });
    const seen = await db.query<{ widgets: string[] }>(emp, `select widgets from public.dashboard_role_defaults where company_id = $1 and role = 'employee'`, [company]);
    expect(seen).toEqual([{ widgets: ['my_today', 'mentions'] }]);
    expect(await db.query(other, 'select * from public.dashboard_role_defaults where company_id = $1', [company])).toEqual([]);
    const audit = await db.admin(`select action from public.audit_log where company_id = $1 and action like 'dashboard.%'`, [company]);
    expect(audit.length).toBeGreaterThan(0);
  });

  it('rolün göremeyeceği bileşen varsayılana eklenemez', async () => {
    await expectDenied(
      db.rpc(owner, 'save_dashboard_default', { p_company: company, p_role: 'employee', p_platform: 'web', p_widgets: ['team_summary'] }),
      { hint: 'invalid' },
    );
    await db.rpc(owner, 'save_dashboard_default', { p_company: company, p_role: 'admin', p_platform: 'mobile', p_widgets: ['team_summary'] });
    await db.rpc(owner, 'reset_dashboard_default', { p_company: company, p_role: 'admin', p_platform: 'mobile' });
    expect(await db.admin(`select 1 from public.dashboard_role_defaults where company_id = $1 and role = 'admin'`, [company])).toEqual([]);
  });

  it('istemci tablolara doğrudan yazamaz', async () => {
    await expectDenied(
      db.query(emp, `insert into public.dashboard_user_layouts (company_id, user_id, platform, widgets) values ($1, $2, 'web', '{team_summary}')`, [company, emp.id]),
      { code: '42501' },
    );
  });
});
