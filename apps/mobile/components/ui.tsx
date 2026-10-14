/**
 * Mobil arayüz parçaları (tasarım sistemi). İlkeler:
 * - Renkler yalnızca tema belirteçlerinden (lib/theme); şirket teması her bileşene kendiliğinden uygulanır.
 * - En az 16pt metin (sıkışık rozet/sekme etiketi 14pt), en az 48pt dokunma alanı, basınca görsel geri bildirim.
 * - Durumlar yalnızca renkle anlatılmaz: simge + metin. Simgeler ekran okuyucudan gizlenir, metin okunur.
 * - Animasyonlar kısa ve anlamlıdır; "Hareketi azalt" açıksa hiç oynatılmaz.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  TASK_APPROVAL_META,
  TASK_PRIORITY_META,
  TASK_STATUS_META,
  dueLabel,
  dueState,
  type TaskApprovalStatus,
  type TaskPriority,
  type TaskStatus,
  type TaskTiming,
  type Tone,
} from '@istakip/shared';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode, type Ref } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { TOUCH, font, radius, space, useTheme } from '@/lib/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** Süs simgesi: ekran okuyucudan gizli (anlamı yanındaki metin taşır) */
export function Icon({ name, size = 20, color, style }: { name: IconName; size?: number; color?: string; style?: ComponentProps<typeof Ionicons>['style'] }) {
  const { t } = useTheme();
  return <Ionicons name={name} size={size} color={color ?? t.text.secondary} style={style} accessibilityElementsHidden importantForAccessibility="no" />;
}

/** "Hareketi azalt" sistem ayarı */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduce(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/** Yeni beliren geri bildirim için kısa yumuşak giriş (hareketi azalt açıksa anında) */
export function FadeIn({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) {
      v.setValue(1);
      return;
    }
    Animated.timing(v, { toValue: 1, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [reduce, v]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

// ---------------------------------------------------------------------
// Rozetler
// ---------------------------------------------------------------------
export function Badge({ t: tone = 'neutral', icon, label }: { t?: Tone; icon?: IconName; label: string }) {
  const { t } = useTheme();
  const c = t.status[tone];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs,
        backgroundColor: c.bg,
        borderRadius: radius.pill,
        paddingHorizontal: space.sm + 2,
        paddingVertical: 3,
        alignSelf: 'flex-start',
      }}
      accessible
      accessibilityLabel={label}
    >
      {icon ? <Icon name={icon} size={15} color={c.fg} /> : null}
      <Text style={{ fontSize: font.caption, lineHeight: 18, fontWeight: '700', color: c.fg }} maxFontSizeMultiplier={1.6}>
        {label}
      </Text>
    </View>
  );
}

export const STATUS_ICONS: Record<TaskStatus, IconName> = {
  new: 'ellipse-outline',
  in_progress: 'play',
  on_hold: 'pause',
  done: 'checkmark',
};
const PRIORITY_ICONS: Partial<Record<TaskPriority, IconName>> = { low: 'arrow-down', high: 'arrow-up', urgent: 'alert' };
const APPROVAL_ICONS: Record<TaskApprovalStatus, IconName> = {
  pending: 'hourglass-outline',
  approved: 'checkmark-done',
  changes_requested: 'arrow-undo',
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  const m = TASK_STATUS_META[status];
  return <Badge t={m.tone} icon={STATUS_ICONS[status]} label={m.label} />;
}

export function ApprovalBadge({ status }: { status: TaskApprovalStatus }) {
  const m = TASK_APPROVAL_META[status];
  return <Badge t={m.tone} icon={APPROVAL_ICONS[status]} label={m.label} />;
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  if (priority === 'normal') return null;
  const m = TASK_PRIORITY_META[priority];
  return <Badge t={m.tone} icon={PRIORITY_ICONS[priority]} label={`${m.label} öncelik`} />;
}

export function DueBadge({ task, tz }: { task: TaskTiming; tz: string }) {
  const st = dueState(task, tz);
  if (st === 'none') return null;
  const label = dueLabel(task, tz);
  if (st === 'overdue') return <Badge t="danger" icon="alert-circle" label={label} />;
  if (st === 'today') return <Badge t="warning" icon="time-outline" label={label} />;
  return <Badge t="neutral" icon="calendar-outline" label={label} />;
}

/** Okunmamış sayacı (sekme rozetleri ile aynı renk) */
export function CountBadge({ count, label }: { count: number; label?: string }) {
  const { t } = useTheme();
  if (count <= 0) return null;
  return (
    <View
      style={{ backgroundColor: t.badge.countBg, borderRadius: radius.pill, minWidth: 26, paddingHorizontal: space.sm, paddingVertical: 2 }}
      accessible
      accessibilityLabel={label ?? `${count} okunmamış`}
    >
      <Text style={{ color: t.badge.countFg, fontWeight: '800', fontSize: font.caption, textAlign: 'center' }} maxFontSizeMultiplier={1.5}>
        {count > 99 ? '99+' : count}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------
// Düğmeler
// ---------------------------------------------------------------------
export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  busy,
  accessibilityHint,
  accessibilityLabel,
  compact,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  accessibilityHint?: string;
  accessibilityLabel?: string;
  /** Satır içi küçük düğme (yine en az 44pt) */
  compact?: boolean;
}) {
  const { t } = useTheme();
  const v = {
    primary: { bg: t.action.primary.bg, fg: t.action.primary.fg, border: t.action.primary.bg },
    secondary: { bg: t.action.secondary.bg, fg: t.action.secondary.fg, border: t.action.secondary.border },
    danger: { bg: t.action.danger.bg, fg: t.action.danger.fg, border: t.action.danger.border },
    ghost: { bg: 'transparent', fg: t.text.link, border: 'transparent' },
  }[variant];
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(busy) }}
      accessibilityHint={accessibilityHint}
      disabled={off}
      onPress={onPress}
      android_ripple={{ color: `${v.fg}22` }}
      style={({ pressed }) => ({
        minHeight: compact ? 44 : TOUCH,
        borderRadius: radius.md,
        borderWidth: variant === 'ghost' ? 0 : 1,
        backgroundColor: v.bg,
        borderColor: v.border,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: space.sm,
        paddingHorizontal: compact ? space.md : space.lg,
        alignSelf: compact ? 'flex-start' : 'stretch',
        opacity: disabled ? 0.45 : pressed ? 0.82 : 1,
        transform: [{ scale: pressed && !off ? 0.985 : 1 }],
      })}
    >
      {busy ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={20} color={v.fg} /> : null}
          <Text style={{ color: v.fg, fontSize: compact ? font.secondary : font.body, fontWeight: '700' }}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

/** Simge düğmesi: görünür alan küçük olsa da dokunma alanı 44pt */
export function IconButton({
  icon,
  label,
  onPress,
  disabled,
  tone = 'default',
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}) {
  const { t } = useTheme();
  const fg = tone === 'danger' ? t.status.danger.fg : t.text.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: tone === 'danger' ? t.status.danger.border : t.border.default,
        backgroundColor: pressed ? t.surface.muted : t.surface.default,
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <Icon name={icon} size={20} color={fg} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------
// Kartlar ve satırlar
// ---------------------------------------------------------------------
export function Card({
  title,
  icon,
  right,
  children,
  style,
}: {
  title?: string;
  icon?: IconName;
  right?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { t, s } = useTheme();
  return (
    <View style={[s.card, style]}>
      {title || right ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md, gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1 }}>
            {icon ? <Icon name={icon} size={20} color={t.text.link} /> : null}
            {title ? (
              <Text style={[s.heading, { fontSize: 18, lineHeight: 24, flexShrink: 1 }]} accessibilityRole="header">
                {title}
              </Text>
            ) : null}
          </View>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** Ayar/gezinme satırı (Profil, düzenleyici) */
export function ListRow({
  icon,
  title,
  subtitle,
  right,
  onPress,
  chevron = Boolean(onPress),
  accessibilityHint,
  last,
}: {
  icon?: IconName;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  accessibilityHint?: string;
  last?: boolean;
}) {
  const { t, s } = useTheme();
  const body = (
    <>
      {icon ? (
        <View style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: t.selection.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={20} color={t.selection.fg} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.strong}>{title}</Text>
        {subtitle ? <Text style={s.muted}>{subtitle}</Text> : null}
      </View>
      {right}
      {chevron ? <Icon name="chevron-forward" size={20} /> : null}
    </>
  );
  const style = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.md,
    minHeight: 56,
    paddingVertical: space.sm,
    borderBottomWidth: last ? 0 : 1,
    borderBottomColor: t.border.default,
  };
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [style, { opacity: pressed ? 0.7 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

/** Kişi/grup simgesi: baş harfler (renk yalnızca süs; ad her zaman yanında yazılı) */
export function Avatar({ name, kind = 'person', size = 44 }: { name: string; kind?: 'person' | 'group'; size?: number }) {
  const { t } = useTheme();
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toLocaleUpperCase('tr'))
    .join('');
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.selection.bg, alignItems: 'center', justifyContent: 'center' }}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {kind === 'group' ? (
        <Icon name="people" size={size * 0.48} color={t.selection.fg} />
      ) : (
        <Text style={{ color: t.selection.fg, fontWeight: '700', fontSize: size * 0.38 }} maxFontSizeMultiplier={1.2}>
          {initials || '?'}
        </Text>
      )}
    </View>
  );
}

/** İlerleme çubuğu (grafik belirteçleri) */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  const { t } = useTheme();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={{ height: 10, borderRadius: radius.pill, backgroundColor: t.chart.track, overflow: 'hidden' }}
    >
      <View style={{ width: `${pct * 100}%`, height: '100%', borderRadius: radius.pill, backgroundColor: t.chart.fill }} />
    </View>
  );
}

// ---------------------------------------------------------------------
// Seçim denetimleri
// ---------------------------------------------------------------------
/** Bölümlü seçim (sekme listesi gibi); seçili öğe hem renkle hem kalın yazı + işaretle ayrılır */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  const { t } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', backgroundColor: t.surface.muted, borderRadius: radius.md, padding: space.xs, gap: space.xs }}
    >
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.key)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 44,
              borderRadius: radius.sm,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: space.xs,
              paddingHorizontal: space.sm,
              backgroundColor: active ? t.surface.default : 'transparent',
              borderWidth: active ? 1 : 0,
              borderColor: t.selection.border,
              opacity: pressed && !active ? 0.7 : 1,
            })}
          >
            {active ? <Icon name="checkmark" size={16} color={t.selection.fg} /> : null}
            <Text style={{ fontSize: font.secondary, fontWeight: active ? '700' : '600', color: active ? t.selection.fg : t.text.secondary }} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Açma/kapama satırı (form belirteçleri) */
export function ToggleRow({
  title,
  subtitle,
  value,
  onChange,
  disabled,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const { t, s } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56 }}>
      <View style={{ flex: 1 }}>
        <Text style={s.strong}>{title}</Text>
        {subtitle ? <Text style={s.muted}>{subtitle}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={title}
        accessibilityHint={subtitle}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: t.border.focus, false: t.border.strong }}
        thumbColor={Platform.OS === 'android' ? t.surface.default : undefined}
        ios_backgroundColor={t.border.strong}
      />
    </View>
  );
}

// ---------------------------------------------------------------------
// Durum ekranları
// ---------------------------------------------------------------------
export function Loading({ label = 'Yükleniyor…' }: { label?: string }) {
  const { t, s } = useTheme();
  return (
    <View style={[s.center, { backgroundColor: t.surface.canvas }]} accessibilityLiveRegion="polite" accessible accessibilityLabel={label}>
      <ActivityIndicator size="large" color={t.text.link} />
      <Text style={s.muted}>{label}</Text>
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t, s } = useTheme();
  return (
    <View
      style={[s.card, { borderColor: t.status.danger.border, backgroundColor: t.status.danger.bg, gap: space.md }]}
      accessibilityRole="alert"
    >
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        <Icon name="cloud-offline-outline" size={22} color={t.status.danger.fg} />
        <Text style={[s.body, { color: t.status.danger.fg, fontWeight: '600', flex: 1 }]}>{message}</Text>
      </View>
      {onRetry ? <Button title="Tekrar dene" icon="refresh" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

/** Boş durum. `plain`: bir kartın içinde (ikinci çerçeve çizilmez) */
export function Empty({ icon = 'file-tray-outline', title, text, action, plain }: { icon?: IconName; title: string; text?: string; action?: ReactNode; plain?: boolean }) {
  const { t, s } = useTheme();
  return (
    <View
      style={{
        alignItems: 'center',
        gap: space.sm,
        paddingVertical: plain ? space.md : space.xl,
        paddingHorizontal: space.lg,
        borderRadius: radius.lg,
        borderWidth: plain ? 0 : 1,
        borderStyle: 'dashed',
        borderColor: t.border.default,
      }}
    >
      <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: t.surface.muted, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={24} />
      </View>
      <Text style={[s.strong, { textAlign: 'center' }]}>{title}</Text>
      {text ? <Text style={[s.muted, { textAlign: 'center' }]}>{text}</Text> : null}
      {action ? <View style={{ marginTop: space.sm, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

export function Field({
  label,
  error,
  hint,
  right,
  style,
  ...input
}: TextInputProps & { label: string; error?: string; hint?: string; right?: ReactNode; ref?: Ref<TextInput> }) {
  const { t, s } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={s.label}>{label}</Text>
      {hint ? <Text style={[s.muted, { marginBottom: space.xs }]}>{hint}</Text> : null}
      <View style={{ justifyContent: 'center' }}>
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          placeholderTextColor={t.text.disabled}
          selectionColor={t.border.focus}
          {...input}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={[
            s.input,
            focused ? { borderColor: t.border.focus, borderWidth: 2, paddingHorizontal: space.md - 1 } : null,
            error ? { borderColor: t.status.danger.fg, borderWidth: 2 } : null,
            right ? { paddingRight: 52 } : null,
            style,
          ]}
        />
        {right ? <View style={{ position: 'absolute', right: 2 }}>{right}</View> : null}
      </View>
      {error ? (
        <View style={{ flexDirection: 'row', gap: space.xs, marginTop: space.xs, alignItems: 'center' }}>
          <Icon name="alert-circle" size={16} color={t.status.danger.fg} />
          <Text style={{ color: t.status.danger.fg, fontSize: font.secondary }} accessibilityLiveRegion="polite">
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function Message({ kind, text }: { kind: 'error' | 'success' | 'info'; text: string }) {
  const { t, s } = useTheme();
  const c = kind === 'error' ? t.status.danger : kind === 'success' ? t.status.success : t.status.info;
  const icon: IconName = kind === 'error' ? 'alert-circle' : kind === 'success' ? 'checkmark-circle' : 'information-circle';
  return (
    <FadeIn>
      <View
        accessibilityRole={kind === 'error' ? 'alert' : 'text'}
        accessibilityLiveRegion="polite"
        style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', borderWidth: 1, borderRadius: radius.md, padding: space.md, backgroundColor: c.bg, borderColor: c.border }}
      >
        <Icon name={icon} size={22} color={c.fg} />
        <Text style={[s.body, { color: c.fg, fontWeight: '600', flex: 1 }]}>{text}</Text>
      </View>
    </FadeIn>
  );
}

/** Ekran içi küçük bilgi satırı (ör. canlı bağlantı kuruluyor) */
export function Notice({ icon = 'information-circle-outline', text }: { icon?: IconName; text: string }) {
  const { s } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }} accessibilityLiveRegion="polite">
      <Icon name={icon} size={18} />
      <Text style={[s.muted, { flex: 1 }]}>{text}</Text>
    </View>
  );
}
