/**
 * Şirket marka teması: hedef listesi ortak paketle aynı, yalnızca branding.manage yazabilir,
 * şirketler birbirinin temasını/logosunu göremez ve değiştiremez, biçim sunucuda doğrulanır,
 * eşzamanlı kayıt çakışması yakalanır, logo yalnızca kendi şirket klasöründen ve gerçekten yüklenmişse kullanılır.
 */
import { THEME_TARGETS, defaultBrandingConfig, presetTargets, type BrandingConfig } from '@istakip/shared';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { TestDb, expectDenied, type TestUser } from '../src/db';

let db: TestDb;
let owner: TestUser, admin: TestUser, scoped: TestUser, emp: TestUser;
let otherOwner: TestUser, otherEmp: TestUser;
let company: string, otherCompany: string, group: string;

const BUCKET = 'company-branding';

const config = (extra: Partial<BrandingConfig> = {}): BrandingConfig => ({
  ...defaultBrandingConfig(),
  palette: { ...defaultBrandingConfig().palette, primary: '#7b2cbf' },
  targets: presetTargets('recommended'),
  preset: 'recommended',
  ...extra,
});

const save = (u: TestUser, companyId: string, cfg: unknown, expected: number | null = null) =>
  db.rpcOne<{ version: number; preset: string; logo_path: string | null; palette: Record<string, string> }>(u, 'save_company_branding', {
    p_company: companyId,
    p_config: cfg,
    p_expected_version: expected,
  });

const readAs = (u: TestUser, companyId: string) =>
  db.query<{ preset: string; version: number }>(u, 'select preset, version from public.company_branding where company_id = $1', [companyId]);

/** İstemcinin Storage'a yüklemesini taklit eder (kullanıcının rolüyle; RLS uygulanır) */
async function upload(u: TestUser, companyId: string) {
  const path = `${companyId}/logo-${randomUUID()}.png`;
  await db.query(u, 'insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, $3, $4, $5)', [
    BUCKET,
    path,
    u.id,
    u.id,
    JSON.stringify({ mimetype: 'image/png', size: 4096 }),
  ]);
  return path;
}
const canRead = async (u: TestUser, path: string) =>
  (await db.query(u, 'select name from storage.objects where bucket_id = $1 and name = $2', [BUCKET, path])).length === 1;

beforeAll(async () => {
  db = new TestDb(inject('dbUrl'));
  owner = await db.createUser('Marka Sahip');
  admin = await db.createUser('Marka Yonetici');
  scoped = await db.createUser('Marka Kapsamli');
  emp = await db.createUser('Marka Calisan');
  otherOwner = await db.createUser('Rakip Sahip');
  otherEmp = await db.createUser('Rakip Calisan');
  company = await db.createCompany(owner, 'Marka Şirketi');
  otherCompany = await db.createCompany(otherOwner, 'Rakip Şirket');
  await db.invite(owner, company, admin, { role: 'admin' });
  await db.invite(owner, company, emp);
  group = await db.createGroup(owner, company, 'Marka grubu', [emp]);
  await db.invite(owner, company, scoped, { role: 'admin', adminScope: 'groups', scopeGroupIds: [group] });
  await db.invite(otherOwner, otherCompany, otherEmp);
});
afterAll(() => db.close());

describe('hedef listesi', () => {
  it('veritabanındaki tema hedefleri ve izinli renkleri ortak paketle birebir aynı', async () => {
    const rows = await db.admin<{ id: string; allowed_tokens: string[] }>('select id, allowed_tokens from public.branding_targets order by sort_order');
    expect(rows).toEqual(THEME_TARGETS.map((t) => ({ id: t.id, allowed_tokens: [...t.tokens] })));
  });
});

describe('yetki ve şirket ayrımı', () => {
  it('sahip kaydeder; aynı şirketin çalışanı okur ama değiştiremez', async () => {
    const row = await save(owner, company, config());
    expect(row.version).toBe(1);
    expect(row.preset).toBe('recommended');
    expect(await readAs(emp, company)).toEqual([{ preset: 'recommended', version: 1 }]);
    await expectDenied(save(emp, company, config(), 1), { hint: 'forbidden' });
    await expectDenied(db.rpc(emp, 'reset_company_branding', { p_company: company }), { hint: 'forbidden' });
  });

  it('tam yetkili yönetici değiştirebilir; yalnızca grup kapsamlı yönetici değiştiremez', async () => {
    const row = await save(admin, company, config({ preset: 'light_brand', targets: presetTargets('light_brand') }), 1);
    expect(row.version).toBe(2);
    await expectDenied(save(scoped, company, config(), 2), { hint: 'forbidden' });
  });

  it('başka şirket temayı göremez ve kendi yetkisiyle bu şirkete yazamaz', async () => {
    expect(await readAs(otherOwner, company)).toEqual([]);
    expect(await readAs(otherEmp, company)).toEqual([]);
    await expectDenied(save(otherOwner, company, config(), 2), { hint: 'forbidden' });
    await expectDenied(db.rpc(otherOwner, 'reset_company_branding', { p_company: company }), { hint: 'forbidden' });
    // Kendi şirketine kaydetmesi bu şirketi etkilemez
    await save(otherOwner, otherCompany, config({ preset: 'dark_brand', targets: presetTargets('dark_brand') }));
    expect(await readAs(owner, company)).toEqual([{ preset: 'light_brand', version: 2 }]);
    expect(await readAs(owner, otherCompany)).toEqual([]);
  });

  it('istemci tablolara doğrudan yazamaz (yalnızca RPC)', async () => {
    await expectDenied(db.query(owner, "update public.company_branding set preset = 'original' where company_id = $1", [company]), { code: '42501' });
    await expectDenied(db.query(owner, 'delete from public.company_branding where company_id = $1', [company]), { code: '42501' });
  });

  it('şirketten çıkarılan çalışan temayı artık okuyamaz', async () => {
    const leaver = await db.createUser('Marka Ayrilan');
    await db.invite(owner, company, leaver);
    expect((await readAs(leaver, company)).length).toBe(1);
    await db.rpc(owner, 'remove_member', { p_company: company, p_user: leaver.id });
    expect(await readAs(leaver, company)).toEqual([]);
  });
});

describe('biçim doğrulama (sunucuda)', () => {
  const bad = async (cfg: unknown) => expectDenied(save(owner, company, cfg, 2), { hint: 'invalid' });

  it('geçersiz renk, eksik palet rengi ve bilinmeyen alan reddedilir', async () => {
    await bad(config({ palette: { ...config().palette, primary: 'red' } }));
    await bad(config({ palette: { ...config().palette, primary: '#7B2CBF' } })); // büyük harf: istemci normalleştirir
    const { border: _drop, ...partial } = config().palette;
    await bad({ ...config(), palette: partial });
    await bad({ ...config(), palette: { ...config().palette, logoColor: '#000000' } });
    await bad({ ...config(), companyId: otherCompany });
    await bad(config({ overrides: { primary: 'javascript:alert(1)' } as never }));
  });

  it('bilinmeyen hedef ve hedefe izin verilmeyen renk reddedilir', async () => {
    await bad({ ...config(), targets: { ...config().targets, footer: { enabled: true, token: 'primary' } } });
    await bad({ ...config(), targets: { ...config().targets, header: { enabled: true, token: 'accent' } } });
    await bad({ ...config(), targets: { ...config().targets, links: { enabled: 'yes', token: 'primary' } } });
    await bad({ ...config(), targets: { ...config().targets, links: { token: 'primary' } } });
    await bad({ ...config(), targets: { ...config().targets, links: { enabled: true } } });
    await bad({ ...config(), targets: { ...config().targets, links: { enabled: true, token: 'primary', color: '#000000' } } });
  });

  it('geçersiz hazır tema, mod ve logo zemini reddedilir; logo renk listesi sınırlıdır', async () => {
    await bad({ ...config(), preset: 'neon' });
    await bad({ ...config(), mode: 'dark' });
    await bad({ ...config(), logoBackground: 'pattern' });
    await bad(config({ swatches: Array.from({ length: 9 }, () => ({ color: '#123456', share: 0.1 })) }));
    await bad(config({ swatches: [{ color: '#123456', share: 2 }] }));
    await bad({ ...config(), swatches: [{ color: '#123456' }] });
    await bad({ ...config(), swatches: [{ color: '#123456', share: 'çok' }] });
    await bad({ ...config(), swatches: {} });
  });
});

describe('eşzamanlı düzenleme', () => {
  it('eski sürümle kaydetme ve ilk kayıtta sürüm vermeme çakışma hatası verir', async () => {
    const [cur] = await readAs(owner, company);
    await expectDenied(save(admin, company, config(), cur!.version - 1), { hint: 'conflict' });
    await expectDenied(save(admin, company, config(), null), { hint: 'conflict' });
    const fresh = await save(admin, company, config(), cur!.version);
    expect(fresh.version).toBe(cur!.version + 1);
  });
});

describe('logo', () => {
  let logo: string;

  it('yetkili kişi kendi şirket klasörüne yükler; çalışan ve başka şirket yükleyemez', async () => {
    logo = await upload(owner, company);
    await expectDenied(upload(emp, company), { code: '42501' });
    await expectDenied(upload(otherOwner, company), { code: '42501' });
    // Biçim dışı yol (ör. başka klasör veya uzantı) kabul edilmez
    await expectDenied(
      db.query(owner, 'insert into storage.objects (bucket_id, name, owner, owner_id) values ($1, $2, $3, $4)', [
        BUCKET,
        `${company}/../${otherCompany}/logo-${randomUUID()}.png`,
        owner.id,
        owner.id,
      ]),
      { code: '42501' },
    );
  });

  it('kaydedilen logoyu şirket üyeleri okur; başka şirket okuyamaz', async () => {
    const [cur] = await readAs(owner, company);
    const row = await save(owner, company, config({ logoPath: logo, logoBackground: 'light' }), cur!.version);
    expect(row.logo_path).toBe(logo);
    expect(await canRead(emp, logo)).toBe(true);
    expect(await canRead(otherOwner, logo)).toBe(false);
    expect(await canRead(otherEmp, logo)).toBe(false);
  });

  it('başka şirketin logosu veya yüklenmemiş dosya tema olarak kaydedilemez', async () => {
    const otherLogo = await upload(otherOwner, otherCompany);
    const [cur] = await readAs(owner, company);
    await expectDenied(save(owner, company, config({ logoPath: otherLogo }), cur!.version), { hint: 'invalid' });
    await expectDenied(save(owner, company, config({ logoPath: `${company}/logo-${randomUUID()}.png` }), cur!.version), { hint: 'invalid' });
  });

  // Gerçek Supabase, storage tablolarından SQL ile silmeyi engeller (yalnızca Storage API); orada uçtan uca test doğrular
  it.runIf(inject('dbMode') === 'embedded')('kullanımdaki logo silinemez; değiştirilen eski logo silinebilir', async () => {
    const next = await upload(owner, company);
    await db.query(owner, 'delete from storage.objects where bucket_id = $1 and name = $2', [BUCKET, logo]);
    expect((await db.admin('select 1 from storage.objects where name = $1', [logo])).length).toBe(1);
    const [cur] = await readAs(owner, company);
    await save(owner, company, config({ logoPath: next }), cur!.version);
    await db.query(emp, 'delete from storage.objects where bucket_id = $1 and name = $2', [BUCKET, logo]);
    expect((await db.admin('select 1 from storage.objects where name = $1', [logo])).length).toBe(1);
    await db.query(owner, 'delete from storage.objects where bucket_id = $1 and name = $2', [BUCKET, logo]);
    expect(await db.admin('select 1 from storage.objects where name = $1', [logo])).toEqual([]);
  });
});

describe('sıfırlama ve işlem geçmişi', () => {
  it('sıfırlama temayı kaldırır, eski logo yolunu döndürür; kayıtlar işlem geçmişine yazılır', async () => {
    const [cur] = await readAs(owner, company);
    const old = await db.rpcValue<string | null>(owner, 'reset_company_branding', { p_company: company, p_expected_version: cur!.version });
    expect(old).toMatch(new RegExp(`^${company}/logo-`));
    expect(await readAs(emp, company)).toEqual([]);
    expect(await db.rpcValue(owner, 'reset_company_branding', { p_company: company })).toBeNull();
    const audit = await db.admin<{ action: string }>(
      "select action from public.audit_log where company_id = $1 and action like 'branding.%' order by created_at",
      [company],
    );
    expect(audit.map((a) => a.action)).toContain('branding.saved');
    expect(audit.at(-1)!.action).toBe('branding.reset');
  });
});
