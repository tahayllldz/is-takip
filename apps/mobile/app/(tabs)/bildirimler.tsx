import { fetchNotifications, formatAgo, markNotificationsRead, notificationTarget, toAppError, type AppNotification } from '@istakip/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Button, Empty, ErrorView, Icon, Loading, type IconName } from '@/components/ui';
import { useCompany } from '@/lib/company';
import { keys } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, space, useTheme } from '@/lib/theme';

/** Bildirim türüne göre simge (anlamı başlık metni taşır; simge yalnızca tarama kolaylığı) */
function iconFor(n: AppNotification): IconName {
  if (n.type.includes('approv') || n.type.includes('changes')) return n.type.includes('changes') ? 'arrow-undo-outline' : 'checkmark-done-outline';
  if (n.type.includes('comment')) return 'chatbox-ellipses-outline';
  if (n.type.includes('mention')) return 'at-outline';
  if (n.entity_type === 'message' || n.entity_type === 'conversation') return 'chatbubble-outline';
  if (n.type.includes('completed')) return 'checkmark-circle-outline';
  if (n.entity_type === 'group') return 'people-outline';
  return 'clipboard-outline';
}

export default function NotificationsScreen() {
  const c = useCompany();
  const { t, s } = useTheme();
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
    const target = notificationTarget(n);
    if (target?.kind === 'task') router.push(`/gorev/${target.taskId}`);
    else if (target?.kind === 'conversation')
      router.push({ pathname: '/mesaj/[id]', params: { id: target.conversationId, ...(target.messageId ? { m: target.messageId } : {}) } });
  }

  if (q.isLoading) return <Loading label="Bildirimler yükleniyor…" />;
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
      contentContainerStyle={s.list}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}
      ListHeaderComponent={
        unread > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xs, gap: space.md }}>
            <Text style={s.muted} accessibilityLiveRegion="polite">
              {unread} okunmamış
            </Text>
            <Button title="Tümünü okundu say" icon="checkmark-done" variant="ghost" compact onPress={() => mark.mutate(undefined)} busy={mark.isPending} />
          </View>
        ) : null
      }
      ListEmptyComponent={
        <Empty
          icon="notifications-outline"
          title="Bildirim yok"
          text="Size görev verildiğinde veya bir görevde ya da mesajda etiketlendiğinizde burada görünür."
        />
      }
      renderItem={({ item: n }) => {
        const isUnread = !n.read_at;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${isUnread ? 'Okunmamış. ' : ''}${n.title}. ${n.body}`}
            onPress={() => open(n)}
            style={({ pressed }) => [
              s.card,
              {
                flexDirection: 'row',
                gap: space.md,
                padding: space.md,
                backgroundColor: isUnread ? t.selection.bg : t.surface.card,
                borderColor: isUnread ? t.selection.border : t.border.card,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.pill,
                backgroundColor: isUnread ? t.surface.default : t.surface.muted,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={iconFor(n)} size={20} color={isUnread ? t.selection.fg : t.text.secondary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                {isUnread ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.selection.fg }} /> : null}
                <Text style={[s.strong, { flex: 1, fontWeight: isUnread ? '700' : '600' }]}>{n.title}</Text>
              </View>
              {n.body ? <Text style={s.body}>{n.body}</Text> : null}
              <Text style={s.caption}>
                {isUnread ? 'Yeni · ' : ''}
                {formatAgo(n.created_at, now)}
                {n.actor_id ? ` · ${c.nameOf(n.actor_id)}` : ''}
              </Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}
