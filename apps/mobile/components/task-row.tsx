import type { Task } from '@istakip/shared';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { DueBadge, PriorityBadge, StatusBadge, colors, s } from './ui';

export function TaskRow({ task, tz, subtitle }: { task: Task; tz: string; subtitle?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Görev ayrıntısını açar"
      onPress={() => router.push(`/gorev/${task.id}`)}
      style={({ pressed }) => ({
        paddingVertical: 12,
        paddingHorizontal: 4,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
        backgroundColor: pressed ? colors.canvas : 'transparent',
        minHeight: 56,
      })}
    >
      <Text style={[s.body, { fontWeight: '700' }]} numberOfLines={2}>
        {task.title}
      </Text>
      {subtitle ? <Text style={s.muted}>{subtitle}</Text> : null}
      <View style={[s.row, { marginTop: 6 }]}>
        <StatusBadge status={task.status} />
        <PriorityBadge priority={task.priority} />
        <DueBadge task={task} tz={tz} />
      </View>
    </Pressable>
  );
}
