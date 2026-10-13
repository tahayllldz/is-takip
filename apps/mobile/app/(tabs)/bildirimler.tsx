import { fetchNotifications, formatAgo, markNotificationsRead, toAppError, type AppNotification } from '@istakip/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Button, Empty, ErrorView, Loading, colors, s } from '@/components/ui';
import { useCompany } from '@/lib/company';
import { keys } from '@/lib/query';
import { supabase } from '@/lib/supabase';

export default function NotificationsScreen() {
  const c = useCompany();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: keys.notifications(c.companyId ?? '-'),
    queryFn: () => fetchNotifications(supabase, c.companyId!, { limit: 100 }),
    enabled: Boolean(c.companyId),
  });
  const mark = useMutation({
    mutationFn: (ids?: string[]) => markNotificationsRead(supabase, ids),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.notifications(c.companyId ?? '-') });
      void qc.invalidateQueries({ queryKey: keys.unread(c.companyId ?? '-') });
    },
  });
  const unread = (q.data ?? []).filter((n) => !n.read_at).length;
  const now = new Date();

  function open(n: AppNotification) {
    if (!n.read_at) mark.mutate([n.id]);
    if (n.entity_type === 'task' && n.entity_id) router.push(`/gorev/${n.entity_id}`);
  }

  if (q.isLoading) return <Loading />;
  if (q.error) {
    return (
      <View style={[s.screen, s.content]}>
        <ErrorView message={toAppError(q.error).message} onRetry={() => void q.refetch()} />
      </View>
    );
  }

  return (
    <FlatList
      style={s.screen}
      data={q.data ?? []}
      keyExtractor={(n) => n.id}
      contentContainerStyle={{ padding: 16, gap: 8 }}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}
      ListHeaderComponent={
        unread > 0 ? (
          <View style={{ marginBottom: 8 }}>
            <Button title={`Tümünü okundu say (${unread})`} variant="secondary" onPress={() => mark.mutate(undefined)} busy={mark.isPending} />
          </View>
        ) : null
      }
      ListEmptyComponent={<Empty title="Bildirim yok" text="Size görev verildiğinde veya etiketlendiğinizde burada görünür." />}
      renderItem={({ item: n }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${n.read_at ? '' : 'Okunmamış. '}${n.title}. ${n.body}`}
          onPress={() => open(n)}
          style={[s.card, { padding: 14, backgroundColor: n.read_at ? colors.surface : colors.brandSoft }]}
        >
          <Text style={[s.body, { fontWeight: '700' }]}>
            {n.read_at ? '' : '● '}
            {n.title}
          </Text>
          {n.body ? <Text style={s.body}>{n.body}</Text> : null}
          <Text style={s.muted}>
            {formatAgo(n.created_at, now)}
            {n.actor_id ? ` · ${c.nameOf(n.actor_id)}` : ''}
          </Text>
        </Pressable>
      )}
    />
  );
}
