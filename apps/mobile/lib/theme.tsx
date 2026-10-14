/**
 * Tasarım sistemi: ölçekler (aralık, köşe, yazı) + şirket temasından çözülen renk belirteçleri.
 *
 * - Bileşenler ham renk yazmaz; `useTheme()` ile belirteç (`t`) ve hazır stilleri (`s`) alır.
 * - Şirket teması CompanyProvider ile birlikte yüklenir (yüklenene kadar yükleme ekranı gösterilir;
 *   yanlış temanın bir an görünmesi olmaz). Tema alınamazsa uygulamanın kendi teması kullanılır.
 * - Düzenleyicinin canlı önizlemesi aynı bileşenleri `ThemeScope` içinde taslak temayla çizer.
 */
import {
  APP_PALETTE,
  effectivePalette,
  resolveTheme,
  type BrandPalette,
  type BrandingConfig,
  type LogoBackground,
  type ResolvedTheme,
  type ThemeTokens,
} from '@istakip/shared';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';

/** 8 puanlık ızgara (gerektiğinde 4'lük ara adım) */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
/** Yazı ölçeği: başlık, bölüm, gövde, ikincil, sıkışık etiket (rozet/sekme) */
export const font = { title: 28, heading: 20, body: 17, secondary: 16, caption: 14 } as const;
/** En küçük dokunma alanı */
export const TOUCH = 48;
/** Büyük ekranda içerik genişliği sınırı */
export const CONTENT_MAX = 720;

export function makeStyles(t: ThemeTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.surface.canvas },
    // Tablette satırlar fazla uzamasın: içerik en fazla 720 pt, ortada
    content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl, width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center' },
    list: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl, width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center' },
    title: { fontSize: font.title, lineHeight: 34, fontWeight: '700', color: t.text.primary, letterSpacing: -0.3 },
    heading: { fontSize: font.heading, lineHeight: 26, fontWeight: '700', color: t.text.primary },
    body: { fontSize: font.body, lineHeight: 24, color: t.text.primary },
    strong: { fontSize: font.body, lineHeight: 24, fontWeight: '600', color: t.text.primary },
    muted: { fontSize: font.secondary, lineHeight: 22, color: t.text.secondary },
    caption: { fontSize: font.caption, lineHeight: 18, fontWeight: '600', color: t.text.secondary },
    link: { fontSize: font.secondary, lineHeight: 22, fontWeight: '600', color: t.text.link },
    label: { fontSize: font.secondary, lineHeight: 22, fontWeight: '600', color: t.text.primary, marginBottom: space.xs },
    card: {
      backgroundColor: t.surface.card,
      borderColor: t.border.card,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderRadius: radius.lg,
      padding: space.lg,
    },
    divider: { height: StyleSheet.hairlineWidth * 2, backgroundColor: t.border.default },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
    input: {
      minHeight: TOUCH,
      borderWidth: 1,
      borderColor: t.border.strong,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm + 2,
      fontSize: font.body,
      color: t.text.primary,
      backgroundColor: t.surface.default,
    },
  });
}
export type Styles = ReturnType<typeof makeStyles>;

export interface Theme {
  t: ThemeTokens;
  s: Styles;
  resolved: ResolvedTheme;
  /** Etkin marka paleti (logo zemini gibi hedef dışı kullanımlar için) */
  palette: BrandPalette;
  logo: { path: string | null; background: LogoBackground };
}

function build(cfg: Pick<BrandingConfig, 'palette' | 'overrides' | 'targets' | 'logoPath' | 'logoBackground'> | null): Theme {
  const resolved = resolveTheme(cfg);
  return {
    t: resolved.tokens,
    s: makeStyles(resolved.tokens),
    resolved,
    palette: cfg ? effectivePalette(cfg) : APP_PALETTE,
    logo: { path: cfg?.logoPath ?? null, background: cfg?.logoBackground ?? 'none' },
  };
}

const DEFAULT_THEME = build(null);
const Ctx = createContext<Theme>(DEFAULT_THEME);

/** Uygulamanın teması. `branding` null ise (kayıt yok, alınamadı, giriş ekranı) kendi teması. */
export function ThemeProvider({
  branding,
  cacheKey,
  children,
}: {
  branding: Parameters<typeof build>[0];
  /** Tema yalnızca bu değer değişince yeniden çözülür (şirket + sürüm) */
  cacheKey: string;
  children: ReactNode;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const theme = useMemo(() => (branding ? build(branding) : DEFAULT_THEME), [cacheKey]);
  return <Ctx.Provider value={theme}>{children}</Ctx.Provider>;
}

/** Canlı önizleme: içindeki gerçek bileşenler taslak temayla çizilir; uygulamanın geri kalanı etkilenmez */
export function ThemeScope({ config, children }: { config: Parameters<typeof build>[0]; children: ReactNode }) {
  const theme = useMemo(() => build(config), [config]);
  return <Ctx.Provider value={theme}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
