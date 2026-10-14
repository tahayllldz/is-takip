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
import { FlatList, Modal, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Button, CountBadge, Empty, ErrorView, Field, Icon, IconButton, Loading, Message } from '@/components/ui';
import { useCompany } from '@/lib/company';
import { keys } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { space, useTheme } from '@/lib/theme';

export default function ConversationsScreen() {
  const c = useCompany();
  const { s } = useTheme();
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: keys.conversations(c.companyId ?? '-'),
    queryFn: () => fetchConversationList(supabase, c.companyId!),
    enabled: Boolean(c.companyId),
  });
  const startDm = useMutation({
    mutationFn: (userId: string) => getOrCreateDirectConversation(supabase, c.companyId!, userId),
    onSuccess: (id) => {
      setPicking(false);
      setSearch('');
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
  const needle = search.trim().toLocaleLowerCase('tr');
  const shown = needle ? people.filter((p) => p.name.toLocaleLowerCase('tr').includes(needle)) : people;
  const canDm = c.can('messages.direct') && people.length > 0;

  return (
    <>
      <FlatList
        style={s.screen}
        data={q.data ?? []}
        keyExtractor={(x) => x.id}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}
        ListHeaderComponent={
          canDm ? (
            <View style={{ marginBottom: space.sm }}>
              <Button title="Birebir mesaj başlat" icon="create-outline" variant="secondary" onPress={() => setPicking(true)} />
            </View>
          ) : null
        }
        ListEmptyComponent={<Empty icon="chatbubbles-outline" title="Henüz sohbet yok" text="Bir gruba eklendiğinizde grubun sohbeti burada görünür." />}
        renderItem={({ item }) => <Row item={item} today={today} tz={c.timezone} myId={c.userId} nameOf={c.nameOf} />}
      />

      <Modal visible={picking} animationType="slide" onRequestClose={() => setPicking(false)} presentationStyle="pageSheet">
        <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, paddingBottom: 0 }}>
            <Text style={[s.heading, { flex: 1 }]} accessibilityRole="header">
              Kime mesaj yazacaksınız?
            </Text>
            <IconButton icon="close" label="Kapat" onPress={() => setPicking(false)} />
          </View>
          <View style={{ padding: space.lg, paddingBottom: 0 }}>
            <Field label="Kişi ara" value={search} onChangeText={setSearch} placeholder="Ad yazın" autoCorrect={false} returnKeyType="search" />
            {startDm.error ? <Message kind="error" text={toAppError(startDm.error).message} /> : null}
          </View>
          <FlatList
            data={shown}
            keyExtractor={(p) => p.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: space.lg, paddingTop: 0, gap: space.sm }}
            ListEmptyComponent={<Empty icon="search-outline" title="Bu adla kimse bulunamadı" />}
            renderItem={({ item: p }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${p.name} ile birebir mesaj`}
                disabled={startDm.isPending}
                onPress={() => startDm.mutate(p.id)}
                style={({ pressed }) => [s.card, { padding: space.md, flexDirection: 'row', alignItems: 'center', gap: space.md, opacity: pressed ? 0.8 : 1 }]}
              >
                <Avatar name={p.name} size={40} />
                <Text style={[s.strong, { flex: 1 }]}>{p.name}</Text>
                {startDm.isPending && startDm.variables === p.id ? <Text style={s.caption}>Açılıyor…</Text> : <Icon name="chevron-forward" size={18} />}
              </Pressable>
            )}
          />
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
  const { t, s } = useTheme();
  const author = !item.last_message_author
    ? null
    : item.last_message_author === myId
      ? 'Siz'
      : item.kind === 'group'
        ? nameOf(item.last_message_author).split(' ')[0]
        : null;
  const preview = item.last_message_deleted
    ? 'Mesaj silindi'
    : item.last_message_body || (item.last_message_has_files ? 'Dosya' : item.last_message_at ? '' : 'Henüz mesaj yok');
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
      style={({ pressed }) => [s.card, { padding: space.md, flexDirection: 'row', gap: space.md, alignItems: 'center', opacity: pressed ? 0.85 : 1 }]}
    >
      <Avatar name={item.title} kind={item.kind === 'group' ? 'group' : 'person'} size={48} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
          <Text style={[s.strong, { fontWeight: unread ? '700' : '600', flex: 1 }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[s.caption, unread ? { color: t.selection.fg } : null]}>{when}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, flex: 1 }}>
            {item.last_message_has_files && !item.last_message_deleted ? <Icon name="attach" size={16} /> : null}
            <Text
              style={[s.muted, { flex: 1, fontStyle: item.last_message_deleted ? 'italic' : 'normal', color: unread ? t.text.primary : t.text.secondary }]}
              numberOfLines={1}
            >
              {author && preview && !item.last_message_deleted ? `${author}: ` : ''}
              {preview}
            </Text>
          </View>
          <CountBadge count={unread} label={`${unread} okunmamış mesaj`} />
        </View>
        {!item.can_post ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name="lock-closed-outline" size={14} />
            <Text style={s.caption}>Yalnızca okunabilir</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
