/**
 * Şirket logosu: özel depodan kısa süreli imzalı bağlantıyla gelir, seçilen zeminde gösterilir.
 * Logo yoksa veya yüklenemezse şirket adının baş harfleri gösterilir (uygulama hiçbir zaman boş kalmaz).
 */
import { luminance, signBrandLogoUrl, type LogoBackground } from '@istakip/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { keys } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, useTheme } from '@/lib/theme';

export function useBrandLogoUrl(path: string | null) {
  return useQuery({
    queryKey: keys.brandLogo(path ?? '-'),
    queryFn: () => signBrandLogoUrl(supabase, path!, 3600),
    enabled: Boolean(path),
    // İmzalı bağlantı 1 saat geçerli; süresi dolmadan yenilenir
    staleTime: 45 * 60_000,
    gcTime: 50 * 60_000,
    retry: 1,
  });
}

export function plateColor(bg: LogoBackground, palette: { surfaceDark: string; primary: string }): string | null {
  if (bg === 'light') return '#ffffff';
  if (bg === 'dark') return palette.surfaceDark;
  if (bg === 'brand') return palette.primary;
  return null;
}

export function BrandLogo({
  name,
  height = 40,
  maxWidth = 168,
  uri: localUri,
  path: pathOverride,
  background: bgOverride,
  surface,
}: {
  name: string;
  height?: number;
  maxWidth?: number;
  /** Henüz yüklenmemiş yerel önizleme görüntüsü */
  uri?: string | null;
  path?: string | null;
  background?: LogoBackground;
  /** Logonun üstünde durduğu yüzey; koyuysa ve zemin seçilmemişse logo okunsun diye açık zemin konur */
  surface?: string;
}) {
  const { t, logo, palette } = useTheme();
  const path = pathOverride !== undefined ? pathOverride : logo.path;
  const background = bgOverride ?? logo.background;
  const url = useBrandLogoUrl(localUri ? null : path);
  const [failed, setFailed] = useState<string | null>(null);
  // Logonun en/boy oranı yüklenince öğrenilir; geniş logolar genişliğine, kare logolar karesine sığar
  const [aspect, setAspect] = useState(1);
  const src = localUri ?? url.data ?? null;
  const plate = plateColor(background, palette) ?? (surface && luminance(surface) < 0.2 ? '#ffffff' : null);
  // En/boy oranı (web ve telefonda aynı yolla); öğrenilene kadar kare
  useEffect(() => {
    if (!src) return;
    let alive = true;
    Image.getSize(
      src,
      (w, h) => alive && w > 0 && h > 0 && setAspect(w / h),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [src]);
  const pad = plate ? Math.round(height * 0.16) : 0;
  const inner = height - pad * 2;

  if (!src || failed === src) {
    const initials = name
      .split(/\s+/)
      .filter((w) => /\p{L}/u.test(w[0] ?? ''))
      .slice(0, 2)
      .map((w) => w[0]!.toLocaleUpperCase('tr'))
      .join('');
    return (
      <View
        style={{ width: height, height, borderRadius: radius.md, backgroundColor: t.selection.bg, alignItems: 'center', justifyContent: 'center' }}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        <Text style={{ color: t.selection.fg, fontWeight: '800', fontSize: height * 0.4 }} maxFontSizeMultiplier={1.1}>
          {initials || '•'}
        </Text>
      </View>
    );
  }
  return (
    <View
      style={{ backgroundColor: plate ?? 'transparent', borderRadius: radius.md, padding: pad, alignSelf: 'flex-start' }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${name} logosu`}
    >
      <Image
        source={{ uri: src }}
        onError={() => setFailed(src)}
        resizeMode="contain"
        style={{ height: inner, width: Math.min(maxWidth - pad * 2, inner * aspect) }}
      />
    </View>
  );
}
