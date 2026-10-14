/**
 * Marka ve görünüm (Profil → Şirket → Marka ve görünüm). Yalnızca branding.manage (sahip, tam yetkili yönetici);
 * asıl yetki ve şirket sınırı save_company_branding / depo politikalarında zorlanır.
 *
 * Akış: 1 Logo → 2 Renk paleti (logodan çıkarılır, düzenlenebilir) → 3 Hazır tema → 4 Bölümler → 5 Önizleme → Kaydet / Vazgeç.
 * Kaydedilene kadar değişiklikler yalnızca bu ekrandaki önizlemededir (ThemeScope); uygulamanın geri kalanı etkilenmez.
 */
import {
  APP_PALETTE,
  BRANDING_PRESETS,
  LOGO_BACKGROUNDS,
  LOGO_BACKGROUND_LABELS,
  PALETTE_KEYS,
  PALETTE_LABELS,
  PRESET_LABELS,
  THEME_TARGETS,
  TOKEN_LABELS,
  contrastRatio,
  defaultBrandingConfig,
  effectivePalette,
  hexToHsl,
  hslToHex,
  matchPreset,
  normalizeHex,
  presetTargets,
  proposePalette,
  removeBrandLogo,
  resetCompanyBranding,
  resolveTheme,
  saveCompanyBranding,
  suggestLogoBackground,
  toAppError,
  uploadBrandLogo,
  type BasePaletteKey,
  type BrandingConfig,
  type BrandingPreset,
  type CompanyBranding,
  type PaletteKey,
  type Task,
  type ThemeTargetId,
} from '@istakip/shared';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { Stack, router, useNavigation } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BrandLogo } from '@/components/brand-logo';
import { TaskRow } from '@/components/task-row';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CountBadge,
  Empty,
  ErrorView,
  Field,
  Icon,
  Loading,
  Message,
  ProgressBar,
  Segmented,
  ToggleRow,
  type IconName,
} from '@/components/ui';
import { pickLogoFromFiles, pickLogoFromPhotos, toArrayBuffer, type PreparedLogo } from '@/lib/brand-image';
import { useCompany } from '@/lib/company';
import { confirmAction } from '@/lib/confirm';
import { keys } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { ThemeScope, radius, space, useTheme } from '@/lib/theme';

type Flash = { kind: 'error' | 'success' | 'info'; text: string; conflict?: boolean } | null;

const toConfig = (b: CompanyBranding): BrandingConfig => ({
  logoPath: b.logoPath,
  logoBackground: b.logoBackground,
  palette: b.palette,
  overrides: b.overrides,
  swatches: b.swatches,
  targets: b.targets,
  preset: b.preset,
  mode: b.mode,
});

export default function BrandingScreen() {
  const c = useCompany();
  const { s } = useTheme();
  const qc = useQueryClient();
  const [flash, setFlash] = useState<Flash>(null);

  if (!c.can('branding.manage')) {
    return (
      <View style={[s.screen, s.content]}>
        <Stack.Screen options={{ title: 'Marka ve görünüm' }} />
        <Empty
          icon="lock-closed-outline"
          title="Bu ayarı değiştirme yetkiniz yok"
          text="Şirket logosu ve uygulama renklerini yalnızca şirket sahibi ve tam yetkili yöneticiler değiştirebilir."
          action={<Button title="Geri dön" icon="arrow-back" variant="secondary" onPress={() => router.back()} />}
        />
      </View>
    );
  }
  if (c.brandingError) {
    return (
      <View style={[s.screen, s.content]}>
        <ErrorView
          message={`Şirket teması alınamadı: ${toAppError(c.brandingError).message}`}
          onRetry={() => void qc.invalidateQueries({ queryKey: keys.branding(c.companyId ?? '-') })}
        />
      </View>
    );
  }
  if (c.loading) return <Loading label="Tema yükleniyor…" />;
  // Kayıt değişince (bizim veya başka yöneticinin kaydı) taslak yeniden kurulur
  return <Editor key={`${c.companyId}:${c.branding?.version ?? 0}`} saved={c.branding} flash={flash} setFlash={setFlash} />;
}

function Editor({ saved, flash, setFlash }: { saved: CompanyBranding | null; flash: Flash; setFlash: (f: Flash) => void }) {
  const c = useCompany();
  const { t, s } = useTheme();
  const qc = useQueryClient();
  const navigation = useNavigation();
  const initial = useMemo<BrandingConfig>(() => (saved ? toConfig(saved) : defaultBrandingConfig()), [saved]);
  const [draft, setDraft] = useState<BrandingConfig>(initial);
  const [newLogo, setNewLogo] = useState<PreparedLogo | null>(null);
  const [variant, setVariant] = useState(0);
  const [sources, setSources] = useState<Record<BasePaletteKey, 'logo' | 'derived'> | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [saving, setSaving] = useState<null | 'upload' | 'save' | 'reset'>(null);
  const [editingKey, setEditingKey] = useState<PaletteKey | null>(null);
  // Kısa ekranda (küçük telefon, yatay) yapışık önizleme içeriği örtmesin: kapalı başlar, istenince açılır
  const { height: screenHeight } = useWindowDimensions();
  const [previewOpen, setPreviewOpen] = useState(screenHeight >= 640);

  const dirty = newLogo !== null || JSON.stringify(draft) !== JSON.stringify(initial);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const leaving = useRef(false);

  // Kaydedilmemiş değişiklik varken ekrandan çıkmadan önce sor (geri düğmesi, kaydırma hareketi, Vazgeç)
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (!dirtyRef.current || leaving.current) return;
        e.preventDefault();
        void confirmAction({
          title: 'Değişiklikler kaydedilmedi',
          message: 'Logo ve renklerde yaptığınız değişiklikler kaybolacak.',
          confirm: 'Kaydetmeden çık',
          cancel: 'Düzenlemeye devam et',
          destructive: true,
        }).then((ok) => {
          if (!ok) return;
          leaving.current = true;
          navigation.dispatch(e.data.action);
        });
      }),
    [navigation],
  );

  const palette = effectivePalette(draft);
  const preview = useMemo(() => ({ ...draft }), [draft]);
  const resolved = useMemo(() => resolveTheme(draft), [draft]);
  const failing = resolved.checks.filter((x) => !x.ok);
  const companyName = c.active?.company.name ?? 'Şirket';
  const hasLogo = Boolean(newLogo || draft.logoPath);

  const patch = (p: Partial<BrandingConfig>) => setDraft((d) => ({ ...d, ...p }));

  async function pick(from: 'photos' | 'files') {
    setFlash(null);
    const r = await (from === 'photos' ? pickLogoFromPhotos : pickLogoFromFiles)(setStep);
    setStep(null);
    if (!r.ok) {
      if ('error' in r) setFlash({ kind: 'error', text: r.error });
      return;
    }
    const proposal = proposePalette(r.logo.analysis.swatches, 0);
    setNewLogo(r.logo);
    setVariant(0);
    setSources(proposal.sources);
    setDraft((d) => ({
      ...d,
      palette: proposal.palette,
      overrides: {},
      swatches: r.logo.analysis.swatches,
      logoBackground: suggestLogoBackground(r.logo.analysis),
      // Marka henüz hiç uygulanmamışsa önerilen temayla başla (önizlemede; kaydetmeden etkisi yok)
      ...(d.preset === 'original' ? { targets: presetTargets('recommended'), preset: 'recommended' as const } : {}),
    }));
    setFlash({
      kind: 'success',
      text: `Logo hazır${r.logo.trimmed ? ', boş kenarları kırpıldı' : ''}. Renkler logodan çıkarıldı; aşağıda inceleyip değiştirebilirsiniz. Kaydedene kadar kimse görmez.`,
    });
  }

  function removeLogo() {
    setNewLogo(null);
    patch({ logoPath: null, logoBackground: 'none' });
  }

  function regenerate() {
    if (!draft.swatches.length) return;
    const next = variant + 1;
    const p = proposePalette(draft.swatches, next);
    setVariant(next);
    setSources(p.sources);
    patch({ palette: p.palette, overrides: {} });
  }

  function resetToExtracted() {
    if (draft.swatches.length) {
      const p = proposePalette(draft.swatches, 0);
      setVariant(0);
      setSources(p.sources);
      patch({ palette: p.palette, overrides: {} });
    } else {
      patch({ palette: { ...APP_PALETTE }, overrides: {} });
    }
    setEditingKey(null);
  }

  function setOverride(k: PaletteKey, hex: string | null) {
    setDraft((d) => {
      const overrides = { ...d.overrides };
      if (hex) overrides[k] = hex;
      else delete overrides[k];
      return { ...d, overrides };
    });
  }

  function setTarget(id: ThemeTargetId, next: Partial<{ enabled: boolean; token: PaletteKey }>) {
    setDraft((d) => {
      const targets = { ...d.targets, [id]: { ...d.targets[id]!, ...next } };
      return { ...d, targets, preset: matchPreset(targets as never) };
    });
  }

  function choosePreset(p: (typeof BRANDING_PRESETS)[number]) {
    patch({ targets: presetTargets(p), preset: p });
  }

  async function save() {
    setFlash(null);
    let uploaded: string | null = null;
    try {
      let logoPath = draft.logoPath;
      if (newLogo) {
        setSaving('upload');
        uploaded = await uploadBrandLogo(supabase, c.companyId!, Crypto.randomUUID(), toArrayBuffer(newLogo.bytes));
        logoPath = uploaded;
      }
      setSaving('save');
      const res = await saveCompanyBranding(supabase, c.companyId!, { ...draft, logoPath }, saved?.version ?? null);
      // Değiştirilen eski logo artık kullanılmıyor: depodan silinir (politika kullanılanı silmeye izin vermez)
      if (saved?.logoPath && saved.logoPath !== res.logoPath) void removeBrandLogo(supabase, saved.logoPath);
      leaving.current = true;
      setFlash({ kind: 'success', text: 'Tema kaydedildi. Şirketinizdeki herkesin uygulaması yeni görünüme geçer.' });
      qc.setQueryData(keys.branding(c.companyId!), res);
    } catch (e) {
      // Yüklenip kaydedilemeyen logo depoda sahipsiz kalmasın
      if (uploaded) void removeBrandLogo(supabase, uploaded);
      const err = toAppError(e);
      setFlash({ kind: 'error', text: err.message, conflict: err.code === 'conflict' });
    } finally {
      setSaving(null);
    }
  }

  async function cancel() {
    if (!dirty) return router.back();
    const ok = await confirmAction({
      title: 'Değişiklikler silinsin mi?',
      message: 'Kaydedilmemiş logo ve renk değişiklikleri kaybolacak.',
      confirm: 'Değişiklikleri sil',
      destructive: true,
    });
    if (!ok) return;
    leaving.current = true;
    router.back();
  }

  async function resetAll() {
    const ok = await confirmAction({
      title: 'Uygulamanın kendi temasına dönülsün mü?',
      message: 'Logo ve marka renkleri şirketinizdeki herkes için kaldırılır. Bu işlem geri alınamaz; logoyu yeniden yüklemeniz gerekir.',
      confirm: 'Temayı sıfırla',
      destructive: true,
    });
    if (!ok) return;
    setSaving('reset');
    setFlash(null);
    try {
      await resetCompanyBranding(supabase, c.companyId!, saved?.version ?? null);
      leaving.current = true;
      setFlash({ kind: 'success', text: 'Uygulamanın kendi temasına dönüldü.' });
      qc.setQueryData(keys.branding(c.companyId!), null);
    } catch (e) {
      const err = toAppError(e);
      setFlash({ kind: 'error', text: err.message, conflict: err.code === 'conflict' });
    } finally {
      setSaving(null);
    }
  }

  const busy = saving !== null || step !== null;

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ title: 'Marka ve görünüm', gestureEnabled: !dirty }} />
      <ScrollView stickyHeaderIndices={[0]} contentContainerStyle={{ paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
        {/* Yapışık canlı önizleme: her değişiklik anında burada görünür */}
        <View style={{ backgroundColor: t.surface.canvas, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: t.border.default }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: previewOpen }}
            accessibilityLabel={previewOpen ? 'Canlı önizlemeyi gizle' : 'Canlı önizlemeyi göster'}
            onPress={() => setPreviewOpen((v) => !v)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 36 }}
          >
            <Icon name="eye-outline" size={18} />
            <Text style={[s.caption, { flex: 1 }]}>Canlı önizleme{dirty ? ' · kaydedilmedi' : ''}</Text>
            <Icon name={previewOpen ? 'chevron-up' : 'chevron-down'} size={18} />
          </Pressable>
          {previewOpen ? (
            <ThemeScope config={preview}>
              <MiniPreview companyName={companyName} logoUri={newLogo?.uri ?? null} />
            </ThemeScope>
          ) : null}
        </View>

        <View style={s.content}>
          <Text style={s.muted}>
            Logonuzu yükleyin; renkler logodan otomatik çıkarılır. Hangi bölümlerin marka rengini kullanacağını seçin. Kaydedene kadar
            değişiklikleri yalnızca siz görürsünüz.
          </Text>
          {flash ? (
            <View style={{ gap: space.sm }}>
              <Message kind={flash.kind} text={flash.text} />
              {flash.conflict ? (
                <Button
                  title="Güncel ayarları yükle"
                  icon="refresh"
                  variant="secondary"
                  onPress={() => {
                    leaving.current = true;
                    setFlash(null);
                    void qc.invalidateQueries({ queryKey: keys.branding(c.companyId ?? '-') });
                  }}
                />
              ) : null}
            </View>
          ) : null}

          {/* 1. Logo */}
          <Section n={1} title="Logo" icon="image-outline">
            {step ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.lg }} accessibilityLiveRegion="polite">
                <ActivityIndicator color={t.text.link} />
                <Text style={s.body}>{step}</Text>
              </View>
            ) : hasLogo ? (
              <View style={{ gap: space.md }}>
                <View
                  style={{
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 120,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: t.border.default,
                    backgroundColor: t.surface.muted,
                    padding: space.lg,
                  }}
                >
                  <ThemeScope config={preview}>
                    <BrandLogo name={companyName} height={88} maxWidth={260} uri={newLogo?.uri ?? null} path={newLogo ? null : draft.logoPath} />
                  </ThemeScope>
                </View>
                {newLogo ? (
                  <Text style={s.caption}>
                    Yeni logo · PNG {newLogo.width}×{newLogo.height} px{newLogo.trimmed ? ' · boş kenarlar kırpıldı' : ''} · kaydedince yüklenir
                  </Text>
                ) : null}
                <Text style={s.label}>Logo zemini</Text>
                <Text style={[s.muted, { marginTop: -space.sm }]}>Saydam logolar bu zeminin üstünde gösterilir.</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel="Logo zemini">
                  {LOGO_BACKGROUNDS.map((b) => (
                    <Chip key={b} selected={draft.logoBackground === b} label={LOGO_BACKGROUND_LABELS[b]} onPress={() => patch({ logoBackground: b })} />
                  ))}
                </View>
                <View style={{ flexDirection: 'row', gap: space.md }}>
                  <View style={{ flex: 1 }}>
                    <Button title="Değiştir" icon="swap-horizontal" variant="secondary" disabled={busy} onPress={() => void pick('files')} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button title="Kaldır" icon="trash-outline" variant="danger" disabled={busy} onPress={removeLogo} />
                  </View>
                </View>
                <Button title="Fotoğraflardan seç" icon="images-outline" variant="ghost" compact disabled={busy} onPress={() => void pick('photos')} />
              </View>
            ) : (
              <Empty
                icon="cloud-upload-outline"
                title="Logo yükleyin"
                text="PNG veya JPEG, en az 64×64 piksel. Saydam zeminli PNG en iyi sonucu verir. SVG desteklenmiyor."
                action={
                  <View style={{ gap: space.sm }}>
                    <Button title="Dosyalardan seç" icon="folder-open-outline" disabled={busy} onPress={() => void pick('files')} />
                    <Button title="Fotoğraflardan seç" icon="images-outline" variant="secondary" disabled={busy} onPress={() => void pick('photos')} />
                  </View>
                }
              />
            )}
          </Section>

          {/* 2. Palet */}
          <Section n={2} title="Renk paleti" icon="color-palette-outline">
            {draft.swatches.length ? (
              <View style={{ gap: space.sm }}>
                <Text style={s.label}>Logodaki renkler</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                  {draft.swatches.map((w) => (
                    <View key={w.color} style={{ alignItems: 'center', gap: 2 }} accessible accessibilityLabel={`Logoda ${w.color}, yüzde ${Math.round(w.share * 100)}`}>
                      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: w.color, borderWidth: 1, borderColor: t.border.default }} />
                      <Text style={s.caption}>%{Math.round(w.share * 100)}</Text>
                    </View>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', gap: space.md }}>
                  <View style={{ flex: 1 }}>
                    <Button title="Başka öneri" icon="shuffle" variant="secondary" compact onPress={regenerate} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button title="Logodan gelenlere dön" icon="refresh" variant="ghost" compact onPress={resetToExtracted} />
                  </View>
                </View>
              </View>
            ) : (
              <Text style={s.muted}>Logo yüklediğinizde renkler logodan çıkarılır. Şu an uygulamanın kendi renkleri gösteriliyor; elle de değiştirebilirsiniz.</Text>
            )}

            <View style={{ marginTop: space.md }}>
              {PALETTE_KEYS.map((k, i) => (
                <ColorRow
                  key={k}
                  k={k}
                  value={palette[k]}
                  source={
                    draft.overrides[k]
                      ? 'Elle değiştirildi'
                      : (k === 'primary' || k === 'secondary' || k === 'accent') && sources
                        ? sources[k] === 'logo'
                          ? 'Logodan'
                          : 'Logodan türetildi'
                        : k === 'primary' || k === 'secondary' || k === 'accent'
                          ? draft.swatches.length
                            ? 'Logodan'
                            : 'Uygulama rengi'
                          : 'Otomatik'
                  }
                  overridden={Boolean(draft.overrides[k])}
                  open={editingKey === k}
                  onToggle={() => setEditingKey(editingKey === k ? null : k)}
                  swatches={draft.swatches.map((w) => w.color)}
                  onChange={(hex) => setOverride(k, hex)}
                  last={i === PALETTE_KEYS.length - 1}
                />
              ))}
            </View>

            <View style={{ marginTop: space.md, gap: space.sm }}>
              <Text style={s.label}>Düğme yazı renkleri (otomatik)</Text>
              <ForegroundInfo label="Ana düğme" bg={resolved.tokens.action.primary.bg} fg={resolved.tokens.action.primary.fg} />
              <ForegroundInfo label="Sayaç rozeti" bg={resolved.tokens.badge.countBg} fg={resolved.tokens.badge.countFg} />
            </View>

            <View style={{ marginTop: space.md, gap: space.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                <Icon name="lock-closed-outline" size={16} />
                <Text style={s.label}>Durum renkleri (sabit)</Text>
              </View>
              <Text style={[s.muted, { marginTop: -space.xs }]}>Başarı, uyarı ve hata renkleri her şirkette aynı kalır; anlamları karışmasın diye değiştirilemez.</Text>
              <View style={s.row}>
                <Badge t="success" icon="checkmark" label="Tamamlandı" />
                <Badge t="warning" icon="pause" label="Beklemede" />
                <Badge t="danger" icon="alert-circle" label="Gecikti" />
                <Badge t="info" icon="play" label="Devam ediyor" />
              </View>
            </View>
          </Section>

          {/* 3. Hazır temalar */}
          <Section n={3} title="Hazır tema" icon="sparkles-outline">
            <View style={{ gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel="Hazır tema">
              {BRANDING_PRESETS.map((p) => (
                <PresetCard key={p} preset={p} selected={draft.preset === p} config={draft} onPress={() => choosePreset(p)} />
              ))}
              {draft.preset === 'custom' ? (
                <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                  <Icon name="construct-outline" size={18} />
                  <Text style={[s.muted, { flex: 1 }]}>{PRESET_LABELS.custom.description} Bir hazır tema seçerek sıfırlayabilirsiniz.</Text>
                </View>
              ) : null}
            </View>
          </Section>

          {/* 4. Bölümler */}
          <Section n={4} title="Marka rengi kullanılacak bölümler" icon="layers-outline">
            <Text style={s.muted}>Her bölüm için marka rengini açıp hangi palet rengini kullanacağını seçin. Kapalı bölüm uygulamanın kendi görünümünde kalır.</Text>
            {THEME_TARGETS.map((target, i) => {
              const st = draft.targets[target.id] ?? { enabled: false, token: target.tokens[0] };
              return (
                <View key={target.id} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.border.default, paddingVertical: space.sm, gap: space.sm }}>
                  <ToggleRow title={target.label} subtitle={target.description} value={st.enabled} onChange={(v) => setTarget(target.id, { enabled: v })} />
                  {st.enabled && target.tokens.length > 1 ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel={`${target.label} rengi`}>
                      {target.tokens.map((tok) => (
                        <Chip key={tok} selected={st.token === tok} label={TOKEN_LABELS[tok]} color={palette[tok]} onPress={() => setTarget(target.id, { token: tok })} />
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
            <Button title="Tüm bölümleri varsayılana döndür" icon="refresh" variant="ghost" compact onPress={() => choosePreset('original')} />
          </Section>

          {/* 5. Önizleme */}
          <Section n={5} title="Önizleme" icon="phone-portrait-outline">
            <Text style={s.muted}>Uygulamanın gerçek bileşenleriyle çizilir. İçerik örnektir; verileriniz değişmez.</Text>
            <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: t.border.strong, overflow: 'hidden', marginTop: space.sm }}>
              <ThemeScope config={preview}>
                <FullPreview companyName={companyName} logoUri={newLogo?.uri ?? null} />
              </ThemeScope>
            </View>
            <View style={{ marginTop: space.md, gap: space.sm }}>
              <Badge
                t={failing.length ? 'warning' : 'success'}
                icon={failing.length ? 'warning-outline' : 'checkmark-circle'}
                label={`Okunaklılık: ${resolved.checks.length - failing.length}/${resolved.checks.length} kontrol AA düzeyinde`}
              />
              {resolved.adjustments.length ? (
                <View style={{ gap: space.xs }}>
                  <Text style={s.caption}>Okunaklılık için otomatik yapılan düzeltmeler:</Text>
                  {resolved.adjustments.map((a) => (
                    <View key={a} style={{ flexDirection: 'row', gap: space.xs }}>
                      <Icon name="color-wand-outline" size={16} />
                      <Text style={[s.muted, { flex: 1 }]}>{a}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </Section>

          {saved ? (
            <Card title="Sıfırla" icon="refresh-circle-outline">
              <Text style={[s.muted, { marginBottom: space.md }]}>Logo ve marka renklerini şirketteki herkes için kaldırır; uygulamanın kendi temasına döner.</Text>
              <Button title="Uygulamanın kendi temasına dön" icon="trash-outline" variant="danger" busy={saving === 'reset'} disabled={busy} onPress={() => void resetAll()} />
            </Card>
          ) : null}
        </View>
      </ScrollView>

      {/* 6. Kaydet / Vazgeç */}
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: t.surface.default, borderTopWidth: 1, borderTopColor: t.border.default }}>
        <View style={{ flexDirection: 'row', gap: space.md, padding: space.md }}>
          <View style={{ flex: 1 }}>
            <Button title="Vazgeç" variant="secondary" disabled={saving !== null} onPress={() => void cancel()} />
          </View>
          <View style={{ flex: 1.4 }}>
            <Button
              title={saving === 'upload' ? 'Logo yükleniyor…' : saving === 'save' ? 'Kaydediliyor…' : 'Kaydet'}
              icon="checkmark"
              busy={saving === 'upload' || saving === 'save'}
              disabled={!dirty || step !== null || saving !== null}
              accessibilityHint="Tema şirketteki herkesin uygulamasına uygulanır"
              onPress={() => void save()}
            />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

// ---------------------------------------------------------------------
// Düzenleyici parçaları
// ---------------------------------------------------------------------
function Section({ n, title, icon, children }: { n: number; title: string; icon: IconName; children: ReactNode }) {
  const { t, s } = useTheme();
  return (
    <View style={[s.card, { gap: space.sm }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: t.selection.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: t.selection.fg, fontWeight: '700', fontSize: 14 }}>{n}</Text>
        </View>
        <Icon name={icon} size={20} color={t.text.link} />
        <Text style={[s.heading, { fontSize: 18, flex: 1 }]} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

function Chip({ selected, label, color, onPress }: { selected: boolean; label: string; color?: string; onPress: () => void }) {
  const { t } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs + 2,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? t.selection.border : t.border.default,
        backgroundColor: selected ? t.selection.bg : t.surface.default,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {color ? <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: color, borderWidth: 1, borderColor: t.border.strong }} /> : null}
      {selected ? <Icon name="checkmark" size={16} color={t.selection.fg} /> : null}
      <Text style={{ fontSize: 16, fontWeight: selected ? '700' : '600', color: selected ? t.selection.fg : t.text.primary }}>{label}</Text>
    </Pressable>
  );
}

function ForegroundInfo({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  const { s } = useTheme();
  const ratio = contrastRatio(fg, bg).toFixed(1);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }} accessible accessibilityLabel={`${label}: zemin ${bg}, yazı ${fg}, kontrast ${ratio}`}>
      <View style={{ minWidth: 64, height: 36, borderRadius: radius.sm, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm }}>
        <Text style={{ color: fg, fontWeight: '700', fontSize: 16 }}>Aa</Text>
      </View>
      <Text style={[s.muted, { flex: 1 }]}>
        {label}: {fg === '#ffffff' ? 'beyaz' : 'koyu'} yazı · kontrast {ratio}:1
      </Text>
    </View>
  );
}

function ColorRow({
  k,
  value,
  source,
  overridden,
  open,
  onToggle,
  swatches,
  onChange,
  last,
}: {
  k: PaletteKey;
  value: string;
  source: string;
  overridden: boolean;
  open: boolean;
  onToggle: () => void;
  swatches: string[];
  onChange: (hex: string | null) => void;
  last: boolean;
}) {
  const { t, s } = useTheme();
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => setText(value), [value]);
  const meta = PALETTE_LABELS[k];

  function apply(input: string) {
    const hex = normalizeHex(input);
    if (!hex) {
      setError('Renk #RRGGBB biçiminde olmalı (ör. #1D5FD1).');
      return;
    }
    setError(undefined);
    onChange(hex);
  }
  function shift(delta: number) {
    const h = hexToHsl(value);
    onChange(hslToHex({ ...h, l: Math.max(0.03, Math.min(0.97, h.l + delta)) }));
  }

  return (
    <View style={{ borderBottomWidth: last ? 0 : 1, borderBottomColor: t.border.default }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${meta.label}: ${value}, ${source}. Düzenlemek için dokunun.`}
        onPress={onToggle}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 60, paddingVertical: space.sm, opacity: pressed ? 0.75 : 1 })}
      >
        <View style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: value, borderWidth: 1, borderColor: t.border.strong }} />
        <View style={{ flex: 1 }}>
          <Text style={s.strong}>{meta.label}</Text>
          <Text style={s.caption}>
            {value.toUpperCase()} · {source}
          </Text>
        </View>
        <Icon name={open ? 'chevron-up' : 'create-outline'} size={20} />
      </Pressable>
      {open ? (
        <View style={{ paddingBottom: space.md, gap: space.sm }}>
          <Text style={s.muted}>{meta.hint}</Text>
          <Field
            label="Renk kodu"
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => apply(text)}
            onBlur={() => text !== value && apply(text)}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={7}
            error={error}
          />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button title="Daha açık" icon="sunny-outline" variant="secondary" compact onPress={() => shift(0.06)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Daha koyu" icon="moon-outline" variant="secondary" compact onPress={() => shift(-0.06)} />
            </View>
          </View>
          {swatches.length ? (
            <View style={{ gap: space.xs }}>
              <Text style={s.caption}>Logodaki bir rengi seçin</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {swatches.map((w) => (
                  <Pressable
                    key={w}
                    accessibilityRole="button"
                    accessibilityLabel={`${meta.label} için ${w} kullan`}
                    onPress={() => onChange(w)}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: w,
                      borderWidth: w === value ? 3 : 1,
                      borderColor: w === value ? t.selection.border : t.border.strong,
                    }}
                  />
                ))}
              </View>
            </View>
          ) : null}
          {overridden ? <Button title="Önerilen renge dön" icon="arrow-undo-outline" variant="ghost" compact onPress={() => onChange(null)} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function PresetCard({ preset, selected, config, onPress }: { preset: BrandingPreset; selected: boolean; config: BrandingConfig; onPress: () => void }) {
  const { t, s } = useTheme();
  const meta = PRESET_LABELS[preset];
  const tk = resolveTheme({ palette: config.palette, overrides: config.overrides, targets: presetTargets(preset as (typeof BRANDING_PRESETS)[number]) }).tokens;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${meta.label}. ${meta.description}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: space.md,
        alignItems: 'center',
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? t.selection.border : t.border.default,
        backgroundColor: selected ? t.selection.bg : t.surface.default,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {/* Küçük örnek: başlık, düğme, alt gezinme */}
      <View style={{ width: 56, height: 72, borderRadius: radius.sm, overflow: 'hidden', borderWidth: 1, borderColor: t.border.strong, backgroundColor: tk.surface.canvas }}>
        <View style={{ height: 16, backgroundColor: tk.navigation.headerBg, borderBottomWidth: 1, borderBottomColor: tk.navigation.headerBorder }} />
        <View style={{ flex: 1, padding: 5, gap: 4 }}>
          <View style={{ height: 6, width: 30, borderRadius: 3, backgroundColor: tk.text.primary, opacity: 0.6 }} />
          <View style={{ height: 12, borderRadius: 4, backgroundColor: tk.action.primary.bg }} />
        </View>
        <View style={{ height: 14, backgroundColor: tk.navigation.tabBg, borderTopWidth: 1, borderTopColor: tk.navigation.tabBorder, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tk.navigation.tabActive }} />
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tk.navigation.tabInactive }} />
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tk.navigation.tabInactive }} />
        </View>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.strong, selected ? { color: t.selection.fg } : null]}>{meta.label}</Text>
        <Text style={s.muted}>{meta.description}</Text>
      </View>
      <Icon name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? t.selection.fg : t.text.secondary} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------
// Önizlemeler (uygulamanın gerçek bileşenleri, taslak temayla)
// ---------------------------------------------------------------------
const SAMPLE_TASK: Task = {
  id: 'onizleme',
  company_id: 'onizleme',
  title: 'Örnek: depo sayım listesini tamamla',
  description: '',
  status: 'in_progress',
  hold_reason: null,
  priority: 'high',
  assignee_id: 'onizleme',
  created_by: 'onizleme',
  group_id: null,
  due_at: null,
  due_all_day: false,
  source_message_id: null,
  client_request_id: 'onizleme',
  requires_approval: false,
  approver_id: null,
  approval_status: null,
  approval_note: null,
  approval_requested_at: null,
  approval_decided_at: null,
  approval_decided_by: null,
  notified_at: null,
  seen_at: null,
  accepted_at: null,
  started_at: null,
  completed_at: null,
  version: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  is_overdue: false,
};

function PreviewHeader({ title }: { title: string }) {
  const { t } = useTheme();
  return (
    <View
      style={{
        height: 48,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: space.md,
        gap: space.sm,
        backgroundColor: t.navigation.headerBg,
        borderBottomWidth: 1,
        borderBottomColor: t.navigation.headerBorder,
      }}
      accessible
      accessibilityLabel={`Önizleme: üst başlık, ${title}`}
    >
      <Icon name="chevron-back" size={22} color={t.navigation.headerTint} />
      <Text style={{ color: t.navigation.headerTint, fontSize: 16, fontWeight: '600' }}>Geri</Text>
      <Text style={{ flex: 1, textAlign: 'center', marginRight: 56, color: t.navigation.headerFg, fontSize: 17, fontWeight: '700' }}>{title}</Text>
    </View>
  );
}

const PREVIEW_TABS: { label: string; icon: IconName; active: IconName }[] = [
  { label: 'Bugün', icon: 'today-outline', active: 'today' },
  { label: 'Görevler', icon: 'checkbox-outline', active: 'checkbox' },
  { label: 'Mesajlar', icon: 'chatbubbles-outline', active: 'chatbubbles' },
  { label: 'Profil', icon: 'person-circle-outline', active: 'person-circle' },
];

function PreviewTabBar() {
  const { t } = useTheme();
  return (
    <View
      style={{ flexDirection: 'row', backgroundColor: t.navigation.tabBg, borderTopWidth: 1, borderTopColor: t.navigation.tabBorder, paddingVertical: space.xs }}
      accessible
      accessibilityLabel="Önizleme: alt gezinme çubuğu"
    >
      {PREVIEW_TABS.map((tab, i) => {
        const c = i === 0 ? t.navigation.tabActive : t.navigation.tabInactive;
        return (
          <View key={tab.label} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
            <Icon name={i === 0 ? tab.active : tab.icon} size={22} color={c} />
            <Text style={{ fontSize: 12, fontWeight: '600', color: c }} maxFontSizeMultiplier={1.2}>
              {tab.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function MiniPreview({ companyName, logoUri }: { companyName: string; logoUri: string | null }) {
  const { t, s } = useTheme();
  return (
    <View style={{ borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: t.border.strong }} accessibilityLabel="Canlı önizleme">
      <PreviewHeader title="Bugün" />
      <View style={{ backgroundColor: t.surface.canvas, padding: space.sm, gap: space.sm }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            ...(t.hero.branded ? { backgroundColor: t.hero.bg, borderRadius: radius.sm, padding: space.sm } : {}),
          }}
        >
          <BrandLogo name={companyName} height={28} maxWidth={90} uri={logoUri} surface={t.hero.branded ? t.hero.bg : t.surface.canvas} />
          <Text style={[s.strong, { color: t.hero.fg, flex: 1 }]} numberOfLines={1}>
            Merhaba
          </Text>
          <CountBadge count={3} label="Örnek sayaç: 3" />
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button title="Kaydet" compact onPress={() => undefined} accessibilityLabel="Önizleme: ana düğme" />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Vazgeç" variant="secondary" compact onPress={() => undefined} accessibilityLabel="Önizleme: ikincil düğme" />
          </View>
        </View>
      </View>
      <PreviewTabBar />
    </View>
  );
}

function FullPreview({ companyName, logoUri }: { companyName: string; logoUri: string | null }) {
  const c = useCompany();
  const { t, s } = useTheme();
  const [seg, setSeg] = useState<'a' | 'b'>('a');
  const [toggle, setToggle] = useState(true);
  return (
    <View>
      <PreviewHeader title="Bugün" />
      <View style={{ backgroundColor: t.surface.canvas, padding: space.md, gap: space.md }}>
        <View style={[{ gap: space.sm }, t.hero.branded ? { backgroundColor: t.hero.bg, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: t.hero.border } : null]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <BrandLogo name={companyName} height={36} maxWidth={120} uri={logoUri} surface={t.hero.bg} />
            <Text style={[s.muted, { color: t.hero.fgMuted, flex: 1, fontWeight: '600' }]} numberOfLines={1}>
              {companyName}
            </Text>
          </View>
          <Text style={[s.heading, { color: t.hero.fg }]}>Merhaba</Text>
          <Text style={[s.muted, { color: t.hero.fgMuted }]}>Örnek: 3 açık işiniz var.</Text>
        </View>

        <Segmented
          label="Önizleme seçimi"
          value={seg}
          onChange={setSeg}
          options={[
            { key: 'a', label: 'Seçili' },
            { key: 'b', label: 'Seçili değil' },
          ]}
        />

        <Card title="Bugünkü işlerim" icon="sunny-outline" right={<Text style={s.link}>Tümü</Text>}>
          <TaskRow task={SAMPLE_TASK} tz={c.timezone} subtitle="Veren: Örnek Kişi" last onPress={() => undefined} />
        </Card>

        <Card title="Form ve seçimler" icon="create-outline">
          <Field label="Yazı alanı" value="Örnek metin" editable={false} />
          <ToggleRow title="Açma/kapama anahtarı" value={toggle} onChange={setToggle} />
          <View style={{ gap: space.xs, marginTop: space.sm }}>
            <Text style={s.muted}>İlerleme</Text>
            <ProgressBar value={0.62} label="Önizleme ilerleme çubuğu, yüzde 62" />
          </View>
        </Card>

        <View style={s.row}>
          <Badge t="info" icon="play" label="Bilgi rozeti" />
          <Badge t="success" icon="checkmark" label="Tamamlandı" />
          <CountBadge count={5} label="Örnek sayaç: 5" />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Avatar name="Örnek Kişi" size={32} />
            <Text style={s.link}>Bağlantı</Text>
          </View>
        </View>

        <View style={{ gap: space.sm }}>
          <Button title="Ana düğme" icon="checkmark-circle" onPress={() => undefined} />
          <Button title="İkincil düğme" variant="secondary" onPress={() => undefined} />
          <Button title="Pasif düğme" disabled onPress={() => undefined} />
        </View>
      </View>
      <PreviewTabBar />
    </View>
  );
}

