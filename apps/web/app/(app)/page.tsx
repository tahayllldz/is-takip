import {
  DASHBOARD_SOURCE_LABELS,
  TASK_STATUSES,
  TASK_STATUS_META,
  WIDGETS,
  addableWidgets,
  compareTasksByUrgency,
  fetchAwaitingMyApproval,
  fetchDashboardLayouts,
  fetchMyMentions,
  fetchTaskSummary,
  fetchTasks,
  formatAgo,
  isTodayTask,
  resolveDashboard,
  type WidgetDef,
  type WidgetId,
} from '@istakip/shared';
import Link from 'next/link';
import { DashboardEditor } from '@/components/dashboard-editor';
import { TaskList } from '@/components/tasks/task-list';
import { Alert, ButtonLink, Card, EmptyState, PageHeader } from '@/components/ui';
import { moduleOn, requireSession, type AppSession } from '@/lib/session';

export const metadata = { title: 'Ana sayfa' };

/**
 * Ana sayfa: bileşenler kişisel düzen → şirket/rol varsayılanı → standart düzen sırasıyla gösterilir
 * (packages/shared/src/dashboard.ts). Bileşen yalnızca veriyi gösterir; hangi kaydın görüneceğini RLS belirler.
 * Kapalı modülün bileşeni gösterilmez; izin gerektiren bileşen izni olmayana gösterilmez.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<{ duzenle?: string }> }) {
  const [s, sp] = await Promise.all([requireSession(), searchParams]);
  const me = s.members.find((m) => m.user_id === s.userId);
  const firstName = (me?.profile.full_name || '').split(' ')[0];
  const canUse = (w: WidgetDef) => !w.requires || s.can(w.requires) || s.scopeGroupIds.some((g) => s.can(w.requires!, g));

  const layouts = await fetchDashboardLayouts(s.supabase, s.companyId, s.userId, s.active.role, 'web');
  const dash = resolveDashboard({ ...layouts, role: s.active.role, platform: 'web', enabledModules: s.enabledModules, canUse });
  const editing = sp.duzenle === '1';
  const tasksOn = moduleOn(s, 'tasks');
  const myOpen = tasksOn ? await fetchTasks(s.supabase, s.companyId, { scope: 'mine', userId: s.userId, status: 'open' }) : [];
  const myOverdue = myOpen.filter((t) => t.is_overdue);

  return (
    <>
      <PageHeader
        title={`Merhaba${firstName ? ` ${firstName}` : ''}`}
        description={tasksOn ? `${myOpen.length} açık işiniz var${myOverdue.length ? `, ${myOverdue.length} tanesi gecikmiş` : ''}.` : undefined}
        actions={
          <>
            {!editing ? (
              <ButtonLink href="/?duzenle=1" variant="secondary">
                Ana sayfayı düzenle
              </ButtonLink>
            ) : null}
            {tasksOn && s.can('tasks.create') ? <ButtonLink href="/gorevler/yeni">+ Yeni görev</ButtonLink> : null}
          </>
        }
      />

      {editing ? (
        <div className="mb-6">
          <DashboardEditor
            mode="personal"
            platform="web"
            source={dash.source}
            initial={dash.widgets.map((id) => ({ id, title: WIDGETS[id].title, description: WIDGETS[id].description }))}
            hidden={dash.hidden}
            available={addableWidgets(dash.widgets, s.enabledModules, canUse).map((w) => ({ id: w.id, title: w.title, description: w.description }))}
          />
        </div>
      ) : (
        <p className="mb-3 text-sm text-muted">
          Düzen: {DASHBOARD_SOURCE_LABELS[dash.source]}
          {dash.hidden.length ? ` · ${dash.hidden.length} bileşen kapalı modül nedeniyle gizli` : ''}
        </p>
      )}

      {dash.widgets.length === 0 ? (
        <Alert tone="info" title="Ana sayfanızda bileşen yok">
          “Ana sayfayı düzenle” ile bileşen ekleyebilirsiniz.
        </Alert>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {dash.widgets.map((id) => (
            <Widget key={id} id={id} s={s} myOpen={myOpen} />
          ))}
        </div>
      )}
    </>
  );
}

async function Widget({ id, s, myOpen }: { id: WidgetId; s: AppSession; myOpen: Awaited<ReturnType<typeof fetchTasks>> }) {
  const now = new Date();
  const approvalOn = moduleOn(s, 'task_approval');
  const canSeeTeam = s.can('tasks.view_all') || s.scopeGroupIds.length > 0;
  const more = (href: string, label = 'Tümü') => (
    <Link className="font-semibold text-brand underline" href={href}>
      {label}
    </Link>
  );

  switch (id) {
    case 'my_today': {
      const today = myOpen.filter((t) => isTodayTask(t, s.timezone, now)).sort((a, b) => compareTasksByUrgency(a, b, now));
      return (
        <Card title="Bugünkü işlerim" actions={more('/gorevler?g=mine')}>
          {today.length ? (
            <TaskList approvalOn={approvalOn} tasks={today} tz={s.timezone} nameOf={s.nameOf} showAssignee={false} showCreator />
          ) : (
            <EmptyState title="Bugün için bekleyen işiniz yok">Son tarihi bugün veya geçmiş açık göreviniz bulunmuyor.</EmptyState>
          )}
        </Card>
      );
    }
    case 'overdue': {
      const list = canSeeTeam
        ? await fetchTasks(s.supabase, s.companyId, { scope: 'all', userId: s.userId, overdueOnly: true, limit: 20 })
        : myOpen.filter((t) => t.is_overdue);
      list.sort((a, b) => compareTasksByUrgency(a, b, now));
      return (
        <Card title={canSeeTeam ? 'Geciken işler (ekip)' : 'Geciken işlerim'} actions={more('/gorevler?g=overdue')}>
          {list.length ? (
            <TaskList approvalOn={approvalOn} tasks={list} tz={s.timezone} nameOf={s.nameOf} showAssignee={canSeeTeam} showCreator />
          ) : (
            <EmptyState title="Geciken iş yok" />
          )}
        </Card>
      );
    }
    case 'assigned_by_me': {
      const created = await fetchTasks(s.supabase, s.companyId, { scope: 'created', userId: s.userId, status: 'open', limit: 20 });
      created.sort((a, b) => compareTasksByUrgency(a, b, now));
      return (
        <Card title="Verdiğim işler" actions={more('/gorevler?g=created')}>
          {created.length ? (
            <TaskList approvalOn={approvalOn} tasks={created} tz={s.timezone} nameOf={s.nameOf} />
          ) : (
            <EmptyState title="Başkasına verdiğiniz açık iş yok" action={s.can('tasks.assign') ? <ButtonLink href="/gorevler/yeni" variant="secondary">Görev ver</ButtonLink> : undefined} />
          )}
        </Card>
      );
    }
    case 'awaiting_my_approval': {
      const waiting = await fetchAwaitingMyApproval(s.supabase, s.companyId, s.userId, 20);
      return (
        <Card title={`Onayımı bekleyenler${waiting.length ? ` (${waiting.length})` : ''}`}>
          {waiting.length ? (
            <TaskList approvalOn tasks={waiting} tz={s.timezone} nameOf={s.nameOf} showCreator={false} />
          ) : (
            <EmptyState title="Onayınızı bekleyen görev yok">Onaylayıcısı olduğunuz bir görev tamamlandığında burada görünür.</EmptyState>
          )}
        </Card>
      );
    }
    case 'mentions': {
      const mentions = await fetchMyMentions(s.supabase, s.companyId, 5).catch(() => []);
      return (
        <Card title="Etiketlendiğim mesajlar" actions={more('/mesajlar', 'Mesajlar')}>
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
    case 'team_summary': {
      const summary = await fetchTaskSummary(s.supabase, s.companyId);
      return (
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
      );
    }
  }
}
