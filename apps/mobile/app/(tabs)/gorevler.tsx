import { compareTasksByUrgency, fetchTasks, toAppError, type Task } from '@istakip/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { TaskRow } from '@/components/task-row';
import { Empty, ErrorView, Loading, colors, s } from '@/components/ui';
import { useCompany } from '@/lib/company';
import { keys } from '@/lib/query';
import { supabase } from '@/lib/supabase';

type Scope = 'mine' | 'created';
type Status = 'open' | 'done';

function Segment<T extends string>({ value, options, onChange, label }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={{ flexDirection: 'row', gap: 8 }}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            aria-selected={active}
            onPress={() => onChange(o.key)}
            style={{
              minHeight: 44,
              paddingHorizontal: 14,
              borderRadius: 999,
              borderWidth: 1,
              justifyContent: 'center',
              borderColor: active ? colors.brand : colors.line,
              backgroundColor: active ? colors.brandSoft : colors.surface,
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: '700', color: active ? colors.brand : colors.ink }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TasksScreen() {
  const c = useCompany();
  const [scope, setScope] = useState<Scope>('mine');
  const [status, setStatus] = useState<Status>('open');
  const q = useQuery({
    queryKey: keys.tasks(c.companyId ?? '-', scope, status),
    queryFn: () => fetchTasks(supabase, c.companyId!, { scope, userId: c.userId, status }),
    enabled: Boolean(c.companyId),
  });
  const now = new Date();
  const data: Task[] = [...(q.data ?? [])].sort((a, b) => compareTasksByUrgency(a, b, now));

  return (
    <View style={s.screen}>
      <View style={{ padding: 16, gap: 10 }}>
        <Segment
          label="Liste"
          value={scope}
          onChange={setScope}
          options={[
            { key: 'mine', label: 'Bana verilen' },
            { key: 'created', label: 'Verdiğim' },
          ]}
        />
        <Segment
          label="Durum"
          value={status}
          onChange={setStatus}
          options={[
            { key: 'open', label: 'Açık' },
            { key: 'done', label: 'Tamamlanan' },
          ]}
        />
      </View>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <View style={{ padding: 16 }}>
          <ErrorView message={toAppError(q.error).message} onRetry={() => void q.refetch()} />
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}
          renderItem={({ item }) => (
            <TaskRow
              task={item}
              tz={c.timezone}
              subtitle={scope === 'mine' ? `Veren: ${c.nameOf(item.created_by)}` : `Sorumlu: ${c.nameOf(item.assignee_id)}`}
            />
          )}
          ListEmptyComponent={<Empty title="Bu listede görev yok" text="Aşağı çekerek yenileyebilirsiniz." />}
        />
      )}
    </View>
  );
}
