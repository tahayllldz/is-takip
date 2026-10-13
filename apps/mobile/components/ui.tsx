/**
 * Mobil arayüz parçaları. İlkeler: açık zemin, yumuşak köşeler, en az 16pt yazı,
 * en az 48pt dokunma alanı, ekran okuyucu etiketleri, durumlar metin + simgeyle.
 */
import {
  TASK_PRIORITY_META,
  TASK_STATUS_META,
  dueLabel,
  dueState,
  type TaskPriority,
  type TaskStatus,
  type TaskTiming,
  type Tone,
} from '@istakip/shared';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

export const colors = {
  canvas: '#f6f7f9',
  surface: '#ffffff',
  line: '#dfe3e8',
  ink: '#17202b',
  muted: '#4a5664',
  brand: '#1d5fd1',
  brandSoft: '#e8f0fd',
  ok: '#146c43',
  okSoft: '#e3f4ea',
  warn: '#8a5300',
  warnSoft: '#fff3dc',
  danger: '#b42318',
  dangerSoft: '#fdecea',
  neutralSoft: '#eef1f4',
};

const tone: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: colors.neutralSoft, fg: colors.ink },
  info: { bg: colors.brandSoft, fg: colors.brand },
  warning: { bg: colors.warnSoft, fg: colors.warn },
  success: { bg: colors.okSoft, fg: colors.ok },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
};

export function Badge({ t = 'neutral', symbol, label }: { t?: Tone; symbol?: string; label: string }) {
  return (
    <View style={[s.badge, { backgroundColor: tone[t].bg }]} accessible accessibilityLabel={label}>
      <Text style={[s.badgeText, { color: tone[t].fg }]}>
        {symbol ? `${symbol} ` : ''}
        {label}
      </Text>
    </View>
  );
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const m = TASK_STATUS_META[status];
  return <Badge t={m.tone} symbol={m.symbol} label={m.label} />;
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  if (priority === 'normal') return null;
  const m = TASK_PRIORITY_META[priority];
  return <Badge t={m.tone} symbol={m.symbol} label={`${m.label} öncelik`} />;
}

export function DueBadge({ task, tz }: { task: TaskTiming; tz: string }) {
  const st = dueState(task, tz);
  if (st === 'none') return null;
  const label = dueLabel(task, tz);
  if (st === 'overdue') return <Badge t="danger" symbol="⚠" label={label} />;
  if (st === 'today') return <Badge t="warning" symbol="◷" label={label} />;
  return <Badge t="neutral" symbol="◷" label={label} />;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  accessibilityHint?: string;
}) {
  const v = {
    primary: { bg: colors.brand, fg: '#fff', border: colors.brand },
    secondary: { bg: colors.surface, fg: colors.ink, border: colors.line },
    danger: { bg: colors.surface, fg: colors.danger, border: '#f1b8b2' },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      aria-disabled={disabled || busy}
      aria-busy={busy}
      accessibilityHint={accessibilityHint}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [s.button, { backgroundColor: v.bg, borderColor: v.border, opacity: disabled ? 0.6 : pressed ? 0.85 : 1 }]}
    >
      {busy ? <ActivityIndicator color={v.fg} /> : <Text style={[s.buttonText, { color: v.fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Card({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <View style={s.card}>
      {title || right ? (
        <View style={s.cardHeader}>
          {title ? (
            <Text style={s.cardTitle} accessibilityRole="header">
              {title}
            </Text>
          ) : (
            <View />
          )}
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Loading({ label = 'Yükleniyor…' }: { label?: string }) {
  return (
    <View style={s.center} accessibilityLiveRegion="polite" accessible accessibilityLabel={label}>
      <ActivityIndicator size="large" color={colors.brand} />
      <Text style={s.muted}>{label}</Text>
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={[s.card, { borderColor: '#f1b8b2', backgroundColor: colors.dangerSoft }]} accessibilityRole="alert">
      <Text style={[s.body, { color: colors.danger, fontWeight: '600' }]}>{message}</Text>
      {onRetry ? (
        <View style={{ marginTop: 12 }}>
          <Button title="Tekrar dene" variant="secondary" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}

export function Empty({ title, text }: { title: string; text?: string }) {
  return (
    <View style={s.empty}>
      <Text style={[s.body, { fontWeight: '700', textAlign: 'center' }]}>{title}</Text>
      {text ? <Text style={[s.muted, { textAlign: 'center', marginTop: 4 }]}>{text}</Text> : null}
    </View>
  );
}

export function Field({ label, error, hint, ...input }: TextInputProps & { label: string; error?: string; hint?: string }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>
      {hint ? <Text style={[s.muted, { marginBottom: 4 }]}>{hint}</Text> : null}
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        placeholderTextColor="#7a8591"
        style={[s.input, error ? { borderColor: colors.danger } : null]}
        {...input}
      />
      {error ? (
        <Text style={s.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Message({ kind, text }: { kind: 'error' | 'success'; text: string }) {
  const err = kind === 'error';
  return (
    <View
      accessibilityRole={err ? 'alert' : 'text'}
      accessibilityLiveRegion="polite"
      style={[s.message, { backgroundColor: err ? colors.dangerSoft : colors.okSoft, borderColor: err ? '#f1b8b2' : '#b6dfc7' }]}
    >
      <Text style={[s.body, { color: err ? colors.danger : colors.ok, fontWeight: '600' }]}>{text}</Text>
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 16, gap: 16 },
  h1: { fontSize: 24, fontWeight: '700', color: colors.ink },
  body: { fontSize: 16, color: colors.ink, lineHeight: 22 },
  muted: { fontSize: 15, color: colors.muted, lineHeight: 21 },
  label: { fontSize: 16, fontWeight: '600', color: colors.ink, marginBottom: 4 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#b9c1cb',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: '#fff',
  },
  error: { color: colors.danger, fontSize: 15, marginTop: 4 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeText: { fontSize: 14, fontWeight: '700' },
  button: { minHeight: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonText: { fontSize: 16, fontWeight: '700' },
  card: { backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: 16, padding: 16 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: colors.ink },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 12, padding: 20, backgroundColor: colors.surface },
  message: { borderWidth: 1, borderRadius: 12, padding: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
});
