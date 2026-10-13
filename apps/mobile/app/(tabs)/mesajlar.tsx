import {
  fetchConversationList,
  formatDayRelative,
  formatTime,
  getOrCreateDirectConversation,
  localDateKey,
  toAppError,
  type ConversationListItem,
} from '@istakip/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Empty, ErrorView, Loading, Message, colors, s } from '@/components/ui';
import { useCompany } from '@/lib/company';
import { keys } from '@/lib/query';
import { supabase } from '@/lib/supabase';

export default function ConversationsScreen() {
  const c = useCompany();
  const [picking, setPicking] = useState(false);
  const q = useQuery({
    queryKey: keys.conversations(c.companyId ?? '-'),
    queryFn: () => fetchConversationList(supabase, c.companyId!),
    enabled: Boolean(c.companyId),
  });
  const startDm = useMutation({
    mutationFn: (userId: string) => getOrCreateDirectConversation(supabase, c.companyId!, userId),
    onSuccess: (id) => {
      setPicking(false);
      router.push({ pathname: '/mesaj/[id]', params: { id } });
    },
  });

  if (q.isLoading) return <Loading label="Sohbetler yükleniyor…" />;
  if (q.error) {
    return (
      <View style={[s.screen, s.content]}>
        <ErrorView message={toAppError(q.error).message} onRetry={() => void q.refetch()} />
      </View>
    );
  }

  const today = localDateKey(new Date(), c.timezone);
  const people = c.members
    .filter((m) => m.status === 'active' && m.user_id !== c.userId)
    .map((m) => ({ id: m.user_id, name: c.nameOf(m.user_id) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  return (
    <>
      <FlatList
        style={s.screen}
        data={q.data ?? []}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}
        ListHeaderComponent={
          c.can('messages.direct') && people.length ? (
            <View style={{ marginBottom: 8 }}>
              <Button title="+ Birebir mesaj" variant="secondary" onPress={() => setPicking(true)} />
            </View>
          ) : null
        }
        ListEmptyComponent={<Empty title="Henüz sohbet yok" text="Bir gruba eklendiğinizde grubun sohbeti burada görünür." />}
        renderItem={({ item }) => <Row item={item} today={today} tz={c.timezone} myId={c.userId} nameOf={c.nameOf} />}
      />

      <Modal visible={picking} animationType="slide" onRequestClose={() => setPicking(false)} presentationStyle="pageSheet">
        <SafeAreaView style={s.screen}>
          <View style={[s.content, { paddingBottom: 0 }]}>
            <Text style={s.h1} accessibilityRole="header">
              Kime mesaj yazacaksınız?
            </Text>
            {startDm.error ? <Message kind="error" text={toAppError(startDm.error).message} /> : null}
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
            {people.map((p) => (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={`${p.name} ile birebir mesaj`}
                disabled={startDm.isPending}
                onPress={() => startDm.mutate(p.id)}
                style={({ pressed }) => [s.card, { padding: 14, opacity: pressed ? 0.8 : 1 }]}
              >
                <Text style={[s.body, { fontWeight: '600' }]}>{p.name}</Text>
              </Pressable>
            ))}
            <Button title="Vazgeç" variant="secondary" onPress={() => setPicking(false)} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

function Row({
  item,
  today,
  tz,
  myId,
  nameOf,
}: {
  item: ConversationListItem;
  today: string;
  tz: string;
  myId: string;
  nameOf: (id: string | null) => string;
}) {
  const author = !item.last_message_author
    ? null
    : item.last_message_author === myId
      ? 'Siz'
      : item.kind === 'group'
        ? nameOf(item.last_message_author).split(' ')[0]
        : null;
  const preview = item.last_message_deleted
    ? 'Mesaj silindi'
    : item.last_message_body || (item.last_message_has_files ? '📎 Dosya' : item.last_message_at ? '' : 'Henüz mesaj yok');
  const when = item.last_message_at
    ? localDateKey(item.last_message_at, tz) === today
      ? formatTime(item.last_message_at, tz)
      : formatDayRelative(item.last_message_at, tz)
    : '';
  const unread = item.unread_count;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.kind === 'group' ? 'Grup' : 'Birebir'}: ${item.title}. ${unread ? `${unread} okunmamış mesaj. ` : ''}${author ? `${author}: ` : ''}${preview}`}
      onPress={() => router.push({ pathname: '/mesaj/[id]', params: { id: item.id } })}
      style={({ pressed }) => [s.card, { padding: 14, flexDirection: 'row', gap: 12, opacity: pressed ? 0.85 : 1 }]}
    >
      <Text style={{ fontSize: 22 }} accessibilityElementsHidden importantForAccessibility="no">
        {item.kind === 'group' ? '👥' : '👤'}
      </Text>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <Text style={[s.body, { fontWeight: unread ? '800' : '600', flex: 1 }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={s.muted}>{when}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <Text style={[s.muted, { flex: 1, fontStyle: item.last_message_deleted ? 'italic' : 'normal' }]} numberOfLines={1}>
            {author && preview && !item.last_message_deleted ? `${author}: ` : ''}
            {preview}
          </Text>
          {unread ? (
            <View style={{ backgroundColor: colors.brand, borderRadius: 999, minWidth: 26, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14, textAlign: 'center' }}>{unread > 99 ? '99+' : unread}</Text>
            </View>
          ) : null}
        </View>
        {!item.can_post ? <Text style={s.muted}>Yalnızca okunabilir</Text> : null}
      </View>
    </Pressable>
  );
}
