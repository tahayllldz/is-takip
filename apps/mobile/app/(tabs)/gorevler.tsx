import { compareTasksByUrgency, fetchTasks, toAppError, type Task } from '@istakip/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { TaskRow } from '@/components/task-row';
import { Empty, ErrorView, Loading, Segmented } from '@/components/ui';
import { useCompany } from '@/lib/company';
import { keys } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { CONTENT_MAX, space, useTheme } from '@/lib/theme';

type Scope = 'mine' | 'created';
type Status = 'open' | 'done';

const EMPTY: Record<`${Scope}-${Status}`, { title: string; text: string }> = {
  'mine-open': { title: 'Açık göreviniz yok', text: 'Size yeni bir görev verildiğinde burada ve bildirimlerde görünür.' },
  'mine-done': { title: 'Tamamladığınız görev yok', text: 'Tamamladığınız görevler burada listelenir.' },
  'created-open': { title: 'Verdiğiniz açık görev yok', text: 'Başkasına görev vermek için web panelini kullanabilirsiniz.' },
  'created-done': { title: 'Tamamlanan görev yok', text: 'Verdiğiniz görevler tamamlandığında burada görünür.' },
};

export default function TasksScreen() {
  const c = useCompany();
  const { s } = useTheme();
  const [scope, setScope] = useState<Scope>('mine');
  const [status, setStatus] = useState<Status>('open');
  const q = useQuery({
    queryKey: keys.tasks(c.companyId ?? '-', scope, status),
    queryFn: () => fetchTasks(supabase, c.companyId!, { scope, userId: c.userId, status }),
    enabled: Boolean(c.companyId),
  });
  const now = new Date();
  const data: Task[] = [...(q.data ?? [])].sort((a, b) => compareTasksByUrgency(a, b, now));
  const empty = EMPTY[`${scope}-${status}`];

  return (
    <View style={s.screen}>
      <View style={{ padding: space.lg, paddingBottom: space.sm, gap: space.sm, width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center' }}>
        <Segmented
          label="Liste"
          value={scope}
          onChange={setScope}
          options={[
            { key: 'mine', label: 'Bana verilen' },
            { key: 'created', label: 'Verdiğim' },
          ]}
        />
        <Segmented
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
        <Loading label="Görevler yükleniyor…" />
      ) : q.error ? (
        <View style={{ padding: space.lg }}>
          <ErrorView message={toAppError(q.error).message} onRetry={() => void q.refetch()} />
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(x) => x.id}
          contentContainerStyle={[s.list, { paddingTop: space.sm }]}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}
          renderItem={({ item }) => (
            <TaskRow
              variant="card"
              task={item}
              tz={c.timezone}
              subtitle={scope === 'mine' ? `Veren: ${c.nameOf(item.created_by)}` : `Sorumlu: ${c.nameOf(item.assignee_id)}`}
            />
          )}
          ListEmptyComponent={<Empty icon={status === 'open' ? 'checkmark-done-outline' : 'archive-outline'} title={empty.title} text={empty.text} />}
        />
      )}
    </View>
  );
}
