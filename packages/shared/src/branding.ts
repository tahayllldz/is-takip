/**
 * Şirket marka teması: renk matematiği, logodan palet çıkarma, tema hedefleri,
 * hazır temalar ve tasarım belirteçlerinin (design token) çözümü.
 *
 * İlkeler:
 * - Marka rengi yalnızca seçilen hedeflere uygulanır. Durum renkleri (başarı / uyarı / hata)
 *   sabittir; anlamı herkes için aynı kalmalı.
 * - Her ön plan/arka plan çifti çözüm sırasında WCAG AA'ya getirilir (metin 4.5:1, arayüz öğesi 3:1).
 *   Gerekirse marka rengi koyulaştırılır veya açılır; yapılan her düzeltme `adjustments` ile raporlanır.
 * - Palet logonun gerçek piksellerinden çıkarılır; saydam pikseller ve düz arka plan sayılmaz.
 * - Sunucu yalnızca biçimi ve yetkiyi zorlar (supabase/migrations/…_branding.sql); hedef listesi orada da var.
 */
import { z } from 'zod';

// =====================================================================
// Renk matematiği
// =====================================================================
export interface Rgb {
  r: number;
  g: number;
  b: number;
}
export interface Hsl {
  /** 0–360 */
  h: number;
  /** 0–1 */
  s: number;
  /** 0–1 */
  l: number;
}

export const HEX_COLOR = /^#[0-9a-f]{6}$/;
export const WHITE = '#ffffff';
/** Açık zeminde metin için en koyu ton (saf siyahtan biraz yumuşak) */
export const INK = '#111827';

/** "#ABC", "abc", " #AaBbCc " → "#aabbcc"; geçersizse null */
export function normalizeHex(input: string): string | null {
  const raw = input.trim().toLowerCase().replace(/^#/, '');
  const full = /^[0-9a-f]{3}$/.test(raw) ? raw.replace(/./g, (ch) => ch + ch) : raw;
  return /^[0-9a-f]{6}$/.test(full) ? `#${full}` : null;
}

export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG göreli parlaklık (0 siyah – 1 beyaz) */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG kontrast oranı (1–21) */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** a ile b arasında karışım; t = 0 → a, t = 1 → b */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const hh = (((h % 360) + 360) % 360) / 360;
  const ss = Math.max(0, Math.min(1, s));
  const ll = Math.max(0, Math.min(1, l));
  if (ss === 0) return rgbToHex({ r: ll * 255, g: ll * 255, b: ll * 255 });
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const hue = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return rgbToHex({ r: hue(hh + 1 / 3) * 255, g: hue(hh) * 255, b: hue(hh - 1 / 3) * 255 });
}

export const hexToHsl = (hex: string): Hsl => rgbToHsl(hexToRgb(hex));

/** İki ton arasındaki açı farkı (0–180) */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Zeminde daha okunaklı olan metin rengi (beyaz veya koyu mürekkep) */
export function readableOn(bg: string): string {
  return contrastRatio(WHITE, bg) >= contrastRatio(INK, bg) ? WHITE : INK;
}

/**
 * Ön plan rengini, tonunu koruyarak zemine karşı en az `min` kontrasta getirir.
 * Önce açık zeminde koyulaştırmayı (koyu zeminde açmayı), olmazsa diğer yönü dener.
 * Son çare saf siyah/beyazdır: her düz zeminde ikisinden biri en az 4.58:1 verir.
 */
export function ensureContrast(fg: string, bg: string, min = 4.5): string {
  if (contrastRatio(fg, bg) >= min) return fg;
  const hsl = hexToHsl(fg);
  const order = luminance(bg) > 0.18 ? [-1, 1] : [1, -1];
  for (const dir of order) {
    for (let i = 1; i <= 50; i++) {
      const l = clamp01(hsl.l + dir * i * 0.02);
      const c = hslToHex({ ...hsl, l });
      if (contrastRatio(c, bg) >= min) return c;
      if (l === 0 || l === 1) break;
    }
  }
  return contrastRatio('#000000', bg) >= contrastRatio(WHITE, bg) ? '#000000' : WHITE;
}

/**
 * Dolgulu öğe (düğme, rozet): metin rengi zemine göre seçilir; ikisi de yetmezse
 * zemin metinden uzaklaştırılır (koyulaştırılır/açılır).
 */
export function ensureFill(bg: string, min = 4.5): { bg: string; fg: string; adjusted: boolean } {
  const fg = readableOn(bg);
  if (contrastRatio(fg, bg) >= min) return { bg, fg, adjusted: false };
  const adjusted = ensureContrast(bg, fg, min);
  return { bg: adjusted, fg, adjusted: adjusted !== bg };
}

// =====================================================================
// Palet
// =====================================================================
export const PALETTE_KEYS = ['primary', 'secondary', 'accent', 'surfaceLight', 'surfaceDark', 'textPrimary', 'textSecondary', 'border'] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];
export type BrandPalette = Record<PaletteKey, string>;

/** Logodan gelen ana renkler; diğerleri bunlardan türetilir */
export const BASE_PALETTE_KEYS = ['primary', 'secondary', 'accent'] as const satisfies readonly PaletteKey[];
export type BasePaletteKey = (typeof BASE_PALETTE_KEYS)[number];

export const PALETTE_LABELS: Record<PaletteKey, { label: string; hint: string }> = {
  primary: { label: 'Ana marka rengi', hint: 'Düğmeler, seçili durumlar, bağlantılar' },
  secondary: { label: 'İkincil renk', hint: 'Daha az öne çıkan vurgular' },
  accent: { label: 'Vurgu rengi', hint: 'Rozetler, grafikler, küçük vurgular' },
  surfaceLight: { label: 'Açık yüzey', hint: 'Açık marka başlığı ve vurgulu alanlar' },
  surfaceDark: { label: 'Koyu yüzey', hint: 'Koyu başlık ve gezinme çubuğu' },
  textPrimary: { label: 'Ana metin', hint: 'Başlıklar ve gövde metni' },
  textSecondary: { label: 'İkincil metin', hint: 'Açıklamalar, tarih ve kişi bilgileri' },
  border: { label: 'Kenarlık ve ayraç', hint: 'Kart çerçeveleri ve çizgiler' },
};

/** Uygulamanın kendi (markasız) renkleri */
export const APP_COLORS = {
  canvas: '#f4f6f8',
  surface: '#ffffff',
  surfaceMuted: '#eef1f5',
  border: '#dde3ea',
  borderStrong: '#a9b4c0',
  text: '#131a22',
  textSecondary: '#4a5664',
  textDisabled: '#6b7683',
  brand: '#1d5fd1',
} as const;

/**
 * Anlam renkleri (marka temasından etkilenmez). Her çift 4.5:1'i geçer (testte doğrulanır).
 * Bilgi tonu "rozetler" hedefi açıksa marka rengini alır; diğerleri sabittir.
 */
export const STATUS_COLORS = {
  success: { fg: '#146c43', bg: '#e3f4ea', border: '#a9dcbf' },
  warning: { fg: '#8a5300', bg: '#fff3dc', border: '#f0d39b' },
  danger: { fg: '#b42318', bg: '#fdecea', border: '#f1b8b2' },
  info: { fg: '#1d5fd1', bg: '#e9f0fc', border: '#b9cdf3' },
  neutral: { fg: '#2b3540', bg: '#eef1f5', border: '#d5dbe2' },
} as const;
export type StatusTone = keyof typeof STATUS_COLORS;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Ana renklerden yüzey, metin ve kenarlık renklerini türetir (marka tonunda, erişilebilir) */
export function derivePalette(base: Record<BasePaletteKey, string>): BrandPalette {
  const p = hexToHsl(base.primary);
  // Gri tonlu (doygunluğu düşük) markalarda yüzeyler nötr kalır
  const sat = p.s < 0.08 ? 0 : p.s;
  const surfaceLight = hslToHex({ h: p.h, s: Math.min(sat, 0.6), l: 0.965 });
  let surfaceDark = hslToHex({ h: p.h, s: Math.min(sat, 0.45), l: 0.15 });
  if (contrastRatio(WHITE, surfaceDark) < 7) surfaceDark = ensureContrast(surfaceDark, WHITE, 7);
  const textPrimary = ensureContrast(hslToHex({ h: p.h, s: Math.min(sat, 0.3), l: 0.13 }), surfaceLight, 12);
  const textSecondary = ensureContrast(hslToHex({ h: p.h, s: Math.min(sat, 0.2), l: 0.36 }), mix(surfaceLight, APP_COLORS.canvas, 0.5), 5.5);
  const border = hslToHex({ h: p.h, s: Math.min(sat, 0.25), l: 0.86 });
  return { primary: base.primary, secondary: base.secondary, accent: base.accent, surfaceLight, surfaceDark, textPrimary, textSecondary, border };
}

/** Markasız (uygulamanın kendi) paleti: düzenleyicinin başlangıç değeri */
export const APP_PALETTE: BrandPalette = derivePalette({ primary: APP_COLORS.brand, secondary: '#0f766e', accent: '#b45309' });

// =====================================================================
// Logo analizi (piksellerden)
// =====================================================================
export interface LogoSwatch {
  color: string;
  /** Logo içeriğindeki payı (0–1); saydam ve arka plan pikselleri hariç */
  share: number;
}

export interface LogoAnalysis {
  swatches: LogoSwatch[];
  /** Kenarlardan algılanan düz arka plan (ör. beyaz zeminli JPEG); renklerden çıkarıldı */
  background: string | null;
  hasTransparency: boolean;
  /** İçeriğin (saydam/arka plan olmayan) sınır kutusu; kenar boşluklarını kırpmak için */
  bounds: { x: number; y: number; width: number; height: number } | null;
  /** Logonun genel tonu: zemin önerisi için ('light' → koyu zemin önerilir) */
  tone: 'light' | 'dark' | 'mixed';
}

const ALPHA_MIN = 128;

/** "redmean" ağırlıklı RGB uzaklığı (algıya Öklid'den daha yakın, hızlı) */
function colorDistance(a: Rgb, b: Rgb): number {
  const rm = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

const bucketOf = (r: number, g: number, b: number) => ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);

/**
 * RGBA pikselleri (satır satır, piksel başına 4 bayt) → logo renkleri.
 * Küçültülmüş görüntüde (ör. 96×96) çalıştırılması yeterlidir.
 */
export function analyzeLogoPixels(rgba: ArrayLike<number>, width: number, height: number): LogoAnalysis {
  const n = width * height;
  if (!(width > 0 && height > 0) || rgba.length < n * 4) throw new Error('Görüntü verisi eksik.');
  const px = (i: number): Rgb => ({ r: rgba[i * 4]!, g: rgba[i * 4 + 1]!, b: rgba[i * 4 + 2]! });
  const opaque = (i: number) => rgba[i * 4 + 3]! >= ALPHA_MIN;

  // 1) Kenar pikselleri: çoğu saydamsa saydam logo; çoğu tek renk opaksa o renk arka plandır
  const border: number[] = [];
  for (let x = 0; x < width; x++) border.push(x, (height - 1) * width + x);
  for (let y = 1; y < height - 1; y++) border.push(y * width, y * width + width - 1);
  let transparentBorder = 0;
  const borderBuckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (const i of border) {
    if (!opaque(i)) {
      transparentBorder++;
      continue;
    }
    const c = px(i);
    const k = bucketOf(c.r, c.g, c.b);
    const e = borderBuckets.get(k) ?? { count: 0, r: 0, g: 0, b: 0 };
    e.count++;
    e.r += c.r;
    e.g += c.g;
    e.b += c.b;
    borderBuckets.set(k, e);
  }
  let hasTransparency = transparentBorder > 0;
  let background: Rgb | null = null;
  const opaqueBorder = border.length - transparentBorder;
  if (opaqueBorder >= border.length * 0.6) {
    const top = [...borderBuckets.values()].sort((a, b) => b.count - a.count)[0];
    if (top && top.count >= opaqueBorder * 0.6) background = { r: top.r / top.count, g: top.g / top.count, b: top.b / top.count };
  }

  // 2) İçerik pikselleri: opak ve arka plandan ayırt edilebilir
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let content = 0;
  let lumSum = 0;
  for (let i = 0; i < n; i++) {
    if (!opaque(i)) {
      hasTransparency = true;
      continue;
    }
    const c = px(i);
    if (background && colorDistance(c, background) < 60) continue;
    content++;
    const x = i % width;
    const y = (i - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    lumSum += luminance(rgbToHex(c));
    const k = bucketOf(c.r, c.g, c.b);
    const e = buckets.get(k) ?? { count: 0, r: 0, g: 0, b: 0 };
    e.count++;
    e.r += c.r;
    e.g += c.g;
    e.b += c.b;
    buckets.set(k, e);
  }

  const bgHex = background ? rgbToHex(background) : null;
  if (content < Math.max(12, n * 0.002)) {
    return { swatches: [], background: bgHex, hasTransparency, bounds: null, tone: 'mixed' };
  }

  // 3) Yakın renkleri birleştir (en kalabalıktan başlayarak), küçük kümeleri (kenar yumuşatma) at
  const clusters: { count: number; r: number; g: number; b: number }[] = [];
  for (const e of [...buckets.values()].sort((a, b) => b.count - a.count)) {
    const c = { r: e.r / e.count, g: e.g / e.count, b: e.b / e.count };
    const near = clusters.find((k) => colorDistance({ r: k.r / k.count, g: k.g / k.count, b: k.b / k.count }, c) < 70);
    if (near) {
      near.count += e.count;
      near.r += e.r;
      near.g += e.g;
      near.b += e.b;
    } else {
      clusters.push({ ...e });
    }
  }
  const swatches = clusters
    .map((k) => ({ color: rgbToHex({ r: k.r / k.count, g: k.g / k.count, b: k.b / k.count }), share: k.count / content }))
    .filter((s) => s.share >= 0.02)
    .sort((a, b) => b.share - a.share)
    .slice(0, 6)
    .map((s) => ({ color: s.color, share: Math.round(s.share * 1000) / 1000 }));

  const avgLum = lumSum / content;
  return {
    swatches,
    background: bgHex,
    hasTransparency,
    bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    tone: avgLum > 0.6 ? 'light' : avgLum < 0.2 ? 'dark' : 'mixed',
  };
}

export interface PaletteProposal {
  palette: BrandPalette;
  /** Ana renk logodan mı geldi, yoksa logodaki renkten mi türetildi */
  sources: Record<BasePaletteKey, 'logo' | 'derived'>;
  /** Kaç farklı öneri üretilebilir ("Başka öneri" düğmesi için) */
  variants: number;
}

const isChromatic = (h: Hsl) => h.s >= 0.22 && h.l >= 0.12 && h.l <= 0.9;

/**
 * Logo renklerinden palet önerisi. `variant` arttıkça ana renk sıradaki adaya geçer
 * (logoda birden çok belirgin renk varsa "Başka öneri").
 */
export function proposePalette(swatches: readonly LogoSwatch[], variant = 0): PaletteProposal {
  if (!swatches.length) throw new Error('Logoda renk bulunamadı.');
  const items = swatches.map((s) => ({ ...s, hsl: hexToHsl(s.color) }));
  const chromatic = items.filter((s) => isChromatic(s.hsl)).sort((a, b) => b.share * (0.6 + b.hsl.s) - a.share * (0.6 + a.hsl.s));
  const neutrals = items.filter((s) => !isChromatic(s.hsl));
  // Renkli aday yoksa (siyah/gri logo) en koyu nötr; o da yoksa en kalabalık renk
  const candidates = chromatic.length ? chromatic : [...neutrals].sort((a, b) => a.hsl.l - b.hsl.l);
  const variants = candidates.length;
  const primaryItem = candidates[variant % variants]!;
  const primary = primaryItem.color;
  const p = primaryItem.hsl;

  const others = items.filter((s) => s !== primaryItem);
  // İkincil: tonu farklı başka bir renk ya da koyu nötr (ör. lacivert yazı); yoksa ana rengin koyusu
  const secondaryItem =
    others.find((s) => isChromatic(s.hsl) && hueDistance(s.hsl.h, p.h) >= 20) ??
    others.find((s) => !isChromatic(s.hsl) && s.hsl.l < 0.35 && Math.abs(s.hsl.l - p.l) > 0.15);
  const secondary = secondaryItem?.color ?? hslToHex({ h: p.h, s: p.s * 0.85, l: clamp01(p.l - 0.2) });
  const s2 = hexToHsl(secondary);
  // Vurgu: ikisinden de farklı bir renk; yoksa ana rengin canlı/açık tonu
  const accentItem = others.find(
    (s) => s !== secondaryItem && isChromatic(s.hsl) && hueDistance(s.hsl.h, p.h) >= 30 && hueDistance(s.hsl.h, s2.h) >= 30,
  );
  const accent = accentItem?.color ?? hslToHex({ h: p.h, s: clamp01(Math.max(p.s, 0.5) + 0.1), l: clamp01(p.l < 0.5 ? p.l + 0.15 : p.l - 0.12) });

  return {
    palette: derivePalette({ primary, secondary, accent }),
    sources: { primary: 'logo', secondary: secondaryItem ? 'logo' : 'derived', accent: accentItem ? 'logo' : 'derived' },
    variants,
  };
}

/** Saydam logo için zemin önerisi: logo açık tonluysa koyu zemin */
export function suggestLogoBackground(a: Pick<LogoAnalysis, 'hasTransparency' | 'tone'>): LogoBackground {
  if (!a.hasTransparency) return 'none';
  return a.tone === 'light' ? 'dark' : 'none';
}

// =====================================================================
// Tema hedefleri ve hazır temalar
// =====================================================================
export const LOGO_BACKGROUNDS = ['none', 'light', 'dark', 'brand'] as const;
export type LogoBackground = (typeof LOGO_BACKGROUNDS)[number];
export const LOGO_BACKGROUND_LABELS: Record<LogoBackground, string> = {
  none: 'Zeminsiz',
  light: 'Açık zemin',
  dark: 'Koyu zemin',
  brand: 'Marka rengi zemin',
};

export interface ThemeTargetDef {
  id: string;
  label: string;
  description: string;
  tokens: readonly PaletteKey[];
}

/** Sıra ve izinli renkler migration'daki public.branding_targets ile aynı (test karşılaştırır) */
export const THEME_TARGETS = [
  { id: 'header', label: 'Üst başlık', description: 'Ekran başlıkları ve geri düğmesinin bulunduğu üst çubuk', tokens: ['surfaceLight', 'surfaceDark', 'primary'] },
  { id: 'tabBar', label: 'Alt gezinme çubuğu', description: 'Bugün, Görevler, Mesajlar… sekmelerinin zemini', tokens: ['surfaceLight', 'surfaceDark', 'primary'] },
  { id: 'navActive', label: 'Seçili sekme ve simgeler', description: 'Etkin sekmenin ve başlıktaki simgelerin rengi', tokens: ['primary', 'secondary', 'accent'] },
  { id: 'hero', label: 'Karşılama alanı', description: 'Bugün ekranının üstündeki şirket ve selamlama alanı', tokens: ['surfaceLight', 'surfaceDark', 'primary'] },
  { id: 'primaryButton', label: 'Ana düğmeler', description: 'Kaydet, Tamamlandı, Gönder gibi ana işlemler', tokens: ['primary', 'secondary', 'accent'] },
  { id: 'secondaryButton', label: 'İkincil düğmeler', description: 'Vazgeç, Düzenle gibi yardımcı işlemler', tokens: ['primary', 'secondary', 'accent'] },
  { id: 'cards', label: 'Kartlar ve paneller', description: 'Kart çerçevesi veya kart zemini', tokens: ['border', 'surfaceLight'] },
  { id: 'links', label: 'Bağlantılar', description: 'Dokunulabilir metinler ve "Tümü" gibi bağlantılar', tokens: ['primary', 'secondary', 'accent'] },
  { id: 'selection', label: 'Seçili durumlar', description: 'Seçili filtre, okunmamış işareti, seçim kutuları', tokens: ['primary', 'secondary', 'accent'] },
  { id: 'forms', label: 'Form alanları', description: 'Yazı alanının odak çerçevesi ve açma/kapama anahtarları', tokens: ['primary', 'secondary', 'accent'] },
  { id: 'badges', label: 'Rozetler ve sayaçlar', description: 'Bilgi rozetleri ve okunmamış sayaçları (durum renkleri değişmez)', tokens: ['primary', 'secondary', 'accent'] },
  { id: 'charts', label: 'Grafik ve ilerleme', description: 'Ekip özeti ve ilerleme çubukları', tokens: ['primary', 'secondary', 'accent'] },
  { id: 'text', label: 'Metin tonları', description: 'Başlık ve açıklama metinleri marka tonunu alır', tokens: ['textPrimary'] },
] as const satisfies readonly ThemeTargetDef[];

export type ThemeTargetId = (typeof THEME_TARGETS)[number]['id'];
export const THEME_TARGET_IDS = THEME_TARGETS.map((t) => t.id) as ThemeTargetId[];

export interface TargetState {
  enabled: boolean;
  token: PaletteKey;
}
export type TargetStates = Record<ThemeTargetId, TargetState>;

export const TOKEN_LABELS: Record<PaletteKey, string> = {
  primary: 'Ana renk',
  secondary: 'İkincil',
  accent: 'Vurgu',
  surfaceLight: 'Açık yüzey',
  surfaceDark: 'Koyu yüzey',
  textPrimary: 'Marka metni',
  textSecondary: 'İkincil metin',
  border: 'Kenarlık',
};

export const BRANDING_PRESETS = ['original', 'recommended', 'light_brand', 'dark_brand'] as const;
export type BrandingPreset = (typeof BRANDING_PRESETS)[number] | 'custom';
export const PRESET_LABELS: Record<BrandingPreset, { label: string; description: string }> = {
  original: { label: 'Uygulamanın kendi teması', description: 'Marka renkleri kullanılmaz; logo yine görünür.' },
  recommended: { label: 'Önerilen', description: 'Düğmeler, seçimler ve bağlantılar marka renginde; zemin sade.' },
  light_brand: { label: 'Açık marka', description: 'Başlık ve gezinme açık marka tonunda; metinler marka tonunda.' },
  dark_brand: { label: 'Koyu marka', description: 'Başlık, gezinme ve karşılama alanı koyu marka renginde; içerik açık kalır.' },
  custom: { label: 'Özel', description: 'Hazır temadan sonra elle değiştirildi.' },
};

function targets(on: Partial<Record<ThemeTargetId, PaletteKey>>): TargetStates {
  const out = {} as TargetStates;
  for (const t of THEME_TARGETS) {
    const token = on[t.id];
    out[t.id] = { enabled: Boolean(token), token: token ?? t.tokens[0] };
  }
  return out;
}

export function presetTargets(preset: (typeof BRANDING_PRESETS)[number]): TargetStates {
  const recommended: Partial<Record<ThemeTargetId, PaletteKey>> = {
    navActive: 'primary',
    hero: 'surfaceLight',
    primaryButton: 'primary',
    secondaryButton: 'primary',
    links: 'primary',
    selection: 'primary',
    forms: 'primary',
    badges: 'primary',
    charts: 'accent',
  };
  switch (preset) {
    case 'original':
      return targets({});
    case 'recommended':
      return targets(recommended);
    case 'light_brand':
      return targets({ ...recommended, header: 'surfaceLight', tabBar: 'surfaceLight', cards: 'border', text: 'textPrimary' });
    case 'dark_brand':
      return targets({ ...recommended, header: 'surfaceDark', tabBar: 'surfaceDark', hero: 'surfaceDark' });
  }
}

/** Hedefler bir hazır temayla birebir aynıysa onun adını, değilse 'custom' döndürür */
export function matchPreset(t: TargetStates): BrandingPreset {
  for (const p of BRANDING_PRESETS) {
    const ref = presetTargets(p);
    if (THEME_TARGET_IDS.every((id) => ref[id].enabled === t[id].enabled && (!t[id].enabled || ref[id].token === t[id].token))) return p;
  }
  return 'custom';
}

// =====================================================================
// Kayıtlı yapılandırma
// =====================================================================
const hex = z.string().regex(HEX_COLOR, 'Renk #rrggbb biçiminde olmalı.');
export const paletteSchema = z.object(Object.fromEntries(PALETTE_KEYS.map((k) => [k, hex])) as Record<PaletteKey, typeof hex>).strict();

const targetStateSchema = z.object({ enabled: z.boolean(), token: z.enum(PALETTE_KEYS) }).strict();

export const brandingConfigSchema = z
  .object({
    logoPath: z.string().nullable(),
    logoBackground: z.enum(LOGO_BACKGROUNDS),
    palette: paletteSchema,
    overrides: paletteSchema.partial(),
    swatches: z.array(z.object({ color: hex, share: z.number().min(0).max(1) }).strict()).max(8),
    targets: z.partialRecord(z.enum(THEME_TARGET_IDS as [ThemeTargetId, ...ThemeTargetId[]]), targetStateSchema).superRefine((v, ctx) => {
      for (const [id, st] of Object.entries(v) as [ThemeTargetId, TargetState][]) {
        const def = THEME_TARGETS.find((t) => t.id === id)!;
        if (!(def.tokens as readonly string[]).includes(st.token)) ctx.addIssue({ code: 'custom', message: `${def.label}: bu renk kullanılamaz.` });
      }
    }),
    preset: z.enum([...BRANDING_PRESETS, 'custom']),
    mode: z.literal('light'),
  })
  .strict();

export type BrandingConfig = z.infer<typeof brandingConfigSchema>;

export interface CompanyBranding extends BrandingConfig {
  companyId: string;
  configVersion: number;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}

/** Eksik hedefleri (sonradan eklenen hedef) kapalı varsayar, bilinmeyenleri yok sayar */
export function normalizeTargets(raw: unknown): TargetStates {
  const base = presetTargets('original');
  if (!raw || typeof raw !== 'object') return base;
  for (const t of THEME_TARGETS) {
    const v = (raw as Record<string, unknown>)[t.id] as Partial<TargetState> | undefined;
    if (v && typeof v.enabled === 'boolean' && typeof v.token === 'string' && (t.tokens as readonly string[]).includes(v.token)) {
      base[t.id] = { enabled: v.enabled, token: v.token as PaletteKey };
    }
  }
  return base;
}

/** Etkin palet: elle değiştirilen renkler önceliklidir; türetilen renkler (yüzey/metin/kenarlık) etkin ana renklerden yeniden hesaplanır */
export function effectivePalette(cfg: Pick<BrandingConfig, 'palette' | 'overrides'>): BrandPalette {
  const o = cfg.overrides ?? {};
  const derived = derivePalette({
    primary: o.primary ?? cfg.palette.primary,
    secondary: o.secondary ?? cfg.palette.secondary,
    accent: o.accent ?? cfg.palette.accent,
  });
  const out = { ...derived };
  for (const k of PALETTE_KEYS) if (o[k]) out[k] = o[k]!;
  return out;
}

/** Varsayılan (marka yok) yapılandırma: düzenleyicinin ilk açılışı */
export function defaultBrandingConfig(): BrandingConfig {
  return {
    logoPath: null,
    logoBackground: 'none',
    palette: { ...APP_PALETTE },
    overrides: {},
    swatches: [],
    targets: presetTargets('original'),
    preset: 'original',
    mode: 'light',
  };
}

// =====================================================================
// Tasarım belirteçleri (bileşenler yalnızca bunları kullanır, ham renk kullanmaz)
// =====================================================================
export interface ThemeTokens {
  brand: { primary: string; secondary: string; accent: string };
  surface: { canvas: string; default: string; muted: string; card: string };
  text: { primary: string; secondary: string; disabled: string; link: string; inverse: string };
  border: { default: string; strong: string; focus: string; card: string };
  action: {
    primary: { bg: string; fg: string };
    secondary: { bg: string; fg: string; border: string };
    danger: { bg: string; fg: string; border: string };
  };
  navigation: {
    headerBg: string;
    headerFg: string;
    headerTint: string;
    headerBorder: string;
    tabBg: string;
    tabBorder: string;
    tabActive: string;
    tabInactive: string;
    statusBar: 'light' | 'dark';
  };
  hero: { bg: string; fg: string; fgMuted: string; border: string; branded: boolean };
  selection: { fg: string; bg: string; border: string };
  badge: { countBg: string; countFg: string };
  chart: { fill: string; track: string };
  status: Record<StatusTone, { fg: string; bg: string; border: string }>;
}

export interface ContrastCheck {
  label: string;
  fg: string;
  bg: string;
  ratio: number;
  min: number;
  ok: boolean;
}

export interface ResolvedTheme {
  tokens: ThemeTokens;
  /** Okunaklılık için yapılan renk düzeltmeleri (kullanıcıya gösterilir) */
  adjustments: string[];
  checks: ContrastCheck[];
}

/** Zemin (başlık / gezinme / karşılama) seçimi → zemin, metin, ikincil metin, kenarlık */
function chrome(bgToken: PaletteKey | null, pal: BrandPalette, fallback: { bg: string; fg: string; fgMuted: string; border: string }) {
  if (!bgToken) return { ...fallback, dark: luminance(fallback.bg) < 0.18 };
  if (bgToken === 'surfaceLight') {
    const bg = pal.surfaceLight;
    return { bg, fg: ensureContrast(pal.textPrimary, bg, 7), fgMuted: ensureContrast(pal.textSecondary, bg, 4.5), border: mix(bg, pal.primary, 0.18), dark: false };
  }
  const fill = ensureFill(bgToken === 'surfaceDark' ? pal.surfaceDark : pal.primary);
  const fgMuted = ensureContrast(mix(fill.fg, fill.bg, 0.25), fill.bg, 4.5);
  return { bg: fill.bg, fg: fill.fg, fgMuted, border: fill.bg, dark: fill.fg === WHITE };
}

/**
 * Yapılandırma → tasarım belirteçleri. `null` veya tüm hedefler kapalıysa uygulamanın kendi teması.
 * Aynı fonksiyon hem gerçek uygulamada hem düzenleyicinin canlı önizlemesinde kullanılır.
 */
export function resolveTheme(cfg: Pick<BrandingConfig, 'palette' | 'overrides' | 'targets'> | null): ResolvedTheme {
  const pal = cfg ? effectivePalette(cfg) : APP_PALETTE;
  const t = cfg ? normalizeTargets(cfg.targets) : presetTargets('original');
  const adjustments: string[] = [];
  const pick = (id: ThemeTargetId): PaletteKey | null => (t[id].enabled ? t[id].token : null);
  const color = (id: ThemeTargetId): string | null => {
    const k = pick(id);
    return k ? pal[k] : null;
  };
  const note = (label: string, from: string, to: string) => {
    if (from !== to) adjustments.push(`${label}: okunaklılık için ${from} yerine ${to} kullanıldı.`);
  };

  // Metin ve yüzeyler
  const cardsToken = pick('cards');
  const canvas = APP_COLORS.canvas;
  const surface = APP_COLORS.surface;
  const card = cardsToken === 'surfaceLight' ? pal.surfaceLight : surface;
  const cardBorder = cardsToken === 'border' ? pal.border : cardsToken === 'surfaceLight' ? mix(pal.surfaceLight, pal.primary, 0.16) : APP_COLORS.border;
  const textOn = pick('text');
  const worstLight = [canvas, surface, card].reduce((w, c) => (luminance(c) < luminance(w) ? c : w));
  const textPrimary = textOn ? ensureContrast(pal.textPrimary, worstLight, 7) : APP_COLORS.text;
  const textSecondary = textOn ? ensureContrast(pal.textSecondary, worstLight, 4.5) : APP_COLORS.textSecondary;
  if (textOn) {
    note('Ana metin', pal.textPrimary, textPrimary);
    note('İkincil metin', pal.textSecondary, textSecondary);
  }

  // Eylemler
  const pbRequested = color('primaryButton') ?? APP_COLORS.brand;
  const pb = ensureFill(pbRequested);
  if (color('primaryButton')) note('Ana düğme', pbRequested, pb.bg);
  const sbColor = color('secondaryButton');
  const sbFg = sbColor ? ensureContrast(sbColor, surface, 4.5) : textPrimary;
  if (sbColor) note('İkincil düğme metni', sbColor, sbFg);

  const linkReq = color('links') ?? APP_COLORS.brand;
  const link = ensureContrast(linkReq, worstLight, 4.5);
  if (color('links')) note('Bağlantı', linkReq, link);

  const selReq = color('selection') ?? APP_COLORS.brand;
  const selBg = mix(surface, selReq, 0.1);
  const selFg = ensureContrast(selReq, selBg, 4.5);
  if (color('selection')) note('Seçili durum', selReq, selFg);

  const focusReq = color('forms') ?? APP_COLORS.brand;
  const focus = ensureContrast(focusReq, surface, 3);
  if (color('forms')) note('Form odağı', focusReq, focus);

  const badgeReq = color('badges');
  const count = ensureFill(badgeReq ?? APP_COLORS.brand);
  const info = badgeReq
    ? (() => {
        const bg = mix(surface, badgeReq, 0.12);
        const fg = ensureContrast(badgeReq, bg, 4.5);
        note('Bilgi rozeti', badgeReq, fg);
        return { fg, bg, border: mix(surface, badgeReq, 0.35) };
      })()
    : { ...STATUS_COLORS.info };

  const chartReq = color('charts') ?? APP_COLORS.brand;
  const chartFill = ensureContrast(chartReq, surface, 3);
  if (color('charts')) note('Grafik', chartReq, chartFill);

  // Üst başlık, alt gezinme, karşılama alanı
  const header = chrome(pick('header'), pal, { bg: surface, fg: textPrimary, fgMuted: textSecondary, border: APP_COLORS.border });
  const tab = chrome(pick('tabBar'), pal, { bg: surface, fg: textPrimary, fgMuted: textSecondary, border: APP_COLORS.border });
  const hero = chrome(pick('hero'), pal, { bg: canvas, fg: textPrimary, fgMuted: textSecondary, border: canvas });

  const activeReq = color('navActive') ?? APP_COLORS.brand;
  // Koyu/renkli zeminde seçili sekme beyaz (veya koyu) metinle, açık zeminde marka rengiyle gösterilir
  const tabActive = tab.dark || pick('tabBar') === 'primary' ? tab.fg : ensureContrast(activeReq, tab.bg, 4.5);
  const headerTint = header.dark || pick('header') === 'primary' ? header.fg : ensureContrast(activeReq, header.bg, 4.5);
  if (color('navActive') && !tab.dark) note('Seçili sekme', activeReq, tabActive);
  const tabInactive = ensureContrast(mix(tab.fg, tab.bg, 0.3), tab.bg, 4.5);

  const tokens: ThemeTokens = {
    brand: { primary: pal.primary, secondary: pal.secondary, accent: pal.accent },
    surface: { canvas, default: surface, muted: APP_COLORS.surfaceMuted, card },
    text: { primary: textPrimary, secondary: textSecondary, disabled: APP_COLORS.textDisabled, link, inverse: WHITE },
    border: { default: APP_COLORS.border, strong: APP_COLORS.borderStrong, focus, card: cardBorder },
    action: {
      primary: { bg: pb.bg, fg: pb.fg },
      secondary: { bg: surface, fg: sbFg, border: sbColor ? mix(surface, sbFg, 0.4) : APP_COLORS.borderStrong },
      danger: { bg: surface, fg: STATUS_COLORS.danger.fg, border: STATUS_COLORS.danger.border },
    },
    navigation: {
      headerBg: header.bg,
      headerFg: header.fg,
      headerTint,
      headerBorder: header.border,
      tabBg: tab.bg,
      tabBorder: tab.border,
      tabActive,
      tabInactive,
      statusBar: header.dark ? 'light' : 'dark',
    },
    hero: { bg: hero.bg, fg: hero.fg, fgMuted: hero.fgMuted, border: hero.border, branded: Boolean(pick('hero')) },
    selection: { fg: selFg, bg: selBg, border: selFg },
    badge: { countBg: count.bg, countFg: count.fg },
    chart: { fill: chartFill, track: APP_COLORS.surfaceMuted },
    status: { ...STATUS_COLORS, info },
  };
  return { tokens, adjustments, checks: contrastChecks(tokens) };
}

/** Düzenleyicide gösterilen ve testlerde zorlanan kontrast çiftleri */
export function contrastChecks(k: ThemeTokens): ContrastCheck[] {
  const pairs: [string, string, string, number][] = [
    ['Ana metin / zemin', k.text.primary, k.surface.canvas, 4.5],
    ['Ana metin / kart', k.text.primary, k.surface.card, 4.5],
    ['İkincil metin / zemin', k.text.secondary, k.surface.canvas, 4.5],
    ['İkincil metin / kart', k.text.secondary, k.surface.card, 4.5],
    ['Ana düğme', k.action.primary.fg, k.action.primary.bg, 4.5],
    ['İkincil düğme', k.action.secondary.fg, k.action.secondary.bg, 4.5],
    ['Bağlantı', k.text.link, k.surface.card, 4.5],
    ['Seçili durum', k.selection.fg, k.selection.bg, 4.5],
    ['Form odak çerçevesi', k.border.focus, k.surface.default, 3],
    ['Üst başlık', k.navigation.headerFg, k.navigation.headerBg, 4.5],
    ['Başlık simgeleri', k.navigation.headerTint, k.navigation.headerBg, 4.5],
    ['Seçili sekme', k.navigation.tabActive, k.navigation.tabBg, 4.5],
    ['Seçili olmayan sekme', k.navigation.tabInactive, k.navigation.tabBg, 4.5],
    ['Karşılama metni', k.hero.fg, k.hero.bg, 4.5],
    ['Karşılama ikincil metni', k.hero.fgMuted, k.hero.bg, 4.5],
    ['Sayaç rozeti', k.badge.countFg, k.badge.countBg, 4.5],
    ['Bilgi rozeti', k.status.info.fg, k.status.info.bg, 4.5],
    ['Grafik', k.chart.fill, k.surface.card, 3],
  ];
  return pairs.map(([label, fg, bg, min]) => {
    const ratio = Math.round(contrastRatio(fg, bg) * 100) / 100;
    return { label, fg, bg, ratio, min, ok: ratio >= min };
  });
}
