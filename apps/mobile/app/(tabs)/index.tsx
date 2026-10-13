import { compareTasksByUrgency, fetchMyMentions, fetchTasks, formatAgo, isTodayTask, toAppError } from '@istakip/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { TaskRow } from '@/components/task-row';
import { Badge, Card, Empty, ErrorView, Loading, colors, s } from '@/components/ui';
import { useCompany } from '@/lib/company';
import { keys } from '@/lib/query';
import { supabase } from '@/lib/supabase';

/** Çalışan ekranı: kendi işleri öne çıkar. */
export default function TodayScreen() {
  const c = useCompany();
  const tasksOn = c.enabledModules.includes('tasks');
  const q = useQuery({
    queryKey: keys.tasks(c.companyId ?? '-', 'mine', 'open'),
    queryFn: () => fetchTasks(supabase, c.companyId!, { scope: 'mine', userId: c.userId, status: 'open' }),
    enabled: Boolean(c.companyId) && tasksOn,
  });
  const messagingOn = c.enabledModules.includes('messaging');
  const mentionsQ = useQuery({
    queryKey: keys.mentions(c.companyId ?? '-'),
    queryFn: () => fetchMyMentions(supabase, c.companyId!, 5),
    enabled: Boolean(c.companyId) && messagingOn,
  });

  const me = c.members.find((m) => m.user_id === c.userId);
  const firstName = (me?.profile.full_name || '').split(' ')[0];
  const now = new Date();
  const mine = q.data ?? [];
  const today = mine.filter((t) => isTodayTask(t, c.timezone, now)).sort((a, b) => compareTasksByUrgency(a, b, now));
  const overdue = mine.filter((t) => t.is_overdue);
  const later = mine.filter((t) => !isTodayTask(t, c.timezone, now)).sort((a, b) => compareTasksByUrgency(a, b, now));

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={q.isRefetching || mentionsQ.isRefetching}
          onRefresh={() => {
            void q.refetch();
            if (messagingOn) void mentionsQ.refetch();
          }}
        />
      }
    >
      <View>
        <Text style={s.h1} accessibilityRole="header">
          Merhaba{firstName ? ` ${firstName}` : ''}
        </Text>
        <Text style={s.muted}>{c.active?.company.name}</Text>
        {c.active?.company.is_demo ? (
          <View style={{ marginTop: 6 }}>
            <Badge t="warning" symbol="⚠" label="DEMO VERİ — örnek kişiler ve görevler" />
          </View>
        ) : null}
        {!c.live ? <Text style={[s.muted, { marginTop: 4 }]}>Canlı bağlantı kuruluyor; aşağı çekerek yenileyebilirsiniz.</Text> : null}
      </View>

      {!tasksOn ? (
        <Empty title="Görevler modülü kapalı" text="Şirket yöneticiniz bu modülü kapattı." />
      ) : q.isLoading ? (
        <Loading label="İşleriniz yükleniyor…" />
      ) : q.error ? (
        <ErrorView message={toAppError(q.error).message} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <View style={[s.row, { gap: 8 }]}>
            <Badge t="info" label={`${mine.length} açık iş`} />
            {overdue.length ? <Badge t="danger" symbol="⚠" label={`${overdue.length} gecikmiş`} /> : null}
          </View>
          <Card title="Bugünkü işlerim">
            {today.length ? (
              today.map((t) => <TaskRow key={t.id} task={t} tz={c.timezone} subtitle={`Veren: ${c.nameOf(t.created_by)}`} />)
            ) : (
              <Empty title="Bugün için bekleyen işiniz yok" />
            )}
          </Card>
          {later.length ? (
            <Card title="Sonraki işler">
              {later.slice(0, 10).map((t) => (
                <TaskRow key={t.id} task={t} tz={c.timezone} subtitle={`Veren: ${c.nameOf(t.created_by)}`} />
              ))}
            </Card>
          ) : null}
        </>
      )}

      {messagingOn ? (
        <Card title="Etiketlendiğim mesajlar">
          {mentionsQ.error ? (
            <ErrorView message={toAppError(mentionsQ.error).message} onRetry={() => void mentionsQ.refetch()} />
          ) : (mentionsQ.data ?? []).length ? (
            (mentionsQ.data ?? []).map((m) => (
              <Pressable
                key={m.message_id}
                accessibilityRole="button"
                accessibilityLabel={`${m.is_read ? '' : 'Okunmamış. '}${c.nameOf(m.author_id)}, ${m.conversation_title}: ${m.body}`}
                onPress={() => router.push({ pathname: '/mesaj/[id]', params: { id: m.conversation_id, m: m.message_id } })}
                style={{ minHeight: 48, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.line }}
              >
                <Text style={[s.body, { fontWeight: '700' }]}>
                  {m.is_read ? '' : '● '}
                  {c.nameOf(m.author_id)} · {m.conversation_title}
                </Text>
                <Text style={s.muted} numberOfLines={2}>
                  {m.body || '📎 Dosya'} · {formatAgo(m.created_at, now)}
                </Text>
              </Pressable>
            ))
          ) : (
            <Empty title="Sizi etiketleyen mesaj yok" />
          )}
        </Card>
      ) : null}
    </ScrollView>
  );
}
