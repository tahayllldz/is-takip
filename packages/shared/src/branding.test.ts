import UPNG from 'upng-js';
import { describe, expect, it } from 'vitest';
import {
  APP_COLORS,
  APP_PALETTE,
  BRANDING_PRESETS,
  STATUS_COLORS,
  THEME_TARGETS,
  analyzeLogoPixels,
  brandingConfigSchema,
  contrastRatio,
  defaultBrandingConfig,
  derivePalette,
  effectivePalette,
  ensureContrast,
  ensureFill,
  hexToHsl,
  matchPreset,
  normalizeHex,
  presetTargets,
  proposePalette,
  resolveTheme,
  suggestLogoBackground,
  type BrandingConfig,
} from './branding';
import { base64ToBytes, decodePng, logoFileProblem } from './logo-image';

/** Test görüntüsü: tüm pikseller `bg`, ardından dikdörtgenler çizilir */
function canvas(w: number, h: number, bg: [number, number, number, number]) {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set(bg, i * 4);
  const rect = (x0: number, y0: number, rw: number, rh: number, c: [number, number, number, number]) => {
    for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) px.set(c, (y * w + x) * 4);
  };
  return { px, rect };
}
const rgba = (hex: string, a = 255): [number, number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
};

/** Test için base64 kodlayıcı (paket Node tiplerine bağımlı olmasın) */
function toBase64(bytes: Uint8Array): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += A[(n >> 18) & 63]! + A[(n >> 12) & 63]! + (i + 1 < bytes.length ? A[(n >> 6) & 63]! : '=') + (i + 2 < bytes.length ? A[n & 63]! : '=');
  }
  return out;
}

/** Basit belirlenimci rastgele sayı üreteci (testler her çalıştırmada aynı) */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const randomHex = (r: () => number) =>
  `#${Math.floor(r() * 0xffffff)
    .toString(16)
    .padStart(6, '0')}`;

describe('renk matematiği', () => {
  it('hex biçimini normalleştirir, geçersizi reddeder', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex(' 1d5FD1 ')).toBe('#1d5fd1');
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('kırmızı')).toBeNull();
  });

  it('WCAG kontrast oranı bilinen değerleri verir', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });

  it('ensureContrast her zaman hedefe ulaşır ve tonu mümkün olduğunca korur', () => {
    const r = rng(7);
    for (let i = 0; i < 400; i++) {
      const fg = randomHex(r);
      const bg = randomHex(r);
      expect(contrastRatio(ensureContrast(fg, bg, 4.5), bg)).toBeGreaterThanOrEqual(4.5);
    }
    // Açık sarı bağlantı beyaz zeminde koyulaşır ama sarı tonunda kalır
    const adjusted = ensureContrast('#f5c400', '#ffffff', 4.5);
    expect(Math.abs(hexToHsl(adjusted).h - hexToHsl('#f5c400').h)).toBeLessThan(6);
  });

  it('ensureFill düğme metnini zemine göre seçer, yetmezse zemini ayarlar', () => {
    expect(ensureFill('#1d5fd1').fg).toBe('#ffffff');
    expect(ensureFill('#f5c400').fg).not.toBe('#ffffff'); // sarı düğmede koyu yazı
    // Orta tonlu turkuaz: biraz koyulaştırılıp beyaz yazı (tonu korunur)
    const teal = ensureFill('#0f8b8d');
    expect(teal.fg).toBe('#ffffff');
    expect(teal.adjusted).toBe(true);
    expect(Math.abs(hexToHsl(teal.bg).h - hexToHsl('#0f8b8d').h)).toBeLessThan(6);
    const r = rng(11);
    for (let i = 0; i < 300; i++) {
      const f = ensureFill(randomHex(r));
      expect(contrastRatio(f.fg, f.bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('anlam (durum) renkleri her zaman okunaklı', () => {
    for (const s of Object.values(STATUS_COLORS)) expect(contrastRatio(s.fg, s.bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('logodan renk çıkarma', () => {
  it('saydam pikselleri renk saymaz; baskın renkleri ve içerik sınırını bulur', () => {
    const { px, rect } = canvas(96, 96, [0, 0, 0, 0]);
    rect(20, 20, 30, 30, rgba('#d62828')); // kırmızı simge (900 px)
    rect(20, 60, 56, 10, rgba('#1d3557')); // lacivert yazı (560 px)
    const a = analyzeLogoPixels(px, 96, 96);
    expect(a.hasTransparency).toBe(true);
    expect(a.background).toBeNull();
    expect(a.swatches.map((s) => s.color)).toEqual(['#d62828', '#1d3557']);
    expect(a.swatches[0]!.share).toBeCloseTo(900 / 1460, 2);
    expect(a.bounds).toEqual({ x: 20, y: 20, width: 56, height: 50 });
    // Tamamen saydam piksellerin rengi (siyah 0,0,0) palete girmedi
    expect(a.swatches.some((s) => s.color === '#000000')).toBe(false);
  });

  it('düz beyaz zeminli (JPEG) logoda zemini çıkarır', () => {
    const { px, rect } = canvas(80, 80, rgba('#ffffff'));
    rect(10, 30, 60, 20, rgba('#2a9d8f'));
    const a = analyzeLogoPixels(px, 80, 80);
    expect(a.background).toBe('#ffffff');
    expect(a.hasTransparency).toBe(false);
    expect(a.swatches.map((s) => s.color)).toEqual(['#2a9d8f']);
    expect(a.bounds).toEqual({ x: 10, y: 30, width: 60, height: 20 });
  });

  it('kenar yumuşatma kırıntılarını (%2 altı) palete almaz', () => {
    const { px, rect } = canvas(100, 100, [0, 0, 0, 0]);
    rect(10, 10, 50, 50, rgba('#e76f51'));
    rect(60, 10, 1, 20, rgba('#7a7aff', 200)); // 20 px (≈%0.8) farklı renkli kırıntı
    const a = analyzeLogoPixels(px, 100, 100);
    expect(a.swatches.map((s) => s.color)).toEqual(['#e76f51']);
  });

  it('boş (tamamen saydam) görüntüde renk önermez', () => {
    const { px } = canvas(64, 64, [0, 0, 0, 0]);
    const a = analyzeLogoPixels(px, 64, 64);
    expect(a.swatches).toEqual([]);
    expect(() => proposePalette(a.swatches)).toThrow();
  });

  it('eksik görüntü verisini reddeder', () => {
    expect(() => analyzeLogoPixels(new Uint8Array(10), 64, 64)).toThrow();
  });

  it('açık tonlu saydam logo için koyu zemin önerir', () => {
    const { px, rect } = canvas(64, 64, [0, 0, 0, 0]);
    rect(8, 8, 48, 48, rgba('#f8f9fa'));
    expect(suggestLogoBackground(analyzeLogoPixels(px, 64, 64))).toBe('dark');
  });
});

describe('palet önerisi', () => {
  it('renkli ve baskın rengi ana renk, farklı tondaki rengi ikincil yapar; türetilenleri işaretler', () => {
    const p = proposePalette([
      { color: '#d62828', share: 0.6 },
      { color: '#1d3557', share: 0.4 },
    ]);
    expect(p.palette.primary).toBe('#d62828');
    expect(p.palette.secondary).toBe('#1d3557');
    expect(p.sources).toEqual({ primary: 'logo', secondary: 'logo', accent: 'derived' });
  });

  it('siyah-gri logoda koyu rengi ana renk yapar ve tema yine okunaklı olur', () => {
    const p = proposePalette([
      { color: '#111111', share: 0.8 },
      { color: '#9a9a9a', share: 0.2 },
    ]);
    expect(p.palette.primary).toBe('#111111');
    const cfg = { ...defaultBrandingConfig(), palette: p.palette, targets: presetTargets('dark_brand') };
    expect(resolveTheme(cfg).checks.filter((c) => !c.ok)).toEqual([]);
  });

  it('"Başka öneri" sıradaki belirgin rengi ana renk yapar', () => {
    const sw = [
      { color: '#e63946', share: 0.5 },
      { color: '#2a9d8f', share: 0.3 },
      { color: '#f4a261', share: 0.2 },
    ];
    const a = proposePalette(sw, 0);
    const b = proposePalette(sw, 1);
    expect(a.variants).toBe(3);
    expect(b.palette.primary).not.toBe(a.palette.primary);
    expect(proposePalette(sw, 3).palette.primary).toBe(a.palette.primary);
  });

  it('türetilen yüzey/metin renkleri erişilebilir', () => {
    const r = rng(3);
    for (let i = 0; i < 200; i++) {
      const p = derivePalette({ primary: randomHex(r), secondary: randomHex(r), accent: randomHex(r) });
      expect(contrastRatio('#ffffff', p.surfaceDark)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(p.textPrimary, p.surfaceLight)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(p.textSecondary, p.surfaceLight)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('tema belirteçleri', () => {
  it('yapılandırma yoksa uygulamanın kendi teması; tüm çiftler okunaklı', () => {
    const t = resolveTheme(null);
    expect(t.tokens.action.primary.bg).toBe(APP_COLORS.brand);
    expect(t.tokens.navigation.headerBg).toBe('#ffffff');
    expect(t.checks.filter((c) => !c.ok)).toEqual([]);
    expect(t.adjustments).toEqual([]);
  });

  it('rastgele 300 palet × her hazır tema: hiçbir kontrast çifti AA altına düşmez', () => {
    const r = rng(42);
    for (let i = 0; i < 300; i++) {
      const palette = derivePalette({ primary: randomHex(r), secondary: randomHex(r), accent: randomHex(r) });
      for (const preset of BRANDING_PRESETS) {
        const cfg = { palette, overrides: {}, targets: presetTargets(preset) };
        const bad = resolveTheme(cfg).checks.filter((c) => !c.ok);
        expect(bad, `${preset} ${palette.primary}`).toEqual([]);
      }
    }
  });

  it('elle girilen aşırı renkler (beyaza yakın metin, sarı bağlantı) düzeltilir ve raporlanır', () => {
    const all = Object.fromEntries(THEME_TARGETS.map((t) => [t.id, { enabled: true, token: t.tokens[0] }]));
    const cfg = {
      palette: APP_PALETTE,
      overrides: { primary: '#ffe066', textPrimary: '#eeeeee', textSecondary: '#f4f4f4', surfaceLight: '#fffbe6' },
      targets: all as BrandingConfig['targets'],
    };
    const t = resolveTheme(cfg);
    expect(t.checks.filter((c) => !c.ok)).toEqual([]);
    expect(t.adjustments.length).toBeGreaterThan(0);
  });

  it('her hedef yalnızca kendi bölümünü değiştirir', () => {
    const palette = derivePalette({ primary: '#7b2cbf', secondary: '#2a9d8f', accent: '#e76f51' });
    const base = resolveTheme({ palette, overrides: {}, targets: presetTargets('original') }).tokens;
    const only = (id: (typeof THEME_TARGETS)[number]['id'], token: BrandingConfig['palette'] extends never ? never : string) => {
      const targets = presetTargets('original');
      targets[id] = { enabled: true, token: token as never };
      return resolveTheme({ palette, overrides: {}, targets }).tokens;
    };

    const pb = only('primaryButton', 'accent');
    expect(pb.action.primary.bg).toBe(ensureFill('#e76f51').bg);
    expect({ ...pb, action: base.action }).toEqual(base);

    const header = only('header', 'surfaceDark');
    expect(header.navigation.headerBg).toBe(palette.surfaceDark);
    expect(header.navigation.headerFg).toBe('#ffffff');
    expect(header.navigation.statusBar).toBe('light');
    expect(header.navigation.tabBg).toBe(base.navigation.tabBg);

    const text = only('text', 'textPrimary');
    expect(text.text.primary).not.toBe(base.text.primary);
    expect(base.text.primary).toBe(APP_COLORS.text);
  });

  it('durum renkleri (başarı/uyarı/hata) hiçbir temada değişmez', () => {
    const palette = derivePalette({ primary: '#ff006e', secondary: '#3a86ff', accent: '#ffbe0b' });
    for (const preset of BRANDING_PRESETS) {
      const s = resolveTheme({ palette, overrides: {}, targets: presetTargets(preset) }).tokens.status;
      expect(s.success).toEqual(STATUS_COLORS.success);
      expect(s.warning).toEqual(STATUS_COLORS.warning);
      expect(s.danger).toEqual(STATUS_COLORS.danger);
    }
  });

  it('elle değiştirilen ana renk türetilen renkleri günceller; elle değiştirilen türetilmiş renk korunur', () => {
    const cfg = { palette: APP_PALETTE, overrides: { primary: '#2a9d8f', surfaceDark: '#0b1d1a' } };
    const eff = effectivePalette(cfg);
    expect(eff.primary).toBe('#2a9d8f');
    expect(eff.surfaceDark).toBe('#0b1d1a');
    expect(eff.surfaceLight).toBe(derivePalette({ primary: '#2a9d8f', secondary: APP_PALETTE.secondary, accent: APP_PALETTE.accent }).surfaceLight);
  });

  it('hazır temalar tanınır; elle değişiklik "özel" olur', () => {
    for (const p of BRANDING_PRESETS) expect(matchPreset(presetTargets(p))).toBe(p);
    const t = presetTargets('recommended');
    t.cards = { enabled: true, token: 'surfaceLight' };
    expect(matchPreset(t)).toBe('custom');
  });
});

describe('kayıt biçimi', () => {
  const valid = (): BrandingConfig => ({ ...defaultBrandingConfig(), targets: presetTargets('recommended'), preset: 'recommended' });

  it('geçerli yapılandırmayı kabul eder', () => {
    expect(brandingConfigSchema.safeParse(valid()).success).toBe(true);
  });

  it('geçersiz renk, bilinmeyen hedef, hedefe uymayan renk ve fazladan alan reddedilir', () => {
    expect(brandingConfigSchema.safeParse({ ...valid(), palette: { ...valid().palette, primary: 'red' } }).success).toBe(false);
    expect(brandingConfigSchema.safeParse({ ...valid(), targets: { ...valid().targets, footer: { enabled: true, token: 'primary' } } }).success).toBe(false);
    expect(brandingConfigSchema.safeParse({ ...valid(), targets: { ...valid().targets, header: { enabled: true, token: 'accent' } } }).success).toBe(false);
    expect(brandingConfigSchema.safeParse({ ...valid(), companyId: 'x' }).success).toBe(false);
    expect(brandingConfigSchema.safeParse({ ...valid(), mode: 'dark' }).success).toBe(false);
  });
});

describe('logo dosyası', () => {
  it('tür ve boyut kontrolü', () => {
    expect(logoFileProblem({ mimeType: 'image/svg+xml' })).toMatch(/SVG/);
    expect(logoFileProblem({ mimeType: 'image/gif' })).toMatch(/PNG veya JPEG/);
    expect(logoFileProblem({ mimeType: 'image/png', width: 40, height: 300 })).toMatch(/64×64/);
    expect(logoFileProblem({ mimeType: 'image/jpeg', width: 800, height: 400, fileSize: 300_000 })).toBeNull();
  });

  it('PNG çözme: saydamlık korunur ve renk çıkarma aynı sonucu verir', () => {
    const { px, rect } = canvas(48, 48, [0, 0, 0, 0]);
    rect(4, 4, 24, 24, rgba('#3a86ff'));
    const png = new Uint8Array(UPNG.encode([px.buffer as ArrayBuffer], 48, 48, 0));
    const b64 = toBase64(png);
    const bytes = base64ToBytes(b64);
    expect(bytes).toEqual(png);
    const img = decodePng(bytes);
    expect([img.width, img.height]).toEqual([48, 48]);
    expect(img.rgba[3]).toBe(0);
    expect(analyzeLogoPixels(img.rgba, img.width, img.height).swatches[0]!.color).toBe('#3a86ff');
  });

  it('PNG olmayan baytları reddeder', () => {
    expect(() => decodePng(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]))).toThrow(/PNG/);
  });
});
