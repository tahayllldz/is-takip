'use client';
/**
 * Açık sohbet: mesajlar (gün ayraçlı), gönderim (tekrar-güvenli), ekler, @etiket, mesajdan görev, silme.
 * Gönderilen mesaj önce "Gönderiliyor…" olarak görünür; hata olursa aynı istek kimliğiyle
 * "Tekrar dene" yapılır — sunucu aynı kimliği tek mesaj sayar (yeniden bağlanmada çoğalma olmaz).
 */
import {
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_MIME_TYPES,
  MESSAGE_PAGE_SIZE,
  TASK_PRIORITIES,
  TASK_PRIORITY_META,
  TASK_STATUS_META,
  attachmentProblem,
  createTaskFromMessage,
  deleteMessage,
  fetchConversation,
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
  type Client,
  type ConversationDetail,
  type ConversationListItem,
  type Message,
  type MessageTaskLink,
  type TaskPriority,
} from '@istakip/shared';
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { newRequestId } from '@/lib/request-id';
import { useCan, type MessagingContext, type Person } from './messages-app';

interface PendingMessage {
  clientRequestId: string;
  body: string;
  mentionIds: string[];
  attachments: { path: string; name: string }[];
  status: 'sending' | 'failed';
  error?: string;
  createdAt: string;
}

const SIGNED_URL_TTL = 600; // sn

// Gönderilmeyi bekleyen mesajlar sekme oturumunda tutulur: sayfa yenilense veya hata ekranına düşse de
// kaybolmaz ve aynı istek kimliğiyle yeniden gönderilir (sunucu çoğaltmaz). Yalnızca bu tarayıcı sekmesi içindir.
const pendingKey = (conversationId: string) => `istakip.bekleyen.${conversationId}`;

function loadPending(conversationId: string): PendingMessage[] {
  try {
    const raw = sessionStorage.getItem(pendingKey(conversationId));
    return raw ? (JSON.parse(raw) as PendingMessage[]) : [];
  } catch {
    return [];
  }
}

function savePending(conversationId: string, list: PendingMessage[]) {
  try {
    if (list.length) sessionStorage.setItem(pendingKey(conversationId), JSON.stringify(list));
    else sessionStorage.removeItem(pendingKey(conversationId));
  } catch {
    /* depolama kapalıysa bekleyen mesaj yalnızca bellekte kalır */
  }
}

function mergeMessages(prev: Message[], incoming: Message[]): Message[] {
  const map = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  return [...map.values()].sort((a, b) => (a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at.localeCompare(b.created_at)));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export function ConversationPane({
  ctx,
  supabase,
  conversationId,
  listItem,
  highlightId,
  version,
  onRead,
}: {
  ctx: MessagingContext;
  supabase: Client;
  conversationId: string;
  listItem: ConversationListItem | null;
  highlightId: string | null;
  version: number;
  onRead: () => void;
}) {
  const can = useCan(ctx);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [taskLinks, setTaskLinks] = useState<Record<string, MessageTaskLink>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [converting, setConverting] = useState<Message | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const firstLoad = useRef(true);
  const signedAt = useRef(0);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nameOf = useCallback((id: string | null) => ctx.people.find((p) => p.id === id)?.name ?? 'Eski üye', [ctx.people]);
  const groupId = detail?.conversation.group_id ?? null;
  const tasksOn = isFeatureEnabled('message_to_task', ctx.perm.enabledModules);
  const canPost = listItem?.can_post ?? true;

  /** Ek dosyaları ve görev bağlantılarını tamamla (yalnızca eksik olanlar) */
  const enrich = useCallback(
    async (list: Message[]) => {
      const expired = Date.now() - signedAt.current > (SIGNED_URL_TTL - 60) * 1000;
      const paths = list.flatMap((m) => (m.deleted_at ? [] : m.attachments.map((a) => a.storage_path)));
      const missing = expired ? paths : paths.filter((p) => !urls[p]);
      const [signed, tasks] = await Promise.all([
        missing.length ? signAttachmentUrls(supabase, missing, SIGNED_URL_TTL).catch(() => ({})) : Promise.resolve({}),
        tasksOn ? fetchMessageTasks(supabase, list.map((m) => m.id)).catch(() => []) : Promise.resolve([]),
      ]);
      if (missing.length) {
        signedAt.current = Date.now();
        setUrls((u) => ({ ...(expired ? {} : u), ...signed }));
      }
      if (tasks.length) setTaskLinks((t) => ({ ...t, ...Object.fromEntries(tasks.map((x) => [x.source_message_id, x])) }));
    },
    [supabase, tasksOn, urls],
  );

  const markRead = useCallback(() => {
    if (readTimer.current) clearTimeout(readTimer.current);
    readTimer.current = setTimeout(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        await markConversationRead(supabase, conversationId);
        onRead();
      } catch {
        /* okundu bilgisi bir sonraki açılışta tekrar denenir */
      }
    }, 800);
  }, [supabase, conversationId, onRead]);

  const loadLatest = useCallback(async () => {
    try {
      const [d, latest] = await Promise.all([fetchConversation(supabase, conversationId), fetchMessages(supabase, conversationId)]);
      if (!d) {
        setNotFound(true);
        return;
      }
      setDetail(d);
      setLoadError(null);
      setMessages((prev) => mergeMessages(prev, latest));
      if (firstLoad.current) setHasMore(latest.length === MESSAGE_PAGE_SIZE);
      const sent = new Set(latest.map((m) => m.client_request_id));
      setPending((p) => p.filter((x) => !sent.has(x.clientRequestId)));
      void enrich(latest);
      const fromOthers = latest.some((m) => m.author_id !== ctx.userId);
      if (fromOthers || (listItem?.unread_count ?? 0) > 0) markRead();
    } catch (e) {
      setLoadError(toAppError(e).message);
    }
    // enrich/markRead kasıtlı olarak bağımlılık değil: her olayda yeniden kurulmasın
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, conversationId, ctx.userId]);

  // İlk yükleme + Realtime/yeniden bağlanma/sekme dönüşü sinyalleri
  useEffect(() => {
    void loadLatest();
  }, [loadLatest, version]);

  // Önceki sayfa yüklemesinden kalan gönderilmemiş mesajları geri al ve aynı kimlikle tekrar gönder
  useEffect(() => {
    const saved = loadPending(conversationId);
    if (!saved.length) return;
    setPending(saved.map((p) => ({ ...p, status: 'sending' as const, error: undefined })));
    for (const p of saved) void trySend(p);
    // yalnızca açılışta bir kez
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    savePending(conversationId, pending);
  }, [conversationId, pending]);

  // İmzalı bağlantılar süresi dolmadan yenilenir
  useEffect(() => {
    const t = setInterval(() => setMessages((m) => (m.length ? [...m] : m)), (SIGNED_URL_TTL - 120) * 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (Date.now() - signedAt.current > (SIGNED_URL_TTL - 120) * 1000 && messages.length) void enrich(messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Bağlantıyla açılan (bildirim, görev kaynağı) mesaj, resimler yüklenip liste yenilenirken de görünür kalsın
  const holdHighlightUntil = useRef(0);
  const showHighlight = useCallback(() => {
    const target = highlightId ? document.getElementById(`mesaj-${highlightId}`) : null;
    if (!target) return false;
    target.scrollIntoView({ block: 'center' });
    return true;
  }, [highlightId]);

  // Kaydırma: ilk açılışta en alta (veya vurgulanan mesaja), sonra yalnızca kullanıcı alttaysa
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length === 0) return;
    if (firstLoad.current) {
      firstLoad.current = false;
      if (showHighlight()) holdHighlightUntil.current = Date.now() + 4000;
      else el.scrollTop = el.scrollHeight;
      return;
    }
    if (Date.now() < holdHighlightUntil.current) showHighlight();
    else if (atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending, showHighlight]);

  // Resim yüklenince içerik uzar: kullanıcı alttaysa altta kalsın
  const keepBottom = useCallback(() => {
    const el = scrollRef.current;
    if (Date.now() < holdHighlightUntil.current) showHighlight();
    else if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [showHighlight]);

  async function loadOlder() {
    const oldest = messages[0];
    if (!oldest) return;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const older = await fetchMessages(supabase, conversationId, { before: oldest.created_at });
      setHasMore(older.length === MESSAGE_PAGE_SIZE);
      setMessages((prev) => mergeMessages(prev, older));
      void enrich(older);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch (e) {
      setLoadError(toAppError(e).message);
    } finally {
      setLoadingOlder(false);
    }
  }

  async function trySend(p: PendingMessage) {
    setPending((list) => list.map((x) => (x.clientRequestId === p.clientRequestId ? { ...x, status: 'sending', error: undefined } : x)));
    try {
      await sendMessage(supabase, {
        conversationId,
        body: p.body,
        clientRequestId: p.clientRequestId,
        mentionIds: p.mentionIds,
        attachments: p.attachments,
      });
      atBottom.current = true;
      await loadLatest();
    } catch (e) {
      setPending((list) =>
        list.map((x) => (x.clientRequestId === p.clientRequestId ? { ...x, status: 'failed', error: toAppError(e).message } : x)),
      );
    }
  }

  function submit(input: { body: string; mentionIds: string[]; attachments: { path: string; name: string }[] }) {
    const p: PendingMessage = { ...input, clientRequestId: newRequestId(), status: 'sending', createdAt: new Date().toISOString() };
    setPending((list) => [...list, p]);
    atBottom.current = true;
    void trySend(p);
  }

  async function remove(m: Message) {
    if (!window.confirm('Bu mesaj silinsin mi? Mesajın metni ve ekleri kimseye gösterilmez.')) return;
    try {
      await deleteMessage(supabase, m.id);
      await loadLatest();
    } catch (e) {
      window.alert(toAppError(e).message);
    }
  }

  if (notFound) {
    return (
      <div className="p-6">
        <p role="alert" className="font-semibold">
          Sohbet bulunamadı veya artık erişiminiz yok.
        </p>
        <Link href="/mesajlar" className="btn btn-secondary mt-3">
          Sohbetlere dön
        </Link>
      </div>
    );
  }

  const members: Person[] = (detail?.memberIds ?? []).map((id) => ({ id, name: nameOf(id), active: ctx.people.some((p) => p.id === id && p.active) }));
  const title = detail ? (detail.conversation.kind === 'group' ? (detail.groupName ?? 'Grup') : members.find((m) => m.id !== ctx.userId)?.name ?? 'Birebir') : (listItem?.title ?? 'Sohbet');
  const shownPending = pending.filter((p) => !messages.some((m) => m.client_request_id === p.clientRequestId));
  const blockReason = !canPost
    ? detail?.conversation.kind === 'direct'
      ? 'Bu kişi artık şirkette değil; geçmiş mesajları görebilirsiniz ama yeni mesaj gönderilemez.'
      : 'Bu grup arşivlenmiş; yeni mesaj gönderilemez.'
    : null;

  return (
    <>
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Link href="/mesajlar" className="btn btn-secondary btn-sm md:hidden" aria-label="Sohbet listesine dön">
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-bold">{title}</h2>
          <p className="text-sm text-muted">
            {detail?.conversation.kind === 'group' ? `Grup sohbeti · ${members.length} üye` : 'Birebir mesaj'}
            {detail?.conversation.kind === 'group' && groupId ? (
              <>
                {' · '}
                <Link href={`/gruplar/${groupId}`} className="underline">
                  Üyeler
                </Link>
              </>
            ) : null}
          </p>
        </div>
      </header>

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-label={`${title} mesajları`}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {loadError ? (
          <p role="alert" className="mb-2 rounded-xl bg-danger-soft px-3 py-2 font-medium text-danger">
            {loadError}{' '}
            <button type="button" className="underline" onClick={() => void loadLatest()}>
              Tekrar dene
            </button>
          </p>
        ) : null}
        {hasMore ? (
          <div className="mb-3 text-center">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadOlder()} disabled={loadingOlder}>
              {loadingOlder ? 'Yükleniyor…' : 'Daha eski mesajlar'}
            </button>
          </div>
        ) : null}
        {!detail && !loadError ? <p className="text-muted">Mesajlar yükleniyor…</p> : null}
        {detail && messages.length === 0 && shownPending.length === 0 ? (
          <p className="py-8 text-center text-muted">Henüz mesaj yok. İlk mesajı siz yazın.</p>
        ) : null}

        <ol className="flex flex-col gap-2">
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const day = localDateKey(m.created_at, ctx.timezone);
            const newDay = !prev || localDateKey(prev.created_at, ctx.timezone) !== day;
            return (
              <Fragment key={m.id}>
                {newDay ? (
                  <li className="my-2 text-center text-sm font-semibold text-muted" aria-hidden="true">
                    {formatDayRelative(m.created_at, ctx.timezone)}
                  </li>
                ) : null}
                <MessageItem
                  m={m}
                  ctx={ctx}
                  nameOf={nameOf}
                  urls={urls}
                  task={taskLinks[m.id]}
                  highlighted={m.id === highlightId}
                  canConvert={tasksOn && canPost && !m.deleted_at && !taskLinks[m.id]}
                  canDelete={!m.deleted_at && canPost && (m.author_id === ctx.userId || (detail?.conversation.kind === 'group' && can('messages.moderate', groupId)))}
                  onConvert={() => setConverting(m)}
                  onDelete={() => void remove(m)}
                  onMediaLoad={keepBottom}
                />
              </Fragment>
            );
          })}
          {shownPending.map((p) => (
            <li key={p.clientRequestId} className="ml-auto max-w-[85%] rounded-2xl border border-[#bcd2f7] bg-brand-soft px-3 py-2">
              <p className="whitespace-pre-wrap break-words">{p.body}</p>
              {p.attachments.length ? <p className="text-sm text-muted">📎 {p.attachments.map((a) => a.name).join(', ')}</p> : null}
              {p.status === 'sending' ? (
                <p className="text-sm text-muted">Gönderiliyor…</p>
              ) : (
                <p role="alert" className="text-sm font-semibold text-danger">
                  <span aria-hidden="true">⚠ </span>Gönderilemedi: {p.error}{' '}
                  <button type="button" className="underline" onClick={() => void trySend(p)}>
                    Tekrar dene
                  </button>
                </p>
              )}
            </li>
          ))}
        </ol>
      </div>

      {blockReason ? (
        <p role="note" className="border-t border-line bg-warn-soft px-4 py-3 font-medium text-warn">
          <span aria-hidden="true">⚠ </span>
          {blockReason}
        </p>
      ) : detail ? (
        <Composer ctx={ctx} supabase={supabase} conversationId={conversationId} members={members.filter((m) => m.id !== ctx.userId && m.active)} onSubmit={submit} />
      ) : null}

      {converting && detail ? (
        <ConvertToTaskDialog
          ctx={ctx}
          supabase={supabase}
          message={converting}
          members={members.filter((m) => m.active)}
          canAssignOthers={can('tasks.assign', groupId)}
          onClose={() => setConverting(null)}
          onCreated={(t) => {
            setTaskLinks((links) => ({ ...links, [converting.id]: t }));
          }}
        />
      ) : null}
    </>
  );
}

function MessageItem({
  m,
  ctx,
  nameOf,
  urls,
  task,
  highlighted,
  canConvert,
  canDelete,
  onConvert,
  onDelete,
  onMediaLoad,
}: {
  m: Message;
  ctx: MessagingContext;
  nameOf: (id: string | null) => string;
  urls: Record<string, string>;
  task?: MessageTaskLink;
  highlighted: boolean;
  canConvert: boolean;
  canDelete: boolean;
  onConvert: () => void;
  onDelete: () => void;
  onMediaLoad: () => void;
}) {
  const mine = m.author_id === ctx.userId;
  const mentioned = m.mentions.map((x) => ({ id: x.user_id, name: nameOf(x.user_id) }));
  const mentionsMe = m.mentions.some((x) => x.user_id === ctx.userId);
  return (
    <li
      id={`mesaj-${m.id}`}
      className={`max-w-[85%] rounded-2xl border px-3 py-2 ${mine ? 'ml-auto border-[#bcd2f7] bg-brand-soft' : 'mr-auto border-line bg-surface'} ${
        highlighted ? 'outline outline-3 outline-brand' : ''
      }`}
    >
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-bold">{mine ? 'Siz' : nameOf(m.author_id)}</span>
        <time dateTime={m.created_at} className="text-muted">
          {formatTime(m.created_at, ctx.timezone)}
        </time>
        {mentionsMe ? <span className="font-semibold text-brand">@ sizi etiketledi</span> : null}
      </p>
      {m.deleted_at ? (
        <p className="italic text-muted">Bu mesaj silindi.</p>
      ) : (
        <>
          {m.body ? (
            <p className="whitespace-pre-wrap break-words">
              {splitMentions(m.body, mentioned).map((part, i) =>
                part.userId ? (
                  <strong key={i} className={`rounded px-0.5 ${part.userId === ctx.userId ? 'bg-warn-soft' : 'text-brand'}`}>
                    {part.text}
                  </strong>
                ) : (
                  <Fragment key={i}>{part.text}</Fragment>
                ),
              )}
            </p>
          ) : null}
          {m.attachments.length ? (
            <ul className="mt-1 flex flex-col gap-1">
              {m.attachments.map((a) => {
                const url = urls[a.storage_path];
                return (
                  <li key={a.id}>
                    {a.is_image && url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={a.file_name} loading="lazy" onLoad={onMediaLoad} className="max-h-60 max-w-full rounded-lg border border-line object-contain" />
                      </a>
                    ) : url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-3 underline">
                        <span aria-hidden="true">📎</span>
                        {a.file_name} <span className="text-sm text-muted">({formatSize(a.size_bytes)})</span>
                      </a>
                    ) : (
                      <span className="text-sm text-muted">📎 {a.file_name} (hazırlanıyor…)</span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      )}
      {task ? (
        <p className="mt-1 text-sm">
          <span aria-hidden="true">☑ </span>
          Göreve dönüştürüldü:{' '}
          <Link href={`/gorevler/${task.id}`} className="font-semibold underline">
            {task.title}
          </Link>{' '}
          <span className="text-muted">
            ({TASK_STATUS_META[task.status].symbol} {TASK_STATUS_META[task.status].label})
          </span>
        </p>
      ) : null}
      {canConvert || canDelete ? (
        <div className="mt-1 flex flex-wrap gap-2">
          {canConvert ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onConvert}>
              ☑ Göreve dönüştür
            </button>
          ) : null}
          {canDelete ? (
            <button type="button" className="btn btn-danger btn-sm" onClick={onDelete}>
              Sil
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

interface Chip {
  uploadId: string;
  name: string;
  size: number;
  status: 'uploading' | 'done' | 'error';
  path?: string;
  error?: string;
}

function Composer({
  ctx,
  supabase,
  conversationId,
  members,
  onSubmit,
}: {
  ctx: MessagingContext;
  supabase: Client;
  conversationId: string;
  members: Person[];
  onSubmit: (input: { body: string; mentionIds: string[]; attachments: { path: string; name: string }[] }) => void;
}) {
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<Person[]>([]);
  const [chips, setChips] = useState<Chip[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => {
    if (query === null) return [];
    const q = query.toLocaleLowerCase('tr-TR');
    return members.filter((m) => m.name.toLocaleLowerCase('tr-TR').split(/\s+/).some((w) => w.startsWith(q)) || m.name.toLocaleLowerCase('tr-TR').startsWith(q)).slice(0, 6);
  }, [query, members]);

  function detectMention(value: string, caret: number) {
    const before = value.slice(0, caret);
    const match = /(^|\s)@([^\s@]{0,30})$/.exec(before);
    setQuery(match ? match[2]! : null);
    setActive(0);
  }

  function pick(p: Person) {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${p.name} `);
    const next = before + text.slice(caret);
    setText(next);
    setMentions((list) => (list.some((x) => x.id === p.id) ? list : [...list, p]));
    setQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  }

  async function addFiles(files: FileList | null) {
    setError(null);
    if (!files) return;
    const list = Array.from(files);
    if (chips.length + list.length > ATTACHMENT_MAX_COUNT) {
      setError(`Bir mesaja en fazla ${ATTACHMENT_MAX_COUNT} dosya eklenebilir.`);
      return;
    }
    for (const file of list) {
      const problem = attachmentProblem(file);
      if (problem) {
        setError(`${file.name}: ${problem}`);
        continue;
      }
      const chip: Chip = { uploadId: newRequestId(), name: file.name, size: file.size, status: 'uploading' };
      setChips((c) => [...c, chip]);
      try {
        const path = await uploadAttachment(supabase, {
          companyId: ctx.companyId,
          conversationId,
          uploadId: chip.uploadId,
          fileName: file.name,
          body: file,
          contentType: file.type || 'application/octet-stream',
        });
        setChips((c) => c.map((x) => (x.uploadId === chip.uploadId ? { ...x, status: 'done', path } : x)));
      } catch (e) {
        setChips((c) => c.map((x) => (x.uploadId === chip.uploadId ? { ...x, status: 'error', error: toAppError(e).message } : x)));
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  function removeChip(chip: Chip) {
    setChips((c) => c.filter((x) => x.uploadId !== chip.uploadId));
    if (chip.path) void removePendingAttachment(supabase, chip.path).catch(() => undefined);
  }

  const uploading = chips.some((c) => c.status === 'uploading');
  const ready = chips.filter((c) => c.status === 'done' && c.path);
  const canSend = !uploading && (text.trim().length > 0 || ready.length > 0);

  function send() {
    if (!canSend) return;
    const body = text.trim();
    const mentionIds = mentions.filter((m) => body.includes(`@${m.name}`)).map((m) => m.id);
    onSubmit({ body, mentionIds, attachments: ready.map((c) => ({ path: c.path!, name: c.name })) });
    setText('');
    setMentions([]);
    setChips([]);
    setError(null);
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => (a + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(suggestions[active]!);
        return;
      }
      if (e.key === 'Escape') {
        setQuery(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  const listId = `etiket-onerileri-${conversationId}`;
  return (
    <form
      className="border-t border-line px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {chips.length ? (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Eklenecek dosyalar">
          {chips.map((c) => (
            <li key={c.uploadId} className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${c.status === 'error' ? 'border-[#f1b8b2] bg-danger-soft' : 'border-line bg-neutral-soft'}`}>
              <span aria-hidden="true">📎</span>
              <span className="max-w-48 truncate">{c.name}</span>
              <span className="text-muted">
                {c.status === 'uploading' ? 'yükleniyor…' : c.status === 'error' ? `hata: ${c.error}` : formatSize(c.size)}
              </span>
              <button type="button" className="min-h-8 min-w-8 font-bold" aria-label={`${c.name} dosyasını kaldır`} onClick={() => removeChip(c)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="field-error mb-2">
          {error}
        </p>
      ) : null}
      <div className="relative">
        {suggestions.length ? (
          <ul id={listId} role="listbox" aria-label="Etiketlenecek kişi" className="absolute bottom-full left-0 z-10 mb-1 w-72 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
            {suggestions.map((p, i) => (
              <li
                key={p.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`cursor-pointer px-3 py-2 ${i === active ? 'bg-brand-soft font-semibold' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
              >
                @{p.name}
              </li>
            ))}
          </ul>
        ) : null}
        <label htmlFor={`mesaj-${conversationId}`} className="sr-only">
          Mesaj yazın
        </label>
        <textarea
          ref={inputRef}
          id={`mesaj-${conversationId}`}
          className="input min-h-12 resize-y"
          rows={2}
          maxLength={4000}
          placeholder="Mesaj yazın… Kişi etiketlemek için @ yazın"
          value={text}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={suggestions.length > 0}
          aria-controls={suggestions.length ? listId : undefined}
          aria-activedescendant={suggestions.length ? `${listId}-${active}` : undefined}
          aria-describedby={`mesaj-ipucu-${conversationId}`}
          onChange={(e) => {
            setText(e.target.value);
            detectMention(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setQuery(null), 150)}
        />
      </div>
      <p id={`mesaj-ipucu-${conversationId}`} className="hint mt-1">
        Enter gönderir, Shift+Enter yeni satır. Etiketlenen kişiye bildirim gider; etiketlemek görev atamak değildir.
      </p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div>
          <input
            ref={fileRef}
            id={`dosya-${conversationId}`}
            type="file"
            multiple
            accept={ATTACHMENT_MIME_TYPES.join(',')}
            className="sr-only"
            onChange={(e) => void addFiles(e.target.files)}
          />
          <label htmlFor={`dosya-${conversationId}`} className="btn btn-secondary btn-sm cursor-pointer">
            📎 Fotoğraf / dosya
          </label>
        </div>
        <button type="submit" className="btn btn-primary" disabled={!canSend}>
          {uploading ? 'Dosya yükleniyor…' : 'Gönder'}
        </button>
      </div>
    </form>
  );
}

function ConvertToTaskDialog({
  ctx,
  supabase,
  message,
  members,
  canAssignOthers,
  onClose,
  onCreated,
}: {
  ctx: MessagingContext;
  supabase: Client;
  message: Message;
  members: Person[];
  canAssignOthers: boolean;
  onClose: () => void;
  onCreated: (t: MessageTaskLink) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [requestId] = useState(newRequestId);
  // Başlık önerisi: ilk satır, etiketler çıkarılmış
  let firstLine = message.body.split('\n')[0] ?? '';
  for (const m of message.mentions) {
    const name = members.find((p) => p.id === m.user_id)?.name;
    if (name) firstLine = firstLine.split(`@${name}`).join('');
  }
  firstLine = firstLine.replace(/\s+/g, ' ').replace(/^[\s,.:;-]+/, '').trim();
  const [title, setTitle] = useState(
    firstLine.slice(0, 120) || (message.attachments.some((a) => a.is_image) ? 'Fotoğraflı mesajdan görev' : message.attachments.length ? 'Dosyalı mesajdan görev' : 'Mesajdan görev'),
  );
  const [assignee, setAssignee] = useState(ctx.userId);
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<MessageTaskLink | null>(null);
  const options = canAssignOthers ? members : members.filter((m) => m.id === ctx.userId);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog ref={ref} className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-line p-0 backdrop:bg-black/40" onClose={onClose} aria-labelledby="donustur-baslik">
      <form
        className="flex flex-col gap-3 p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (created) return;
          if (title.trim().length < 1) {
            setError('Görev başlığı yazın.');
            return;
          }
          setBusy(true);
          setError(null);
          try {
            const t = await createTaskFromMessage(supabase, {
              messageId: message.id,
              title: title.trim(),
              assigneeId: assignee,
              clientRequestId: requestId,
              dueDate: dueDate || null,
              priority,
            });
            const link = { id: t.id, title: t.title, status: t.status, source_message_id: message.id };
            setCreated(link);
            onCreated(link);
          } catch (err) {
            setError(toAppError(err).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 id="donustur-baslik" className="text-xl font-bold">
          Mesajı göreve dönüştür
        </h2>
        {created ? (
          <>
            <p role="status" className="rounded-xl bg-ok-soft px-3 py-2 font-semibold text-ok">
              <span aria-hidden="true">✓ </span>
              {assignee === ctx.userId ? 'Görev oluşturuldu ve size verildi.' : 'Görev oluşturuldu; sorumluya bildirildi.'}
            </p>
            <div className="flex gap-2">
              <Link href={`/gorevler/${created.id}`} className="btn btn-primary">
                Göreve git
              </Link>
              <button type="button" className="btn btn-secondary" onClick={() => ref.current?.close()}>
                Kapat
              </button>
            </div>
          </>
        ) : (
          <>
            <blockquote className="rounded-xl border-l-4 border-brand bg-neutral-soft px-3 py-2 text-[0.9375rem]">
              {message.body || 'Dosya mesajı'}
            </blockquote>
            <p className="hint">Mesaj metni görevin açıklamasına eklenir; görev bu mesaja bağlanır.</p>
            <div>
              <label htmlFor="gorev-baslik" className="label">
                Görev başlığı
              </label>
              <input id="gorev-baslik" className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="gorev-sorumlu" className="label">
                Sorumlu
              </label>
              <select id="gorev-sorumlu" className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                {options.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.id === ctx.userId ? ' (ben)' : ''}
                  </option>
                ))}
              </select>
              {!canAssignOthers ? <p className="hint">Başkasına görev atama yetkiniz yok; görev size verilir.</p> : null}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="gorev-tarih" className="label">
                  Son tarih (isteğe bağlı)
                </label>
                <input id="gorev-tarih" type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div>
                <label htmlFor="gorev-oncelik" className="label">
                  Öncelik
                </label>
                <select id="gorev-oncelik" className="input" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {TASK_PRIORITY_META[p].label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {error ? (
              <p role="alert" className="field-error">
                {error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Oluşturuluyor…' : 'Görevi oluştur'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => ref.current?.close()}>
                Vazgeç
              </button>
            </div>
          </>
        )}
      </form>
    </dialog>
  );
}
