import { TASK_STATUS_META, type Task } from '@istakip/shared';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useCompany } from '@/lib/company';
import { radius, space, useTheme } from '@/lib/theme';
import { ApprovalBadge, DueBadge, Icon, PriorityBadge, STATUS_ICONS } from './ui';

/**
 * Görev satırı. `variant="card"`: listede bağımsız kart; `"inset"`: bir kartın içinde ayraçlı satır.
 * Durum solda simge + metinle (ekran okuyucu: başlık, durum, kişi, son tarih sırasıyla okur).
 */
export function TaskRow({
  task,
  tz,
  subtitle,
  variant = 'inset',
  last,
  onPress,
}: {
  task: Task;
  tz: string;
  subtitle?: string;
  variant?: 'card' | 'inset';
  last?: boolean;
  /** Varsayılan: görev ayrıntısını açar (önizlemede başka davranış verilebilir) */
  onPress?: () => void;
}) {
  const { t, s } = useTheme();
  const approvalOn = useCompany().enabledModules.includes('task_approval');
  const meta = TASK_STATUS_META[task.status];
  const tone = t.status[meta.tone];
  const done = task.status === 'done';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${task.title}. ${meta.label}${subtitle ? `. ${subtitle}` : ''}`}
      accessibilityHint="Görev ayrıntısını açar"
      onPress={onPress ?? (() => router.push(`/gorev/${task.id}`))}
      android_ripple={{ color: t.surface.muted }}
      style={({ pressed }) => [
        { flexDirection: 'row', gap: space.md, minHeight: 64, opacity: pressed ? 0.75 : 1 },
        variant === 'card'
          ? [s.card, { padding: space.md }]
          : { paddingVertical: space.md, borderBottomWidth: last ? 0 : 1, borderBottomColor: t.border.default },
      ]}
    >
      <View
        style={{ width: 32, height: 32, borderRadius: radius.pill, backgroundColor: tone.bg, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}
      >
        <Icon name={STATUS_ICONS[task.status]} size={16} color={tone.fg} />
      </View>
      <View style={{ flex: 1, gap: space.xs }}>
        <Text
          style={[s.strong, done ? { color: t.text.secondary, textDecorationLine: 'line-through' } : null]}
          numberOfLines={2}
        >
          {task.title}
        </Text>
        <Text style={[s.caption, { fontWeight: '500' }]}>
          <Text style={{ color: tone.fg, fontWeight: '700' }}>{meta.label}</Text>
          {subtitle ? ` · ${subtitle}` : ''}
        </Text>
        <View style={[s.row, { gap: space.xs + 2 }]}>
          <PriorityBadge priority={task.priority} />
          <DueBadge task={task} tz={tz} />
          {approvalOn && task.approval_status ? <ApprovalBadge status={task.approval_status} /> : null}
        </View>
      </View>
      <Icon name="chevron-forward" size={18} style={{ alignSelf: 'center' }} />
    </Pressable>
  );
}
