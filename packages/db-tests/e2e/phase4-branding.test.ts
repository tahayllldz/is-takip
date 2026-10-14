/**
 * Marka teması uçtan uca — GERÇEK Supabase (Auth + PostgREST + Storage API + Realtime).
 * `pnpm db:start` çalışmıyorsa testler ATLANIR (başarılı sayılmaz).
 *
 * Kişiler: sahip ve çalışan (A şirketi), yabancı (B şirketinin sahibi).
 */
import { randomUUID } from 'node:crypto';
import {
  BRANDING_BUCKET,
  acceptInvitation,
  analyzeLogoPixels,
  createCompany,
  createInvitation,
  defaultBrandingConfig,
  fetchCompanyBranding,
  presetTargets,
  proposePalette,
  removeBrandLogo,
  resetCompanyBranding,
  saveCompanyBranding,
  signBrandLogoUrl,
  subscribeCompanyChanges,
  uploadBrandLogo,
  type BrandingConfig,
  type Client,
} from '@istakip/shared';
import { decodePng } from '@istakip/shared/logo-image';
import { createClient } from '@supabase/supabase-js';
import UPNG from 'upng-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveSupabaseEnv } from '../src/supabase-env';

const env = resolveSupabaseEnv();
const password = `Test-${randomUUID()}`;
const tag = randomUUID().slice(0, 8);

/** Saydam zeminli gerçek PNG logo: mor kare + koyu yazı şeridi */
function makeLogo(): Uint8Array {
  const w = 160;
  const h = 64;
  const px = new Uint8Array(w * h * 4);
  const rect = (x0: number, y0: number, rw: number, rh: number, c: number[]) => {
    for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) px.set(c, (y * w + x) * 4);
  };
  rect(8, 8, 48, 48, [123, 44, 191, 255]);
  rect(64, 24, 88, 16, [29, 53, 87, 255]);
  return new Uint8Array(UPNG.encode([px.buffer as ArrayBuffer], w, h, 0));
}

describe.skipIf(!env)('Marka teması: logo, palet, şirket ayrımı, canlı güncelleme (gerçek Supabase)', () => {
  const e = env ?? { url: '', publishableKey: '', secretKey: '' };
  let admin: Client;
  let owner: Client, emp: Client, stranger: Client;
  const ids: Record<string, string> = {};
  const users: string[] = [];
  let companyId: string, otherCompanyId: string;
  let logoPath: string;
  let version: number;

  const newClient = () => createClient(e.url, e.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });

  async function signUp(key: string, name: string): Promise<Client> {
    const email = `e2e4-${key}-${tag}@example.com`;
    const r = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
    if (r.error) throw r.error;
    ids[key] = r.data.user.id;
    users.push(r.data.user.id);
    const c = newClient();
    const login = await c.auth.signInWithPassword({ email, password });
    if (login.error) throw login.error;
    return c;
  }

  const objectExists = async (path: string) => {
    const [folder, name] = path.split('/');
    const { data } = await admin.storage.from(BRANDING_BUCKET).list(folder, { search: name });
    return (data ?? []).some((o) => o.name === name);
  };

  beforeAll(async () => {
    admin = createClient(e.url, e.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    owner = await signUp('sahip', 'E2E Marka Sahip');
    emp = await signUp('calisan', 'E2E Marka Çalışan');
    stranger = await signUp('yabanci', 'E2E Marka Yabancı');
    companyId = await createCompany(owner, `E2E Marka ${tag}`);
    const { token } = await createInvitation(owner, { companyId, email: `e2e4-calisan-${tag}@example.com`, role: 'employee' });
    await acceptInvitation(emp, token);
    otherCompanyId = await createCompany(stranger, `E2E Rakip ${tag}`);
  });

  afterAll(async () => {
    for (const id of [companyId, otherCompanyId]) {
      if (!id) continue;
      const { data } = await admin.storage.from(BRANDING_BUCKET).list(id);
      if (data?.length) await admin.storage.from(BRANDING_BUCKET).remove(data.map((o) => `${id}/${o.name}`));
      await admin.from('companies').delete().eq('id', id);
    }
    for (const id of users) await admin.auth.admin.deleteUser(id).catch(() => undefined);
  });

  it('sahip logoyu özel depoya yükler; logodan çıkarılan paletle tema kaydedilir', async () => {
    const bytes = makeLogo();
    const img = decodePng(bytes);
    const analysis = analyzeLogoPixels(img.rgba, img.width, img.height);
    const proposal = proposePalette(analysis.swatches);
    expect(proposal.palette.primary).toBe('#7b2cbf');

    logoPath = await uploadBrandLogo(owner, companyId, randomUUID(), bytes);
    const cfg: BrandingConfig = {
      ...defaultBrandingConfig(),
      logoPath,
      logoBackground: 'light',
      palette: proposal.palette,
      swatches: analysis.swatches,
      targets: presetTargets('recommended'),
      preset: 'recommended',
    };
    const saved = await saveCompanyBranding(owner, companyId, cfg, null);
    version = saved.version;
    expect(saved.logoPath).toBe(logoPath);
    expect(saved.palette.primary).toBe('#7b2cbf');
  });

  it('çalışan temayı ve logoyu (kısa süreli imzalı bağlantıyla) alır; dosya baytları aynıdır', async () => {
    const b = await fetchCompanyBranding(emp, companyId);
    expect(b?.preset).toBe('recommended');
    expect(b?.targets.primaryButton).toEqual({ enabled: true, token: 'primary' });
    const url = await signBrandLogoUrl(emp, b!.logoPath!, 60);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(makeLogo());
    // Kova herkese açık değil: imzasız genel adres çalışmaz
    const pub = await fetch(`${e.url}/storage/v1/object/public/${BRANDING_BUCKET}/${logoPath}`);
    expect(pub.status).toBeGreaterThanOrEqual(400);
  });

  it('başka şirket temayı ve logoyu göremez, bu şirkete logo yükleyemez ve tema kaydedemez', async () => {
    expect(await fetchCompanyBranding(stranger, companyId)).toBeNull();
    await expect(signBrandLogoUrl(stranger, logoPath, 60)).rejects.toThrow();
    await expect(uploadBrandLogo(stranger, companyId, randomUUID(), makeLogo())).rejects.toMatchObject({ code: 'forbidden' });
    await expect(saveCompanyBranding(stranger, companyId, defaultBrandingConfig(), version)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('çalışan logo yükleyemez ve temayı değiştiremez', async () => {
    await expect(uploadBrandLogo(emp, companyId, randomUUID(), makeLogo())).rejects.toMatchObject({ code: 'forbidden' });
    await expect(saveCompanyBranding(emp, companyId, defaultBrandingConfig(), version)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(resetCompanyBranding(emp, companyId, version)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('kova yalnızca PNG/JPEG kabul eder (SVG reddedilir)', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const { error } = await owner.storage.from(BRANDING_BUCKET).upload(`${companyId}/logo-${randomUUID()}.png`, svg, { contentType: 'image/svg+xml' });
    expect(error).toBeTruthy();
  });

  it('başka yönetici kaydedince açık uygulama canlı (Realtime) tema olayı alır', async () => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Tema olayı 15 sn içinde gelmedi')), 15_000);
      let saved = false;
      const unsubscribe = subscribeCompanyChanges(
        emp,
        companyId,
        ids.calisan!,
        {
          onBranding: () => {
            clearTimeout(timer);
            unsubscribe();
            resolve();
          },
          onLive: (s) => {
            if (s !== 'live' || saved) return;
            saved = true;
            void fetchCompanyBranding(owner, companyId)
              .then((cur) => saveCompanyBranding(owner, companyId, { ...defaultBrandingConfig(), ...pick(cur!), preset: 'dark_brand', targets: presetTargets('dark_brand') }, cur!.version))
              .then((r) => {
                version = r.version;
              })
              .catch(reject);
          },
        },
        'marka-e2e',
      );
    });
    expect((await fetchCompanyBranding(emp, companyId))?.preset).toBe('dark_brand');
  });

  it('kullanımdaki logo silinemez; logo değişince eski dosya silinebilir; sıfırlama logoyu da kaldırır', async () => {
    await removeBrandLogo(owner, logoPath);
    expect(await objectExists(logoPath)).toBe(true);

    const next = await uploadBrandLogo(owner, companyId, randomUUID(), makeLogo());
    const cur = await fetchCompanyBranding(owner, companyId);
    const r = await saveCompanyBranding(owner, companyId, { ...pick(cur!), logoPath: next }, cur!.version);
    await removeBrandLogo(owner, logoPath);
    expect(await objectExists(logoPath)).toBe(false);

    await resetCompanyBranding(owner, companyId, r.version);
    expect(await fetchCompanyBranding(emp, companyId)).toBeNull();
    expect(await objectExists(next)).toBe(false);
  });
});

const pick = (b: BrandingConfig): BrandingConfig => ({
  logoPath: b.logoPath,
  logoBackground: b.logoBackground,
  palette: b.palette,
  overrides: b.overrides,
  swatches: b.swatches,
  targets: b.targets,
  preset: b.preset,
  mode: b.mode,
});
