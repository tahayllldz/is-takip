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
  Alert,
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
import { Button, Empty, ErrorView, Field, Loading, Message as Notice, colors, s } from '@/components/ui';
import { useCompany } from '@/lib/company';
import { keys } from '@/lib/query';
import { prefs } from '@/lib/secure-storage';
import { supabase } from '@/lib/supabase';

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
  const qc = useQueryClient();
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

  // Ekler için imzalı bağlantılar, görev bağlantıları
  useEffect(() => {
    const paths = messages.flatMap((m) => (m.deleted_at ? [] : m.attachments.map((a) => a.storage_path))).filter((p) => !urls[p]);
    if (paths.length) signAttachmentUrls(supabase, paths, 600).then((u) => setUrls((x) => ({ ...x, ...u }))).catch(() => undefined);
    if (tasksOn && messages.length) {
      fetchMessageTasks(supabase, messages.map((m) => m.id))
        .then((t) => setTasks(Object.fromEntries(t.map((x) => [x.source_message_id, x]))))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, tasksOn]);

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
      const more = await fetchMessages(supabase, id, { before: oldest.created_at });
      if (more.length < 50) setNoMore(true);
      setOlder((x) => [...more, ...x]);
    } catch (e) {
      Alert.alert('Eski mesajlar yüklenemedi', toAppError(e).message);
    }
  }

  function actions(msg: Message) {
    const options: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = [];
    if (tasksOn && canPost && !tasks[msg.id]) options.push({ text: 'Göreve dönüştür', onPress: () => setConverting(msg) });
    const canDelete = msg.author_id === c.userId || (detail?.conversation.kind === 'group' && c.can('messages.moderate', groupId));
    if (canDelete && canPost) {
      options.push({
        text: 'Sil',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Mesaj silinsin mi?', 'Mesajın metni ve ekleri kimseye gösterilmez.', [
            { text: 'Vazgeç', style: 'cancel' },
            {
              text: 'Sil',
              style: 'destructive',
              onPress: () =>
                deleteMessage(supabase, msg.id)
                  .then(() => qc.invalidateQueries({ queryKey: keys.messages(id) }))
                  .catch((e) => Alert.alert('Silinemedi', toAppError(e).message)),
            },
          ]),
      });
    }
    options.push({ text: 'Vazgeç', style: 'cancel' });
    Alert.alert('Mesaj', undefined, options);
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
        <Empty title="Sohbet bulunamadı" text="Artık bu sohbete erişiminiz olmayabilir." />
        <Button title="Sohbetlere dön" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  const blockReason = !canPost
    ? detail.conversation.kind === 'direct'
      ? 'Bu kişi artık şirkette değil; yeni mesaj gönderilemez.'
      : 'Bu grup arşivlenmiş; yeni mesaj gönderilemez.'
    : null;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.canvas }} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title }} />
      <FlatList
        ref={listRef}
        inverted
        data={[...rows].reverse()}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        keyboardShouldPersistTaps="handled"
        onScrollToIndexFailed={() => undefined}
        onEndReached={() => {
          if (!noMore && messages.length >= 50) void loadOlder();
        }}
        onEndReachedThreshold={0.2}
        ListEmptyComponent={
          <View style={{ transform: [{ scaleY: -1 }] }}>
            <Empty title="Henüz mesaj yok" text="İlk mesajı siz yazın." />
          </View>
        }
        renderItem={({ item }) => {
          if (item.kind === 'day') {
            return (
              <Text style={[s.muted, { textAlign: 'center', fontWeight: '700', marginVertical: 4 }]} accessibilityRole="header">
                {item.label}
              </Text>
            );
          }
          if (item.kind === 'pending') {
            const p = item.pending;
            return (
              <View style={[bubble(true), { opacity: p.status === 'sending' ? 0.7 : 1 }]}>
                {p.body ? <Text style={s.body}>{p.body}</Text> : null}
                {p.attachments.length ? <Text style={s.muted}>📎 {p.attachments.map((a) => a.name).join(', ')}</Text> : null}
                {p.status === 'sending' ? (
                  <Text style={s.muted}>Gönderiliyor…</Text>
                ) : (
                  <View style={{ gap: 6 }} accessibilityLiveRegion="polite">
                    <Text style={[s.body, { color: colors.danger, fontWeight: '700' }]}>⚠ Gönderilemedi: {p.error}</Text>
                    <Button title="Tekrar dene" variant="secondary" onPress={() => void trySend(p)} />
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
              onActions={tasksOn || m.author_id === c.userId || c.can('messages.moderate', groupId) ? () => actions(m) : undefined}
            />
          );
        }}
      />
      {blockReason ? (
        <View style={{ padding: 12, backgroundColor: colors.warnSoft, borderTopWidth: 1, borderColor: colors.line }} accessibilityRole="text">
          <Text style={[s.body, { color: colors.warn, fontWeight: '600' }]}>⚠ {blockReason}</Text>
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
          onCreated={(t) => {
            setTasks((x) => ({ ...x, [t.source_message_id]: t }));
            void qc.invalidateQueries({ queryKey: ['tasks'] });
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
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

const bubble = (mine: boolean) => ({
  alignSelf: (mine ? 'flex-end' : 'flex-start') as 'flex-end' | 'flex-start',
  maxWidth: '88%' as const,
  backgroundColor: mine ? colors.brandSoft : colors.surface,
  borderColor: mine ? '#bcd2f7' : colors.line,
  borderWidth: 1,
  borderRadius: 16,
  padding: 10,
  gap: 4,
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
  const mine = m.author_id === myId;
  const author = mine ? 'Siz' : nameOf(m.author_id);
  const mentioned = m.mentions.map((x) => ({ id: x.user_id, name: nameOf(x.user_id) }));
  const mentionsMe = m.mentions.some((x) => x.user_id === myId);
  return (
    <View style={[bubble(mine), highlighted ? { borderColor: colors.brand, borderWidth: 3 } : null]}>
      <Text style={s.muted}>
        <Text style={{ fontWeight: '800', color: colors.ink }}>{author}</Text> · {formatTime(m.created_at, tz)}
        {mentionsMe ? <Text style={{ color: colors.brand, fontWeight: '700' }}> · @ sizi etiketledi</Text> : null}
      </Text>
      {m.deleted_at ? (
        <Text style={[s.muted, { fontStyle: 'italic' }]}>Bu mesaj silindi.</Text>
      ) : (
        <>
          {m.body ? (
            <Text style={s.body} selectable>
              {splitMentions(m.body, mentioned).map((part, i) =>
                part.userId ? (
                  <Text key={i} style={{ fontWeight: '800', color: part.userId === myId ? colors.warn : colors.brand }}>
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
                  <Image source={{ uri: url }} style={{ width: 220, height: 160, borderRadius: 10, backgroundColor: colors.neutralSoft }} resizeMode="cover" />
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
                style={{ minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 10, backgroundColor: colors.surface }}
              >
                <Text style={[s.body, { textDecorationLine: url ? 'underline' : 'none' }]} numberOfLines={1}>
                  📎 {a.file_name}
                  {url ? '' : ' (hazırlanıyor…)'}
                </Text>
              </Pressable>
            );
          })}
        </>
      )}
      {task ? (
        <Pressable accessibilityRole="link" onPress={() => router.push(`/gorev/${task.id}`)} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={[s.body, { color: colors.brand, textDecorationLine: 'underline' }]}>
            ☑ Görev: {task.title} ({TASK_STATUS_META[task.status].symbol} {TASK_STATUS_META[task.status].label})
          </Text>
        </Pressable>
      ) : null}
      {onActions && !m.deleted_at ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${author} mesajı için işlemler`}
          onPress={onActions}
          style={{ alignSelf: mine ? 'flex-end' : 'flex-start', minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 8 }}
        >
          <Text style={[s.muted, { fontWeight: '700' }]}>⋯ İşlemler</Text>
        </Pressable>
      ) : null}
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

  return (
    <View style={{ borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: 10, gap: 8 }}>
      {suggestions.length ? (
        <View accessibilityLabel="Etiketlenecek kişi önerileri" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {suggestions.map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`${p.name} kişisini etiketle`}
              onPress={() => pick(p)}
              style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.brand, backgroundColor: colors.brandSoft }}
            >
              <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 15 }}>@{p.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {chips.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {chips.map((x) => (
            <View key={x.uploadId} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: x.status === 'error' ? '#f1b8b2' : colors.line, borderRadius: 999, paddingLeft: 10, backgroundColor: x.status === 'error' ? colors.dangerSoft : colors.neutralSoft }}>
              {x.status === 'uploading' ? <ActivityIndicator size="small" color={colors.brand} /> : null}
              <Text style={{ fontSize: 14, maxWidth: 160 }} numberOfLines={1}>
                📎 {x.name}
                {x.status === 'error' ? ` — ${x.error}` : ''}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${x.name} dosyasını kaldır`}
                onPress={() => {
                  setChips((list) => list.filter((y) => y.uploadId !== x.uploadId));
                  if (x.path) void removePendingAttachment(supabase, x.path).catch(() => undefined);
                }}
                style={{ minHeight: 40, minWidth: 40, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontSize: 18, fontWeight: '700' }}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
      <TextInput
        accessibilityLabel="Mesaj yazın"
        accessibilityHint="Kişi etiketlemek için @ yazın. Etiketlenen kişiye bildirim gider; etiketlemek görev atamak değildir."
        placeholder="Mesaj yazın… (@ ile etiketleyin)"
        placeholderTextColor="#7a8591"
        multiline
        maxLength={4000}
        value={text}
        onChangeText={setText}
        onSelectionChange={(e) => setCaret(e.nativeEvent.selection.end)}
        style={[s.input, { maxHeight: 120 }]}
      />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Fotoğraf ekle" onPress={() => void pickPhotos()} style={toolButton}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>📷 Fotoğraf</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Dosya ekle" onPress={() => void pickFiles()} style={toolButton}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>📎 Dosya</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Button title={uploading ? 'Yükleniyor…' : 'Gönder'} onPress={send} disabled={!canSend} />
        </View>
      </View>
    </View>
  );
}

const toolButton = {
  minHeight: 48,
  paddingHorizontal: 12,
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: 12,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  backgroundColor: colors.surface,
};

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
  const [requestId] = useState(() => Crypto.randomUUID());
  let firstLine = message.body.split('\n')[0] ?? '';
  for (const mm of message.mentions) {
    const name = members.find((p) => p.id === mm.user_id)?.name;
    if (name) firstLine = firstLine.split(`@${name}`).join('');
  }
  const [title, setTitle] = useState(firstLine.replace(/\s+/g, ' ').replace(/^[\s,.:;-]+/, '').trim().slice(0, 120) || 'Mesajdan görev');
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

  const chip = (selected: boolean) => ({
    minHeight: 44,
    justifyContent: 'center' as const,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: selected ? colors.brand : colors.line,
    backgroundColor: selected ? colors.brandSoft : colors.surface,
  });

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.screen}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <Text style={s.h1} accessibilityRole="header">
            Mesajı göreve dönüştür
          </Text>
          {created ? (
            <>
              <Notice kind="success" text={assignee === myId ? 'Görev oluşturuldu ve size verildi.' : 'Görev oluşturuldu; sorumluya bildirildi.'} />
              <Button
                title="Göreve git"
                onPress={() => {
                  onClose();
                  router.push(`/gorev/${created.id}`);
                }}
              />
              <Button title="Kapat" variant="secondary" onPress={onClose} />
            </>
          ) : (
            <>
              <View style={[s.card, { backgroundColor: colors.neutralSoft }]}>
                <Text style={s.body}>{message.body || 'Dosya mesajı'}</Text>
              </View>
              <Text style={s.muted}>Mesaj metni görevin açıklamasına eklenir; görev bu mesaja bağlanır.</Text>
              <Field label="Görev başlığı" value={title} onChangeText={setTitle} maxLength={200} error={error && !title.trim() ? error : undefined} />
              <Text style={s.label}>Sorumlu</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
                {options.map((p) => (
                  <Pressable key={p.id} accessibilityRole="radio" aria-checked={assignee === p.id} onPress={() => setAssignee(p.id)} style={chip(assignee === p.id)}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: assignee === p.id ? colors.brand : colors.ink }}>
                      {p.name}
                      {p.id === myId ? ' (ben)' : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {!canAssignOthers ? <Text style={s.muted}>Başkasına görev atama yetkiniz yok; görev size verilir.</Text> : null}
              <Text style={s.label}>Son tarih</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
                {DUE_OPTIONS.map((d) => (
                  <Pressable key={d.key} accessibilityRole="radio" aria-checked={due === d.key} onPress={() => setDue(d.key)} style={chip(due === d.key)}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: due === d.key ? colors.brand : colors.ink }}>{d.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={s.label}>Öncelik</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
                {TASK_PRIORITIES.map((p) => (
                  <Pressable key={p} accessibilityRole="radio" aria-checked={priority === p} onPress={() => setPriority(p)} style={chip(priority === p)}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: priority === p ? colors.brand : colors.ink }}>
                      {TASK_PRIORITY_META[p].symbol} {TASK_PRIORITY_META[p].label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {error && title.trim() ? <Notice kind="error" text={error} /> : null}
              <Button title={busy ? 'Oluşturuluyor…' : 'Görevi oluştur'} onPress={() => void submit()} busy={busy} />
              <Button title="Vazgeç" variant="secondary" onPress={onClose} />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
