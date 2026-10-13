import { compareTasksByUrgency, fetchGroups, fetchTasks, type TaskListScope } from '@istakip/shared';
import Link from 'next/link';
import { TaskList } from '@/components/tasks/task-list';
import { Alert, ButtonLink, EmptyState, PageHeader } from '@/components/ui';
import { moduleOn, requireSession } from '@/lib/session';

export const metadata = { title: 'Görevler' };

const TABS = [
  { key: 'mine', label: 'Bana verilen' },
  { key: 'created', label: 'Verdiğim' },
  { key: 'all', label: 'Ekip' },
  { key: 'overdue', label: 'Geciken' },
] as const;

const STATUS = [
  { key: 'open', label: 'Açık' },
  { key: 'done', label: 'Tamamlanan' },
  { key: 'any', label: 'Tümü' },
] as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ g?: string; durum?: string }> }) {
  const s = await requireSession();
  if (!moduleOn(s, 'tasks')) {
    return <Alert tone="warning" title="Görevler modülü kapalı">Şirket yöneticiniz bu modülü kapattı.</Alert>;
  }
  const sp = await searchParams;
  // Varsayılan: tüm görevleri izleyebilen (sahip/yönetici) ekip listesini, çalışan kendi işlerini görür
  const tab = TABS.find((t) => t.key === sp.g)?.key ?? (s.can('tasks.view_all') ? 'all' : 'mine');
  const status = STATUS.find((t) => t.key === sp.durum)?.key ?? 'open';

  const scope: TaskListScope = tab === 'overdue' || tab === 'all' ? 'all' : tab;
  const [tasks, groups] = await Promise.all([
    fetchTasks(s.supabase, s.companyId, {
      scope,
      userId: s.userId,
      status: tab === 'overdue' ? 'open' : status,
      overdueOnly: tab === 'overdue',
    }),
    fetchGroups(s.supabase, s.companyId),
  ]);
  const now = new Date();
  tasks.sort((a, b) => compareTasksByUrgency(a, b, now));
  const groupName = (id: string | null) => (id ? (groups.find((g) => g.id === id)?.name ?? null) : null);
  const href = (g: string, d: string) => `/gorevler?g=${g}&durum=${d}`;

  return (
    <>
      <PageHeader title="Görevler" actions={<ButtonLink href="/gorevler/yeni">+ Yeni görev</ButtonLink>} />
      <nav aria-label="Görev listeleri" className="mb-3 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={href(t.key, status)}
            aria-current={tab === t.key ? 'page' : undefined}
            className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-secondary'}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab !== 'overdue' ? (
        <nav aria-label="Durum filtresi" className="mb-4 flex flex-wrap gap-2">
          {STATUS.map((d) => (
            <Link
              key={d.key}
              href={href(tab, d.key)}
              aria-current={status === d.key ? 'true' : undefined}
              className={`rounded-full border px-3 py-1 text-[0.9375rem] font-semibold ${
                status === d.key ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface'
              }`}
            >
              {d.label}
            </Link>
          ))}
        </nav>
      ) : null}
      {tab === 'all' ? (
        <p className="mb-3 text-muted">Görebildiğiniz tüm görevler: size ve verdiklerinize ek olarak grup görevleri ve yetkiniz kapsamındakiler.</p>
      ) : null}
      {tasks.length === 0 ? (
        <EmptyState
          title={tab === 'overdue' ? 'Geciken görev yok' : 'Bu listede görev yok'}
          action={tab === 'mine' || tab === 'created' ? <ButtonLink href="/gorevler/yeni">Görev oluştur</ButtonLink> : undefined}
        >
          {tab === 'overdue'
            ? 'Son tarihi geçmiş açık görev bulunmuyor.'
            : tab === 'mine'
              ? 'Size verilmiş bu durumda görev yok. Başka bir liste veya durum seçebilirsiniz.'
              : 'Filtreyi değiştirmeyi deneyin.'}
        </EmptyState>
      ) : (
        <TaskList approvalOn={moduleOn(s, 'task_approval')} tasks={tasks} tz={s.timezone} nameOf={s.nameOf} groupName={groupName} showCreator={tab !== 'created'} />
      )}
    </>
  );
}
