/**
 * Mobil sohbet ekranı. Gönderim tekrar-güvenlidir: her mesajın istemci kimliği vardır; bağlantı
 * koptuğunda mesaj "Gönderilemedi · Tekrar dene" olarak kalır ve aynı kimlikle yeniden gönderilir
 * (sunucu çoğaltmaz). Bekleyen mesajlar cihazda saklanır; uygulama kapanıp açılsa da kaybolmaz.
 */
import {
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_MIME_TYPES,
  TASK_PRIORITIES,
  TASK_PRIORITY_META,
  TASK_STATUS_META,
  attachmentProblem,
  createTaskFromMessage,
  deleteMessage,
  fetchConversation,
  fetchConversationList,
  fetchMessageTasks,
  fetchMessages,
  formatDayRelative,
  formatTime,
  isFeatureEnabled,
  localDateKey,
  markConversationRead,
  mix,
  removePendingAttachment,
  sendMessage,
  signAttachmentUrls,
  splitMentions,
  toAppError,
  uploadAttachment,
  type Message,
  type MessageTaskLink,
  type TaskPriority,
} from '@istakip/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Button, Empty, ErrorView, Field, Icon, IconButton, Loading, Message as Notice, type IconName } from '@/components/ui';
import { useCompany } from '@/lib/company';
import { confirmAction } from '@/lib/confirm';
import { keys } from '@/lib/query';
import { prefs } from '@/lib/secure-storage';
import { supabase } from '@/lib/supabase';
import { radius, space, useTheme, type Theme } from '@/lib/theme';

interface Pending {
  clientRequestId: string;
  body: string;
  mentionIds: string[];
  attachments: { path: string; name: string }[];
  status: 'sending' | 'failed';
  error?: string;
}

interface Chip {
  uploadId: string;
  name: string;
  status: 'uploading' | 'done' | 'error';
  path?: string;
  error?: string;
}

interface Person {
  id: string;
  name: string;
}

const pendingKey = (id: string) => `istakip.bekleyen.${id}`;

export default function ConversationScreen() {
  const { id, m: highlightId } = useLocalSearchParams<{ id: string; m?: string }>();
  const c = useCompany();
  const theme = useTheme();
  const { t, s } = theme;
  const qc = useQueryClient();
  const [acting, setActing] = useState<Message | null>(null);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [older, setOlder] = useState<Message[]>([]);
  const [noMore, setNoMore] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [tasks, setTasks] = useState<Record<string, MessageTaskLink>>({});
  const [converting, setConverting] = useState<Message | null>(null);
  const listRef = useRef<FlatList<Row>>(null);
  const restored = useRef(false);
  const highlighted = useRef(false);

  const detailQ = useQuery({ queryKey: keys.conversation(id), queryFn: () => fetchConversation(supabase, id), enabled: Boolean(id) });
  const messagesQ = useQuery({ queryKey: keys.messages(id), queryFn: () => fetchMessages(supabase, id), enabled: Boolean(id) });
  // Sohbet listesiyle aynı önbellek: yazılabilir mi (arşivlenmiş grup, ayrılmış kişi)
  const listQ = useQuery({
    queryKey: keys.conversations(c.companyId ?? '-'),
    queryFn: () => fetchConversationList(supabase, c.companyId!),
    enabled: Boolean(c.companyId),
  });
  const listItem = listQ.data?.find((x) => x.id === id);

  const detail = detailQ.data;
  const groupId = detail?.conversation.group_id ?? null;
  const tasksOn = isFeatureEnabled('message_to_task', c.enabledModules);
  const canPost = listItem?.can_post ?? true;

  const messages = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of older) map.set(m.id, m);
    for (const m of messagesQ.data ?? []) map.set(m.id, m);
    return [...map.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [older, messagesQ.data]);

  const members: Person[] = (detail?.memberIds ?? [])
    .filter((uid) => c.members.some((m) => m.user_id === uid && m.status === 'active'))
    .map((uid) => ({ id: uid, name: c.nameOf(uid) }));
  const title = detail
    ? detail.conversation.kind === 'group'
      ? (detail.groupName ?? 'Grup')
      : (members.find((p) => p.id !== c.userId)?.name ?? 'Birebir')
    : 'Sohbet';

  // Bekleyen mesajları cihazdan geri al ve aynı kimlikle gönder (bir kez)
  useEffect(() => {
    if (!id || restored.current) return;
    restored.current = true;
    prefs
      .getItem(pendingKey(id))
      .then((raw) => {
        const saved = raw ? (JSON.parse(raw) as Pending[]) : [];
        if (!saved.length) return;
        setPending(saved.map((p) => ({ ...p, status: 'sending' as const, error: undefined })));
        for (const p of saved) void trySend(p);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!id || !restored.current) return;
    const p = pending.length ? prefs.setItem(pendingKey(id), JSON.stringify(pending)) : prefs.removeItem(pendingKey(id));
    p.catch(() => undefined);
  }, [id, pending]);

  // Gönderilmiş görünen bekleyenleri temizle
  useEffect(() => {
    const sent = new Set(messages.map((m) => m.client_request_id));
    setPending((list) => (list.some((p) => sent.has(p.clientRequestId)) ? list.filter((p) => !sent.has(p.clientRequestId)) : list));
  }, [messages]);

  // Ekler için imzalı bağlantılar
  useEffect(() => {
    const paths = messages.flatMap((m) => (m.deleted_at ? [] : m.attachments.map((a) => a.storage_path))).filter((p) => !urls[p]);
    if (paths.length) signAttachmentUrls(supabase, paths, 600).then((u) => setUrls((x) => ({ ...x, ...u }))).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Mesajdan oluşan görevler: ['tasks', şirket] altında → görev olayı (Realtime) gelince kendiliğinden yenilenir
  const messageIds = messages.map((m) => m.id);
  const messageTasksQ = useQuery({
    queryKey: ['tasks', c.companyId ?? '-', 'from-messages', id, messageIds.length, messageIds[messageIds.length - 1] ?? ''],
    queryFn: () => fetchMessageTasks(supabase, messageIds),
    enabled: tasksOn && messageIds.length > 0,
  });
  useEffect(() => {
    if (messageTasksQ.data) setTasks(Object.fromEntries(messageTasksQ.data.map((x) => [x.source_message_id, x])));
  }, [messageTasksQ.data]);

  // Okundu: ekran açıkken ve uygulama ön plandayken
  const markRead = useCallback(() => {
    if (!id || AppState.currentState !== 'active') return;
    markConversationRead(supabase, id)
      .then(() => {
        void qc.invalidateQueries({ queryKey: keys.conversations(c.companyId ?? '-') });
        void qc.invalidateQueries({ queryKey: keys.unread(c.companyId ?? '-') });
        void qc.invalidateQueries({ queryKey: keys.notifications(c.companyId ?? '-') });
        void qc.invalidateQueries({ queryKey: keys.mentions(c.companyId ?? '-') });
      })
      .catch(() => undefined);
  }, [id, qc, c.companyId]);

  useFocusEffect(
    useCallback(() => {
      markRead();
    }, [markRead]),
  );
  useEffect(() => {
    if (messagesQ.dataUpdatedAt) markRead();
  }, [messagesQ.dataUpdatedAt, markRead]);

  // Bağlantıyla açılan mesaja kaydır (bir kez)
  const rows = useMemo(() => buildRows(messages, pending, c.timezone), [messages, pending, c.timezone]);
  useEffect(() => {
    if (!highlightId || highlighted.current || !rows.length) return;
    const index = rows.findIndex((r) => r.kind === 'message' && r.message.id === highlightId);
    if (index >= 0) {
      highlighted.current = true;
      // Liste ters çevrilmiş (en yeni altta): sıra numarası tersten hesaplanır
      const reversedIndex = rows.length - 1 - index;
      setTimeout(() => listRef.current?.scrollToIndex({ index: reversedIndex, viewPosition: 0.5, animated: false }), 300);
    }
  }, [rows, highlightId]);

  async function trySend(p: Pending) {
    setPending((list) => list.map((x) => (x.clientRequestId === p.clientRequestId ? { ...x, status: 'sending', error: undefined } : x)));
    try {
      await sendMessage(supabase, { conversationId: id, body: p.body, clientRequestId: p.clientRequestId, mentionIds: p.mentionIds, attachments: p.attachments });
      await qc.invalidateQueries({ queryKey: keys.messages(id) });
      void qc.invalidateQueries({ queryKey: keys.conversations(c.companyId ?? '-') });
    } catch (e) {
      setPending((list) => list.map((x) => (x.clientRequestId === p.clientRequestId ? { ...x, status: 'failed', error: toAppError(e).message } : x)));
    }
  }

  function submit(input: { body: string; mentionIds: string[]; attachments: { path: string; name: string }[] }) {
    const p: Pending = { ...input, clientRequestId: Crypto.randomUUID(), status: 'sending' };
    setPending((list) => [...list, p]);
    void trySend(p);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }

  async function loadOlder() {
    const oldest = messages[0];
    if (!oldest) return;
    try {
      setOlderError(null);
      const more = await fetchMessages(supabase, id, { before: oldest.created_at });
      if (more.length < 50) setNoMore(true);
      setOlder((x) => [...more, ...x]);
    } catch (e) {
      setOlderError(`Eski mesajlar yüklenemedi: ${toAppError(e).message}`);
    }
  }

  /** Mesaj işlemleri (alt sayfa): göreve dönüştür, sil */
  function actionsFor(msg: Message): { label: string; icon: IconName; danger?: boolean; run: () => void }[] {
    const out: { label: string; icon: IconName; danger?: boolean; run: () => void }[] = [];
    if (tasksOn && canPost && !tasks[msg.id]) out.push({ label: 'Göreve dönüştür', icon: 'checkbox-outline', run: () => setConverting(msg) });
    const canDelete = msg.author_id === c.userId || (detail?.conversation.kind === 'group' && c.can('messages.moderate', groupId));
    if (canDelete && canPost) {
      out.push({
        label: 'Mesajı sil',
        icon: 'trash-outline',
        danger: true,
        run: () =>
          void confirmAction({ title: 'Mesaj silinsin mi?', message: 'Mesajın metni ve ekleri kimseye gösterilmez.', confirm: 'Sil', destructive: true }).then(
            async (ok) => {
              if (!ok) return;
              try {
                await deleteMessage(supabase, msg.id);
                await qc.invalidateQueries({ queryKey: keys.messages(id) });
              } catch (e) {
                setOlderError(`Mesaj silinemedi: ${toAppError(e).message}`);
              }
            },
          ),
      });
    }
    return out;
  }

  if (detailQ.isLoading || messagesQ.isLoading) return <Loading label="Mesajlar yükleniyor…" />;
  if (detailQ.error || messagesQ.error) {
    return (
      <View style={[s.screen, s.content]}>
        <ErrorView
          message={toAppError(detailQ.error ?? messagesQ.error).message}
          onRetry={() => {
            void detailQ.refetch();
            void messagesQ.refetch();
          }}
        />
      </View>
    );
  }
  if (!detail) {
    return (
      <View style={[s.screen, s.content]}>
        <Empty icon="chatbubbles-outline" title="Sohbet bulunamadı" text="Artık bu sohbete erişiminiz olmayabilir." />
        <Button title="Sohbetlere dön" icon="arrow-back" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  const blockReason = !canPost
    ? detail.conversation.kind === 'direct'
      ? 'Bu kişi artık şirkette değil; yeni mesaj gönderilemez.'
      : 'Bu grup arşivlenmiş; yeni mesaj gönderilemez.'
    : null;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: t.surface.canvas }} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title }} />
      <FlatList
        ref={listRef}
        inverted
        data={[...rows].reverse()}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ padding: space.md, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        onScrollToIndexFailed={() => undefined}
        onEndReached={() => {
          if (!noMore && messages.length >= 50) void loadOlder();
        }}
        onEndReachedThreshold={0.2}
        ListFooterComponent={olderError ? <Notice kind="error" text={olderError} /> : null}
        ListEmptyComponent={
          <View style={{ transform: [{ scaleY: -1 }] }}>
            <Empty icon="chatbubble-ellipses-outline" title="Henüz mesaj yok" text="İlk mesajı siz yazın." />
          </View>
        }
        renderItem={({ item }) => {
          if (item.kind === 'day') {
            return (
              <View style={{ alignItems: 'center', marginVertical: space.xs }}>
                <Text
                  style={[s.caption, { backgroundColor: t.surface.muted, paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.pill, overflow: 'hidden' }]}
                  accessibilityRole="header"
                >
                  {item.label}
                </Text>
              </View>
            );
          }
          if (item.kind === 'pending') {
            const p = item.pending;
            return (
              <View style={[bubbleStyle(theme, true), { opacity: p.status === 'sending' ? 0.7 : 1 }]}>
                {p.body ? <Text style={s.body}>{p.body}</Text> : null}
                {p.attachments.length ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                    <Icon name="attach" size={16} />
                    <Text style={[s.muted, { flex: 1 }]}>{p.attachments.map((a) => a.name).join(', ')}</Text>
                  </View>
                ) : null}
                {p.status === 'sending' ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-end' }}>
                    <Icon name="time-outline" size={14} />
                    <Text style={s.caption}>Gönderiliyor…</Text>
                  </View>
                ) : (
                  <View style={{ gap: space.sm }} accessibilityLiveRegion="polite">
                    <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'flex-start' }}>
                      <Icon name="alert-circle" size={18} color={t.status.danger.fg} />
                      <Text style={[s.body, { color: t.status.danger.fg, fontWeight: '700', flex: 1 }]}>Gönderilemedi: {p.error}</Text>
                    </View>
                    <Button title="Tekrar dene" icon="refresh" variant="secondary" compact onPress={() => void trySend(p)} />
                  </View>
                )}
              </View>
            );
          }
          const m = item.message;
          return (
            <MessageBubble
              m={m}
              myId={c.userId}
              tz={c.timezone}
              nameOf={c.nameOf}
              urls={urls}
              task={tasks[m.id]}
              highlighted={m.id === highlightId}
              onActions={actionsFor(m).length ? () => setActing(m) : undefined}
            />
          );
        }}
      />
      {blockReason ? (
        <View
          style={{ flexDirection: 'row', gap: space.sm, padding: space.md, backgroundColor: t.status.warning.bg, borderTopWidth: 1, borderColor: t.status.warning.border }}
          accessibilityRole="text"
        >
          <Icon name="lock-closed-outline" size={20} color={t.status.warning.fg} />
          <Text style={[s.body, { color: t.status.warning.fg, fontWeight: '600', flex: 1 }]}>{blockReason}</Text>
        </View>
      ) : (
        <Composer companyId={c.companyId!} conversationId={id} members={members.filter((p) => p.id !== c.userId)} onSubmit={submit} />
      )}
      {converting ? (
        <ConvertModal
          message={converting}
          members={members}
          myId={c.userId}
          canAssignOthers={c.can('tasks.assign', groupId)}
          onClose={() => setConverting(null)}
          onCreated={(link) => {
            setTasks((x) => ({ ...x, [link.source_message_id]: link }));
            void qc.invalidateQueries({ queryKey: ['tasks'] });
          }}
        />
      ) : null}
      {acting ? <ActionSheet title="Mesaj işlemleri" options={actionsFor(acting)} onClose={() => setActing(null)} /> : null}
    </KeyboardAvoidingView>
  );
}

/** Alt sayfa: her platformda çalışan, erişilebilir işlem menüsü */
function ActionSheet({
  title,
  options,
  onClose,
}: {
  title: string;
  options: { label: string; icon: IconName; danger?: boolean; run: () => void }[];
  onClose: () => void;
}) {
  const { t, s } = useTheme();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Kapat" onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(15, 23, 32, 0.45)' }} />
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: t.surface.default, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }}>
        <View style={{ padding: space.lg, gap: space.xs }}>
          <Text style={[s.heading, { fontSize: 18, marginBottom: space.sm }]} accessibilityRole="header">
            {title}
          </Text>
          {options.map((o) => (
            <Pressable
              key={o.label}
              accessibilityRole="button"
              onPress={() => {
                onClose();
                o.run();
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                minHeight: 52,
                paddingHorizontal: space.sm,
                borderRadius: radius.md,
                backgroundColor: pressed ? t.surface.muted : 'transparent',
              })}
            >
              <Icon name={o.icon} size={22} color={o.danger ? t.status.danger.fg : t.text.primary} />
              <Text style={[s.body, { fontWeight: '600', color: o.danger ? t.status.danger.fg : t.text.primary }]}>{o.label}</Text>
            </Pressable>
          ))}
          <View style={{ marginTop: space.sm }}>
            <Button title="Vazgeç" variant="secondary" onPress={onClose} />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: string; message: Message }
  | { kind: 'pending'; key: string; pending: Pending };

function buildRows(messages: Message[], pending: Pending[], tz: string): Row[] {
  const rows: Row[] = [];
  let lastDay = '';
  for (const m of messages) {
    const day = localDateKey(m.created_at, tz);
    if (day !== lastDay) {
      rows.push({ kind: 'day', key: `gun-${day}`, label: formatDayRelative(m.created_at, tz) });
      lastDay = day;
    }
    rows.push({ kind: 'message', key: m.id, message: m });
  }
  for (const p of pending) rows.push({ kind: 'pending', key: `bekleyen-${p.clientRequestId}`, pending: p });
  return rows;
}

/** Kendi mesajı sağda seçim tonunda; diğerleri solda kart renginde (ayrım yazar adıyla da yapılır) */
const bubbleStyle = ({ t }: Theme, mine: boolean) => ({
  alignSelf: (mine ? 'flex-end' : 'flex-start') as 'flex-end' | 'flex-start',
  maxWidth: '86%' as const,
  backgroundColor: mine ? t.selection.bg : t.surface.card,
  borderColor: mine ? mix(t.selection.bg, t.selection.fg, 0.22) : t.border.card,
  borderWidth: 1,
  borderRadius: radius.lg,
  borderBottomRightRadius: mine ? radius.sm / 2 : radius.lg,
  borderBottomLeftRadius: mine ? radius.lg : radius.sm / 2,
  paddingHorizontal: space.md,
  paddingVertical: space.sm + 2,
  gap: space.xs,
});

function MessageBubble({
  m,
  myId,
  tz,
  nameOf,
  urls,
  task,
  highlighted,
  onActions,
}: {
  m: Message;
  myId: string;
  tz: string;
  nameOf: (id: string | null) => string;
  urls: Record<string, string>;
  task?: MessageTaskLink;
  highlighted: boolean;
  onActions?: () => void;
}) {
  const theme = useTheme();
  const { t, s } = theme;
  const mine = m.author_id === myId;
  const author = mine ? 'Siz' : nameOf(m.author_id);
  const mentioned = m.mentions.map((x) => ({ id: x.user_id, name: nameOf(x.user_id) }));
  const mentionsMe = m.mentions.some((x) => x.user_id === myId);
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, justifyContent: mine ? 'flex-end' : 'flex-start', alignItems: 'flex-end' }}>
      {!mine ? <Avatar name={author} size={32} /> : null}
      <View style={[bubbleStyle(theme, mine), { flexShrink: 1 }, highlighted ? { borderColor: t.selection.fg, borderWidth: 3 } : null]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' }}>
          <Text style={[s.caption, { color: t.text.primary, fontWeight: '700' }]}>{author}</Text>
          <Text style={s.caption}>{formatTime(m.created_at, tz)}</Text>
          {mentionsMe ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Icon name="at" size={14} color={t.status.warning.fg} />
              <Text style={[s.caption, { color: t.status.warning.fg }]}>sizi etiketledi</Text>
            </View>
          ) : null}
        </View>
        {m.deleted_at ? (
          <Text style={[s.muted, { fontStyle: 'italic' }]}>Bu mesaj silindi.</Text>
        ) : (
          <>
            {m.body ? (
              <Text style={s.body} selectable>
                {splitMentions(m.body, mentioned).map((part, i) =>
                  part.userId ? (
                    <Text key={i} style={{ fontWeight: '700', color: part.userId === myId ? t.status.warning.fg : t.text.link }}>
                      {part.text}
                    </Text>
                  ) : (
                    <Text key={i}>{part.text}</Text>
                  ),
                )}
              </Text>
            ) : null}
            {m.attachments.map((a) => {
              const url = urls[a.storage_path];
              if (a.is_image && url) {
                return (
                  <Pressable key={a.id} accessibilityRole="imagebutton" accessibilityLabel={`Fotoğraf: ${a.file_name}. Açmak için dokunun.`} onPress={() => void Linking.openURL(url)}>
                    <Image source={{ uri: url }} style={{ width: 220, height: 160, borderRadius: radius.md, backgroundColor: t.surface.muted }} resizeMode="cover" />
                  </Pressable>
                );
              }
              return (
                <Pressable
                  key={a.id}
                  accessibilityRole="link"
                  accessibilityLabel={`Dosya: ${a.file_name}. Açmak için dokunun.`}
                  disabled={!url}
                  onPress={() => url && void Linking.openURL(url)}
                  style={{
                    minHeight: 44,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.sm,
                    borderWidth: 1,
                    borderColor: t.border.default,
                    borderRadius: radius.md,
                    paddingHorizontal: space.md,
                    backgroundColor: t.surface.default,
                  }}
                >
                  <Icon name="document-attach-outline" size={20} color={t.text.link} />
                  <Text style={[s.body, { flexShrink: 1, color: url ? t.text.link : t.text.secondary }]} numberOfLines={1}>
                    {a.file_name}
                    {url ? '' : ' (hazırlanıyor…)'}
                  </Text>
                </Pressable>
              );
            })}
          </>
        )}
        {task ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Bu mesajdan oluşturulan görev: ${task.title}, ${TASK_STATUS_META[task.status].label}`}
            onPress={() => router.push(`/gorev/${task.id}`)}
            style={({ pressed }) => ({
              minHeight: 44,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              borderRadius: radius.md,
              paddingHorizontal: space.md,
              backgroundColor: t.surface.default,
              borderWidth: 1,
              borderColor: t.border.default,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <Icon name="checkbox-outline" size={18} color={t.text.link} />
            <Text style={[s.muted, { flexShrink: 1, color: t.text.link, fontWeight: '600' }]} numberOfLines={2}>
              Görev: {task.title} · {TASK_STATUS_META[task.status].label}
            </Text>
          </Pressable>
        ) : null}
        {onActions && !m.deleted_at ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${author} mesajı için işlemler`}
            onPress={onActions}
            hitSlop={4}
            style={{ alignSelf: mine ? 'flex-end' : 'flex-start', minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.xs }}
          >
            <Icon name="ellipsis-horizontal" size={18} />
            <Text style={[s.caption, { fontWeight: '600' }]}>İşlemler</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function Composer({
  companyId,
  conversationId,
  members,
  onSubmit,
}: {
  companyId: string;
  conversationId: string;
  members: Person[];
  onSubmit: (input: { body: string; mentionIds: string[]; attachments: { path: string; name: string }[] }) => void;
}) {
  const { t, s } = useTheme();
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [mentions, setMentions] = useState<Person[]>([]);
  const [chips, setChips] = useState<Chip[]>([]);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const match = /(^|\s)@([^\s@]{0,30})$/.exec(text.slice(0, caret));
    return match ? match[2]!.toLocaleLowerCase('tr-TR') : null;
  }, [text, caret]);
  const suggestions =
    query === null
      ? []
      : members.filter((p) => p.name.toLocaleLowerCase('tr-TR').split(/\s+/).some((w) => w.startsWith(query))).slice(0, 5);

  function pick(p: Person) {
    const before = text.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${p.name} `);
    setText(before + text.slice(caret));
    setCaret(before.length);
    setMentions((list) => (list.some((x) => x.id === p.id) ? list : [...list, p]));
  }

  async function upload(asset: { uri: string; name: string; mimeType: string; size: number }) {
    const problem = attachmentProblem({ size: asset.size, type: asset.mimeType });
    if (problem) {
      setError(`${asset.name}: ${problem}`);
      return;
    }
    const chip: Chip = { uploadId: Crypto.randomUUID(), name: asset.name, status: 'uploading' };
    setChips((x) => [...x, chip]);
    try {
      const body = await fetch(asset.uri).then((r) => r.arrayBuffer());
      const path = await uploadAttachment(supabase, {
        companyId,
        conversationId,
        uploadId: chip.uploadId,
        fileName: asset.name,
        body,
        contentType: asset.mimeType,
      });
      setChips((x) => x.map((y) => (y.uploadId === chip.uploadId ? { ...y, status: 'done', path } : y)));
    } catch (e) {
      setChips((x) => x.map((y) => (y.uploadId === chip.uploadId ? { ...y, status: 'error', error: toAppError(e).message } : y)));
    }
  }

  async function pickPhotos() {
    setError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Fotoğraf eklemek için fotoğraflara erişim izni verin (Ayarlar).');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, ATTACHMENT_MAX_COUNT - chips.length),
      quality: 0.7,
      // iPhone HEIC fotoğrafları her yerde açılabilsin diye JPEG'e çevrilir
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (res.canceled) return;
    for (const a of res.assets) {
      const mimeType = a.mimeType ?? 'image/jpeg';
      const ext = mimeType.split('/')[1] ?? 'jpg';
      await upload({ uri: a.uri, name: a.fileName ?? `fotograf-${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`, mimeType, size: a.fileSize ?? 0 });
    }
  }

  async function pickFiles() {
    setError(null);
    const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: [...ATTACHMENT_MIME_TYPES] });
    if (res.canceled) return;
    for (const a of res.assets) {
      await upload({ uri: a.uri, name: a.name, mimeType: a.mimeType ?? 'application/octet-stream', size: a.size ?? 0 });
    }
  }

  const uploading = chips.some((x) => x.status === 'uploading');
  const ready = chips.filter((x) => x.status === 'done' && x.path);
  const canSend = !uploading && (text.trim().length > 0 || ready.length > 0);

  function send() {
    if (!canSend) return;
    const body = text.trim();
    onSubmit({
      body,
      mentionIds: mentions.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id),
      attachments: ready.map((x) => ({ path: x.path!, name: x.name })),
    });
    setText('');
    setCaret(0);
    setMentions([]);
    setChips([]);
    setError(null);
  }

  const tool = ({ pressed }: { pressed: boolean }) => ({
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: pressed ? t.surface.muted : 'transparent',
  });

  return (
    <View style={{ borderTopWidth: 1, borderColor: t.border.default, backgroundColor: t.surface.default, paddingHorizontal: space.sm, paddingVertical: space.sm, gap: space.sm }}>
      {suggestions.length ? (
        <View accessibilityLabel="Etiketlenecek kişi önerileri" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.xs }}>
          {suggestions.map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`${p.name} kişisini etiketle`}
              onPress={() => pick(p)}
              style={{
                minHeight: 44,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.xs,
                paddingHorizontal: space.md,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: t.selection.border,
                backgroundColor: t.selection.bg,
              }}
            >
              <Icon name="at" size={16} color={t.selection.fg} />
              <Text style={{ color: t.selection.fg, fontWeight: '700', fontSize: 16 }}>{p.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {chips.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.xs }}>
          {chips.map((x) => (
            <View
              key={x.uploadId}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.xs,
                borderWidth: 1,
                borderColor: x.status === 'error' ? t.status.danger.border : t.border.default,
                borderRadius: radius.pill,
                paddingLeft: space.md,
                backgroundColor: x.status === 'error' ? t.status.danger.bg : t.surface.muted,
              }}
            >
              {x.status === 'uploading' ? (
                <ActivityIndicator size="small" color={t.text.link} accessibilityLabel="Yükleniyor" />
              ) : (
                <Icon name={x.status === 'error' ? 'alert-circle' : 'checkmark-circle'} size={16} color={x.status === 'error' ? t.status.danger.fg : t.status.success.fg} />
              )}
              <Text style={{ fontSize: 14, maxWidth: 180, color: x.status === 'error' ? t.status.danger.fg : t.text.primary }} numberOfLines={1}>
                {x.name}
                {x.status === 'error' ? ` — ${x.error}` : ''}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${x.name} dosyasını kaldır`}
                onPress={() => {
                  setChips((list) => list.filter((y) => y.uploadId !== x.uploadId));
                  if (x.path) void removePendingAttachment(supabase, x.path).catch(() => undefined);
                }}
                style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="close" size={18} color={t.text.primary} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {error ? (
        <View style={{ flexDirection: 'row', gap: space.xs, paddingHorizontal: space.xs }} accessibilityLiveRegion="polite">
          <Icon name="alert-circle" size={16} color={t.status.danger.fg} />
          <Text style={{ color: t.status.danger.fg, fontSize: 16, flex: 1 }}>{error}</Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.xs }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Fotoğraf ekle" onPress={() => void pickPhotos()} style={tool}>
          <Icon name="camera-outline" size={24} color={t.text.primary} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Dosya ekle" onPress={() => void pickFiles()} style={tool}>
          <Icon name="attach" size={24} color={t.text.primary} />
        </Pressable>
        <TextInput
          accessibilityLabel="Mesaj yazın"
          accessibilityHint="Kişi etiketlemek için @ yazın. Etiketlenen kişiye bildirim gider; etiketlemek görev atamak değildir."
          placeholder="Mesaj yazın… (@ ile etiketleyin)"
          placeholderTextColor={t.text.disabled}
          selectionColor={t.border.focus}
          multiline
          maxLength={4000}
          value={text}
          onChangeText={setText}
          onSelectionChange={(e) => setCaret(e.nativeEvent.selection.end)}
          style={[s.input, { flex: 1, maxHeight: 120, borderRadius: radius.lg, minHeight: 48 }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={uploading ? 'Dosya yükleniyor, bekleyin' : 'Gönder'}
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={send}
          style={({ pressed }) => ({
            width: 48,
            height: 48,
            borderRadius: 24,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: t.action.primary.bg,
            opacity: !canSend ? 0.4 : pressed ? 0.85 : 1,
          })}
        >
          {uploading ? <ActivityIndicator color={t.action.primary.fg} /> : <Icon name="send" size={20} color={t.action.primary.fg} />}
        </Pressable>
      </View>
    </View>
  );
}

const DUE_OPTIONS = [
  { key: 'none', label: 'Son tarih yok', days: null },
  { key: 'today', label: 'Bugün', days: 0 },
  { key: 'tomorrow', label: 'Yarın', days: 1 },
  { key: 'week', label: '1 hafta', days: 7 },
] as const;

function ConvertModal({
  message,
  members,
  myId,
  canAssignOthers,
  onClose,
  onCreated,
}: {
  message: Message;
  members: Person[];
  myId: string;
  canAssignOthers: boolean;
  onClose: () => void;
  onCreated: (t: MessageTaskLink) => void;
}) {
  const c = useCompany();
  const { t, s } = useTheme();
  const [requestId] = useState(() => Crypto.randomUUID());
  let firstLine = message.body.split('\n')[0] ?? '';
  for (const mm of message.mentions) {
    const name = members.find((p) => p.id === mm.user_id)?.name;
    if (name) firstLine = firstLine.split(`@${name}`).join('');
  }
  const fallbackTitle = message.attachments.some((a) => a.is_image)
    ? 'Fotoğraflı mesajdan görev'
    : message.attachments.length
      ? 'Dosyalı mesajdan görev'
      : 'Mesajdan görev';
  const [title, setTitle] = useState(firstLine.replace(/\s+/g, ' ').replace(/^[\s,.:;-]+/, '').trim().slice(0, 120) || fallbackTitle);
  const [assignee, setAssignee] = useState(myId);
  const [due, setDue] = useState<(typeof DUE_OPTIONS)[number]['key']>('none');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<MessageTaskLink | null>(null);
  const options = canAssignOthers ? members : members.filter((p) => p.id === myId);

  async function submit() {
    if (!title.trim()) {
      setError('Görev başlığı yazın.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const days = DUE_OPTIONS.find((d) => d.key === due)?.days ?? null;
      const dueDate = days === null ? null : localDateKey(new Date(Date.now() + days * 86_400_000), c.timezone);
      const t = await createTaskFromMessage(supabase, { messageId: message.id, title: title.trim(), assigneeId: assignee, clientRequestId: requestId, dueDate, priority });
      const link = { id: t.id, title: t.title, status: t.status, source_message_id: message.id };
      setCreated(link);
      onCreated(link);
    } catch (e) {
      setError(toAppError(e).message);
    } finally {
      setBusy(false);
    }
  }

  /** Seçenek düğmesi: seçili olan işaret simgesi + kalın yazı + renkle ayrılır */
  function Choice({ selected, label, onPress }: { selected: boolean; label: string; onPress: () => void }) {
    return (
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        onPress={onPress}
        style={{
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.xs,
          paddingHorizontal: space.md,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: selected ? t.selection.border : t.border.default,
          backgroundColor: selected ? t.selection.bg : t.surface.default,
        }}
      >
        {selected ? <Icon name="checkmark" size={16} color={t.selection.fg} /> : null}
        <Text style={{ fontSize: 16, fontWeight: selected ? '700' : '600', color: selected ? t.selection.fg : t.text.primary }}>{label}</Text>
      </Pressable>
    );
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, paddingBottom: 0 }}>
          <Text style={[s.heading, { flex: 1 }]} accessibilityRole="header">
            Mesajı göreve dönüştür
          </Text>
          <IconButton icon="close" label="Kapat" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          {created ? (
            <>
              <Notice kind="success" text={assignee === myId ? 'Görev oluşturuldu ve size verildi.' : 'Görev oluşturuldu; sorumluya bildirildi.'} />
              <Button
                title="Göreve git"
                icon="arrow-forward"
                onPress={() => {
                  onClose();
                  router.push(`/gorev/${created.id}`);
                }}
              />
              <Button title="Kapat" variant="secondary" onPress={onClose} />
            </>
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: space.sm, backgroundColor: t.surface.muted, borderRadius: radius.md, padding: space.md }}>
                <Icon name="chatbubble-outline" size={20} />
                <Text style={[s.body, { flex: 1 }]}>{message.body || 'Dosya mesajı'}</Text>
              </View>
              <Text style={s.muted}>Mesaj metni görevin açıklamasına eklenir; görev bu mesaja bağlanır.</Text>
              <Field label="Görev başlığı" value={title} onChangeText={setTitle} maxLength={200} error={error && !title.trim() ? error : undefined} />
              <View style={{ gap: space.sm }}>
                <Text style={s.label}>Sorumlu</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel="Sorumlu">
                  {options.map((p) => (
                    <Choice key={p.id} selected={assignee === p.id} label={`${p.name}${p.id === myId ? ' (ben)' : ''}`} onPress={() => setAssignee(p.id)} />
                  ))}
                </View>
                {!canAssignOthers ? <Text style={s.muted}>Başkasına görev atama yetkiniz yok; görev size verilir.</Text> : null}
              </View>
              <View style={{ gap: space.sm }}>
                <Text style={s.label}>Son tarih</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel="Son tarih">
                  {DUE_OPTIONS.map((d) => (
                    <Choice key={d.key} selected={due === d.key} label={d.label} onPress={() => setDue(d.key)} />
                  ))}
                </View>
              </View>
              <View style={{ gap: space.sm }}>
                <Text style={s.label}>Öncelik</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel="Öncelik">
                  {TASK_PRIORITIES.map((p) => (
                    <Choice key={p} selected={priority === p} label={TASK_PRIORITY_META[p].label} onPress={() => setPriority(p)} />
                  ))}
                </View>
              </View>
              {error && title.trim() ? <Notice kind="error" text={error} /> : null}
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <View style={{ flex: 1 }}>
                  <Button title="Vazgeç" variant="secondary" onPress={onClose} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title={busy ? 'Oluşturuluyor…' : 'Oluştur'} icon="checkbox-outline" onPress={() => void submit()} busy={busy} />
                </View>
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
