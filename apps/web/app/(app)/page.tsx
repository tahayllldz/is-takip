import {
  TASK_STATUSES,
  TASK_STATUS_META,
  compareTasksByUrgency,
  fetchMyMentions,
  fetchTaskSummary,
  fetchTasks,
  formatAgo,
  isTodayTask,
} from '@istakip/shared';
import Link from 'next/link';
import { TaskList } from '@/components/tasks/task-list';
import { Alert, ButtonLink, Card, EmptyState, PageHeader } from '@/components/ui';
import { moduleOn, requireSession, type AppSession } from '@/lib/session';

/** Etiketlendiğim mesajlar (İletişim modülü). Yalnızca görebildiği konuşmalardaki etiketler (RLS). */
async function MentionsCard({ s }: { s: AppSession }) {
  const mentions = await fetchMyMentions(s.supabase, s.companyId, 5).catch(() => []);
  const now = new Date();
  return (
    <Card title="Etiketlendiğim mesajlar" actions={<Link className="font-semibold text-brand underline" href="/mesajlar">Mesajlar</Link>}>
      {mentions.length ? (
        <ul className="divide-y divide-line">
          {mentions.map((m) => (
            <li key={m.message_id}>
              <Link href={`/mesajlar/${m.conversation_id}?m=${m.message_id}`} className="block py-2 hover:underline">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    {!m.is_read ? (
                      <>
                        <span aria-hidden="true" className="mr-1 text-brand">●</span>
                        <span className="sr-only">Okunmamış: </span>
                      </>
                    ) : null}
                    {s.nameOf(m.author_id)} · {m.conversation_title}
                  </span>
                  <time dateTime={m.created_at} className="shrink-0 text-sm text-muted">
                    {formatAgo(m.created_at, now)}
                  </time>
                </span>
                <span className="line-clamp-2 break-words text-muted">{m.body || '📎 Dosya'}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Sizi etiketleyen mesaj yok">Biri sizi bir mesajda @ ile etiketlediğinde burada görünür.</EmptyState>
      )}
    </Card>
  );
}

export const metadata = { title: 'Ana sayfa' };

/**
 * Ana sayfa (Aşama 1: rol bazlı sabit varsayılan düzen).
 * Çalışanda kendi işleri öne çıkar; görev veren/yöneticide geciken ve verdiği işler.
 * Bileşenler yalnızca veriyi gösterir; hangi görevlerin görüneceğini RLS belirler.
 * Düzenlenebilir ana sayfa Aşama 3'te eklenecek.
 */
export default async function HomePage() {
  const s = await requireSession();
  const me = s.members.find((m) => m.user_id === s.userId);
  const firstName = (me?.profile.full_name || '').split(' ')[0];

  const messagingOn = moduleOn(s, 'messaging');
  if (!moduleOn(s, 'tasks')) {
    return (
      <>
        <PageHeader title={`Merhaba${firstName ? ` ${firstName}` : ''}`} />
        {messagingOn ? (
          <div className="grid gap-6 xl:grid-cols-2">
            <MentionsCard s={s} />
          </div>
        ) : (
          <Alert tone="info">Şirketinizde açık bir iş modülü bulunmuyor.</Alert>
        )}
      </>
    );
  }

  const canSeeTeam = s.can('tasks.view_all') || s.scopeGroupIds.length > 0;
  const [mine, overdueAll, created, summary] = await Promise.all([
    fetchTasks(s.supabase, s.companyId, { scope: 'mine', userId: s.userId, status: 'open' }),
    canSeeTeam ? fetchTasks(s.supabase, s.companyId, { scope: 'all', userId: s.userId, overdueOnly: true, limit: 20 }) : Promise.resolve([]),
    fetchTasks(s.supabase, s.companyId, { scope: 'created', userId: s.userId, status: 'open', limit: 20 }),
    canSeeTeam ? fetchTaskSummary(s.supabase, s.companyId) : Promise.resolve([]),
  ]);
  const now = new Date();
  const today = mine.filter((t) => isTodayTask(t, s.timezone, now)).sort((a, b) => compareTasksByUrgency(a, b, now));
  const myOverdue = mine.filter((t) => t.is_overdue);
  const overdue = (canSeeTeam ? overdueAll : myOverdue).sort((a, b) => compareTasksByUrgency(a, b, now));
  created.sort((a, b) => compareTasksByUrgency(a, b, now));

  return (
    <>
      <PageHeader
        title={`Merhaba${firstName ? ` ${firstName}` : ''}`}
        description={`${mine.length} açık işiniz var${myOverdue.length ? `, ${myOverdue.length} tanesi gecikmiş` : ''}.`}
        actions={<ButtonLink href="/gorevler/yeni">+ Yeni görev</ButtonLink>}
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Bugünkü işlerim" actions={<a className="font-semibold text-brand underline" href="/gorevler?g=mine">Tümü</a>}>
          {today.length ? (
            <TaskList tasks={today} tz={s.timezone} nameOf={s.nameOf} showAssignee={false} showCreator />
          ) : (
            <EmptyState title="Bugün için bekleyen işiniz yok">Son tarihi bugün veya geçmiş açık göreviniz bulunmuyor.</EmptyState>
          )}
        </Card>

        <Card title={canSeeTeam ? 'Geciken işler (ekip)' : 'Geciken işlerim'} actions={<a className="font-semibold text-brand underline" href="/gorevler?g=overdue">Tümü</a>}>
          {overdue.length ? (
            <TaskList tasks={overdue} tz={s.timezone} nameOf={s.nameOf} showCreator />
          ) : (
            <EmptyState title="Geciken iş yok" />
          )}
        </Card>

        {messagingOn ? <MentionsCard s={s} /> : null}

        {created.length || s.can('tasks.assign') || s.scopeGroupIds.length ? (
          <Card title="Verdiğim işler" actions={<a className="font-semibold text-brand underline" href="/gorevler?g=created">Tümü</a>}>
            {created.length ? (
              <TaskList tasks={created} tz={s.timezone} nameOf={s.nameOf} />
            ) : (
              <EmptyState title="Başkasına verdiğiniz açık iş yok" action={<ButtonLink href="/gorevler/yeni" variant="secondary">Görev ver</ButtonLink>} />
            )}
          </Card>
        ) : null}

        {canSeeTeam ? (
          <Card title="Ekip görev özeti">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {TASK_STATUSES.map((st) => {
                const row = summary.find((r) => r.status === st);
                return (
                  <div key={st} className="rounded-xl border border-line p-3">
                    <dt className="text-[0.9375rem] text-muted">
                      <span aria-hidden="true">{TASK_STATUS_META[st].symbol} </span>
                      {TASK_STATUS_META[st].label}
                    </dt>
                    <dd className="text-2xl font-bold">{row?.total ?? 0}</dd>
                  </div>
                );
              })}
            </dl>
            <p className="mt-3 font-semibold text-danger">
              <span aria-hidden="true">⚠ </span>
              {summary.reduce((n, r) => n + r.overdue, 0)} görev gecikmede
            </p>
          </Card>
        ) : null}
      </div>
    </>
  );
}
