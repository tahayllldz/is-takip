'use client';
/**
 * Mesajlar ekranı: sohbet listesi + seçili sohbet.
 * Veriler tarayıcıda kullanıcının kendi oturumuyla çekilir (RLS süzer); yazma RPC ile.
 * Realtime olayları yalnızca "yenile" sinyalidir; bağlantı geri gelince, sekmeye dönülünce
 * veya internet geri gelince liste ve açık sohbet yeniden çekilir (kaçırılan mesaj kalmaz).
 */
import {
  fetchConversationList,
  formatDayRelative,
  formatTime,
  getOrCreateDirectConversation,
  hasPermission,
  localDateKey,
  subscribeCompanyChanges,
  toAppError,
  type AdminScope,
  type ConversationListItem,
  type ModuleId,
  type PermissionKey,
  type Role,
} from '@istakip/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ConversationPane } from './conversation-pane';

export interface Person {
  id: string;
  name: string;
  active: boolean;
}

export interface MessagingContext {
  companyId: string;
  userId: string;
  timezone: string;
  people: Person[];
  perm: { role: Role; adminScope: AdminScope; scopeGroupIds: string[]; managedGroupIds: string[]; enabledModules: ModuleId[] };
}

export function useCan(ctx: MessagingContext) {
  return useCallback(
    (perm: PermissionKey, groupId?: string | null) =>
      hasPermission(
        { role: ctx.perm.role, adminScope: ctx.perm.adminScope, scopeGroupIds: ctx.perm.scopeGroupIds, managedGroupIds: ctx.perm.managedGroupIds },
        perm,
        { groupId, enabledModules: ctx.perm.enabledModules },
      ),
    [ctx.perm],
  );
}

export function MessagesApp({
  ctx,
  selectedId,
  highlightId,
  initialList,
}: {
  ctx: MessagingContext;
  selectedId: string | null;
  highlightId: string | null;
  initialList: ConversationListItem[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [list, setList] = useState(initialList);
  const [listError, setListError] = useState<string | null>(null);
  const [live, setLive] = useState<'connecting' | 'live' | 'offline'>('connecting');
  // Açık sohbetin yeniden çekilmesi için sayaç (Realtime olayı, yeniden bağlanma, sekmeye dönüş)
  const [paneVersion, setPaneVersion] = useState(0);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const refreshList = useCallback(async () => {
    try {
      setList(await fetchConversationList(supabase, ctx.companyId));
      setListError(null);
    } catch (e) {
      setListError(toAppError(e).message);
    }
  }, [supabase, ctx.companyId]);

  useEffect(() => {
    const unsubscribe = subscribeCompanyChanges(
      supabase,
      ctx.companyId,
      ctx.userId,
      {
        // Mesajdan görev oluşunca veya görevin durumu değişince açık sohbetteki görev bağlantıları güncellensin
        onTasks: () => setPaneVersion((v) => v + 1),
        onMessages: (conversationId) => {
          void refreshList();
          if (!conversationId || conversationId === selectedRef.current) setPaneVersion((v) => v + 1);
        },
        onLive: (s) => {
          setLive(s);
          if (s === 'live') {
            void refreshList();
            setPaneVersion((v) => v + 1);
          }
        },
      },
      'messages',
    );
    const catchUp = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshList();
      setPaneVersion((v) => v + 1);
    };
    document.addEventListener('visibilitychange', catchUp);
    window.addEventListener('online', catchUp);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', catchUp);
      window.removeEventListener('online', catchUp);
    };
  }, [supabase, ctx.companyId, ctx.userId, refreshList]);

  const selected = list.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="grid min-h-[34rem] gap-4 md:h-[calc(100vh-11rem)] md:grid-cols-[19rem_1fr]">
      <section
        aria-label="Sohbetler"
        className={`card flex min-h-0 flex-col overflow-hidden ${selectedId ? 'hidden md:flex' : 'flex'}`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h1 className="text-xl font-bold">Mesajlar</h1>
          {live === 'offline' ? (
            <span className="rounded-full border border-[#f3d39a] bg-warn-soft px-2 py-0.5 text-sm font-semibold text-warn">
              <span aria-hidden="true">⚠ </span>Bağlantı yok
            </span>
          ) : null}
        </div>
        <NewDirectMessage ctx={ctx} supabaseCreate={(userId) => getOrCreateDirectConversation(supabase, ctx.companyId, userId)} onOpen={(id) => router.push(`/mesajlar/${id}`)} />
        {listError ? (
          <p role="alert" className="px-4 py-2 font-medium text-danger">
            {listError}
          </p>
        ) : null}
        <ConversationList list={list} ctx={ctx} selectedId={selectedId} />
      </section>

      <section aria-label="Seçili sohbet" className={`card min-h-0 flex-col overflow-hidden ${selectedId ? 'flex' : 'hidden md:flex'}`}>
        {selectedId ? (
          <ConversationPane
            key={`${selectedId}:${highlightId ?? ""}`}
            ctx={ctx}
            supabase={supabase}
            conversationId={selectedId}
            listItem={selected}
            highlightId={highlightId}
            version={paneVersion}
            onRead={() => {
              void refreshList();
              router.refresh(); // menüdeki okunmamış sayısı
            }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-muted">
            <p>Soldan bir sohbet seçin veya yeni bir birebir mesaj başlatın.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function ConversationList({ list, ctx, selectedId }: { list: ConversationListItem[]; ctx: MessagingContext; selectedId: string | null }) {
  const nameOf = (id: string | null) => ctx.people.find((p) => p.id === id)?.name ?? 'Eski üye';
  const today = localDateKey(new Date(), ctx.timezone);
  if (list.length === 0) {
    return (
      <div className="p-4 text-muted">
        <p className="font-semibold text-ink">Henüz sohbet yok</p>
        <p>Bir gruba eklendiğinizde grubun sohbeti burada görünür. Yukarıdan birebir mesaj başlatabilirsiniz.</p>
      </div>
    );
  }
  return (
    <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
      {list.map((c) => {
        const active = c.id === selectedId;
        const author = !c.last_message_author
          ? null
          : c.last_message_author === ctx.userId
            ? 'Siz'
            : c.kind === 'group'
              ? nameOf(c.last_message_author).split(' ')[0]
              : null;
        const preview = c.last_message_deleted
          ? 'Mesaj silindi'
          : c.last_message_body
            ? c.last_message_body
            : c.last_message_has_files
              ? '📎 Dosya'
              : c.last_message_at
                ? ''
                : 'Henüz mesaj yok';
        const when = c.last_message_at
          ? localDateKey(c.last_message_at, ctx.timezone) === today
            ? formatTime(c.last_message_at, ctx.timezone)
            : formatDayRelative(c.last_message_at, ctx.timezone)
          : '';
        return (
          <li key={c.id}>
            <Link
              href={`/mesajlar/${c.id}`}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-16 gap-3 px-4 py-3 hover:bg-neutral-soft ${active ? 'bg-brand-soft' : ''}`}
            >
              <span aria-hidden="true" className="mt-0.5 text-lg">
                {c.kind === 'group' ? '👥' : '👤'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`truncate ${c.unread_count ? 'font-bold' : 'font-semibold'}`}>
                    <span className="sr-only">{c.kind === 'group' ? 'Grup: ' : 'Birebir: '}</span>
                    {c.title}
                  </span>
                  <span className="shrink-0 text-sm text-muted">{when}</span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className={`truncate text-[0.9375rem] ${c.last_message_deleted ? 'italic text-muted' : 'text-muted'}`}>
                    {author && preview && !c.last_message_deleted ? `${author}: ` : ''}
                    {preview}
                  </span>
                  {c.unread_count ? (
                    <span className="shrink-0 rounded-full bg-brand px-2 text-sm font-bold text-white">
                      {c.unread_count > 99 ? '99+' : c.unread_count}
                      <span className="sr-only"> okunmamış mesaj</span>
                    </span>
                  ) : null}
                </span>
                {!c.can_post ? <span className="text-sm text-muted">Yalnızca okunabilir</span> : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function NewDirectMessage({
  ctx,
  supabaseCreate,
  onOpen,
}: {
  ctx: MessagingContext;
  supabaseCreate: (userId: string) => Promise<string>;
  onOpen: (conversationId: string) => void;
}) {
  const can = useCan(ctx);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const people = ctx.people.filter((p) => p.active && p.id !== ctx.userId).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  if (!can('messages.direct') || people.length === 0) return null;

  if (!open) {
    return (
      <div className="border-b border-line px-4 py-2">
        <button type="button" className="btn btn-secondary btn-sm w-full" onClick={() => setOpen(true)}>
          + Birebir mesaj
        </button>
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-2 border-b border-line px-4 py-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!userId) {
          setError('Kişi seçin.');
          return;
        }
        setBusy(true);
        setError(null);
        try {
          onOpen(await supabaseCreate(userId));
          setOpen(false);
          setUserId('');
        } catch (err) {
          setError(toAppError(err).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor="dm-person" className="label">
        Kime?
      </label>
      <select id="dm-person" className="input" value={userId} onChange={(e) => setUserId(e.target.value)} aria-invalid={error ? true : undefined}>
        <option value="">Kişi seçin</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary btn-sm flex-1" disabled={busy}>
          {busy ? 'Açılıyor…' : 'Mesaj başlat'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>
          Vazgeç
        </button>
      </div>
    </form>
  );
}
