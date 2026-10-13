import { fetchNotifications, formatAgo, formatDateTime, notificationTarget, type AppNotification } from '@istakip/shared';
import Link from 'next/link';
import { markReadAction } from '@/app/(app)/actions';
import { ActionButton } from '@/components/action-button';
import { EmptyState, PageHeader } from '@/components/ui';
import { requireSession } from '@/lib/session';

export const metadata = { title: 'Bildirimler' };

function hrefFor(n: AppNotification): string | null {
  const t = notificationTarget(n);
  if (!t) return null;
  if (t.kind === 'task') return `/gorevler/${t.taskId}`;
  if (t.kind === 'group') return `/gruplar/${t.groupId}`;
  return `/mesajlar/${t.conversationId}${t.messageId ? `?m=${t.messageId}` : ''}`;
}

export default async function NotificationsPage() {
  const s = await requireSession();
  const list = await fetchNotifications(s.supabase, s.companyId, { limit: 100 });
  const unread = list.filter((n) => !n.read_at).length;
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Bildirimler"
        description={unread ? `${unread} okunmamış bildirim` : 'Tüm bildirimler okundu.'}
        actions={unread ? <ActionButton action={markReadAction} fields={{}} label="Tümünü okundu say" small={false} /> : undefined}
      />
      {list.length === 0 ? (
        <EmptyState title="Bildirim yok">Size görev verildiğinde, bir görevde veya mesajda etiketlendiğinizde ya da gruba eklendiğinizde burada görünür.</EmptyState>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {list.map((n) => {
            const href = hrefFor(n);
            const content = (
              <>
                <p className="font-semibold">
                  {!n.read_at ? (
                    <>
                      <span aria-hidden="true" className="mr-1 text-brand">●</span>
                      <span className="sr-only">Okunmamış: </span>
                    </>
                  ) : null}
                  {n.title}
                </p>
                {n.body ? <p className="break-words">{n.body}</p> : null}
                <p className="text-[0.9375rem] text-muted">
                  <time dateTime={n.created_at} title={formatDateTime(n.created_at, s.timezone)}>
                    {formatAgo(n.created_at, now)}
                  </time>
                  {n.actor_id ? ` · ${s.nameOf(n.actor_id)}` : ''}
                </p>
              </>
            );
            return (
              <li key={n.id} className={`flex items-start justify-between gap-3 px-4 py-3 ${n.read_at ? '' : 'bg-brand-soft/40'}`}>
                {href ? (
                  <Link href={href} className="min-w-0 flex-1 hover:underline">
                    {content}
                  </Link>
                ) : (
                  <div className="min-w-0 flex-1">{content}</div>
                )}
                {!n.read_at ? <ActionButton action={markReadAction} fields={{ notificationId: n.id }} label="Okundu işaretle" /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
