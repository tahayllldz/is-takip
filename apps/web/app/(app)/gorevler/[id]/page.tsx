import { randomUUID } from 'node:crypto';
import {
  assignmentSteps,
  describeTaskEvent,
  fetchGroups,
  fetchMessageRef,
  fetchTask,
  formatDate,
  formatDateTime,
  localDateKey,
  localTimeKey,
} from '@istakip/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AcceptButton, CommentForm, MarkSeen, StatusActions } from '@/components/tasks/task-actions';
import { TaskForm } from '@/components/tasks/task-form';
import { ApprovalDecision, ApprovalSettings } from '@/components/tasks/approval';
import { Alert, ApprovalBadge, Avatar, Card, DueBadge, PriorityBadge, StatusBadge } from '@/components/ui';
import { moduleOn, requireSession } from '@/lib/session';
import { taskFormOptions } from '@/lib/task-form-data';

export const metadata = { title: 'Görev' };

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ yeni?: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const { yeni } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const detail = await fetchTask(s.supabase, id);
  if (!detail) notFound();
  const { task, contributorIds, events, comments } = detail;
  const tasksOn = moduleOn(s, 'tasks');

  const messagingOn = moduleOn(s, 'messaging');
  const [groups, sourceMessage] = await Promise.all([
    fetchGroups(s.supabase, s.companyId),
    task.source_message_id && messagingOn ? fetchMessageRef(s.supabase, task.source_message_id).catch(() => null) : Promise.resolve(null),
  ]);
  const group = groups.find((g) => g.id === task.group_id);
  const isAssignee = task.assignee_id === s.userId;
  const isCreator = task.created_by === s.userId;
  const canManage = tasksOn && (isCreator || s.can('tasks.manage_all', task.group_id));
  const canStatus = tasksOn && (isAssignee || canManage);
  const assigneeRemoved = s.members.find((m) => m.user_id === task.assignee_id)?.status === 'removed';

  // Görev onayı (arayüz kararı; kesin kontrol approve_task / request_task_changes içinde)
  const approvalOn = tasksOn && moduleOn(s, 'task_approval');
  const approverRemoved = task.approver_id ? s.members.find((m) => m.user_id === task.approver_id)?.status !== 'active' : false;
  const canDecide =
    approvalOn &&
    task.approval_status === 'pending' &&
    s.userId !== task.assignee_id &&
    ((task.approver_id === s.userId && s.can('tasks.approve', task.group_id)) ||
      (approverRemoved && s.can('tasks.approve', task.group_id) && s.can('tasks.manage_all', task.group_id)));

  // Etiketlenebilecek kişiler: görevi görebilen katılımcılar (sunucu ayrıca doğrular)
  const participantIds = new Set<string>([task.assignee_id, task.created_by, ...contributorIds, ...(group?.members.map((m) => m.user_id) ?? [])]);
  participantIds.delete(s.userId);
  const mentionable = s.members
    .filter((m) => m.status === 'active' && participantIds.has(m.user_id))
    .map((m) => ({ id: m.user_id, name: s.nameOf(m.user_id) }));

  const editOpts = canManage ? await taskFormOptions(s) : null;
  const approverCandidates = (() => {
    const ids = new Set(
      s.members
        .filter((m) => m.status === 'active' && (m.role === 'owner' || (m.role === 'admin' && m.admin_scope === 'company')))
        .map((m) => m.user_id),
    );
    for (const gm of group?.members ?? []) if (gm.role === 'manager') ids.add(gm.user_id);
    ids.delete(task.assignee_id);
    return [...ids].map((id) => ({ id, name: s.nameOf(id) })).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  })();

  return (
    <>
      {isAssignee && !task.seen_at && tasksOn ? <MarkSeen taskId={task.id} /> : null}
      <p className="mb-2">
        <Link href="/gorevler" className="font-semibold text-brand underline">
          ← Görevler
        </Link>
      </p>
      {yeni ? (
        <div className="mb-4">
          <Alert tone="success">Görev oluşturuldu{task.assignee_id !== s.userId ? ' ve sorumluya bildirim gönderildi' : ''}.</Alert>
        </div>
      ) : null}
      {!tasksOn ? (
        <div className="mb-4">
          <Alert tone="warning" title="Arşiv görünümü (salt okunur)">
            Görevler modülü kapalı. Kayıtlar silinmedi; modül yeniden açılınca işlem yapılabilir.
          </Alert>
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold break-words">{task.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            <DueBadge task={task} tz={s.timezone} />
            {approvalOn && task.approval_status ? <ApprovalBadge status={task.approval_status} /> : null}
          </div>
          {approvalOn && task.approval_status === 'changes_requested' && task.approval_note ? (
            <p className="mt-2 rounded-xl border border-[#f1b8b2] bg-danger-soft px-3 py-2">
              <strong>Düzeltme istendi ({s.nameOf(task.approval_decided_by)}):</strong> {task.approval_note}
            </p>
          ) : null}
          {task.status === 'on_hold' && task.hold_reason ? (
            <p className="mt-2">
              <strong>Beklemede nedeni:</strong> {task.hold_reason}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {canStatus ? (
            <Card title="İşlemler">
              <div className="space-y-3">
                <StatusActions taskId={task.id} status={task.status} version={task.version} />
                {isAssignee && !task.accepted_at && task.status !== 'done' ? <AcceptButton taskId={task.id} /> : null}
              </div>
            </Card>
          ) : null}

          {approvalOn && (task.requires_approval || canManage) ? (
            <Card title="Onay">
              <div className="space-y-3">
                {task.requires_approval ? (
                  <p>
                    Onaylayacak kişi: <strong>{s.nameOf(task.approver_id)}</strong>
                    {approverRemoved ? <span className="ml-1 text-danger">(şirketten ayrıldı)</span> : null}
                    {' · '}
                    {task.approval_status ? <ApprovalBadge status={task.approval_status} /> : <span className="text-muted">Görev tamamlanınca onaya düşer.</span>}
                  </p>
                ) : (
                  <p className="text-muted">Bu görev onay gerektirmiyor.</p>
                )}
                {canDecide ? <ApprovalDecision taskId={task.id} /> : null}
                {task.approval_status === 'pending' && !canDecide ? <p className="text-muted">Onaylayıcının kararı bekleniyor.</p> : null}
                {canManage ? (
                  <details>
                    <summary className="cursor-pointer font-semibold text-brand">Onay ayarını değiştir</summary>
                    <div className="mt-2">
                      <ApprovalSettings
                        taskId={task.id}
                        requiresApproval={task.requires_approval}
                        approverId={task.approver_id}
                        candidates={approverCandidates}
                        me={s.userId}
                      />
                    </div>
                  </details>
                ) : null}
              </div>
            </Card>
          ) : null}

          <Card title="Açıklama">
            {task.description ? <p className="whitespace-pre-wrap">{task.description}</p> : <p className="text-muted">Açıklama yok.</p>}
          </Card>

          <Card title={`Yorumlar (${comments.length})`}>
            {comments.length ? (
              <ul className="mb-4 space-y-4">
                {comments.map((c) => (
                  <li key={c.id} className="flex gap-3">
                    <Avatar name={s.nameOf(c.author_id)} />
                    <div className="min-w-0">
                      <p className="text-[0.9375rem]">
                        <strong>{s.nameOf(c.author_id)}</strong> <span className="text-muted">· {formatDateTime(c.created_at, s.timezone)}</span>
                      </p>
                      <p className="whitespace-pre-wrap break-words">{c.body}</p>
                      {c.mentions?.length ? (
                        <p className="text-[0.9375rem] text-muted">Etiketlenen: {c.mentions.map((m) => '@' + s.nameOf(m.user_id)).join(', ')}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-4 text-muted">Henüz yorum yok.</p>
            )}
            {tasksOn ? <CommentForm taskId={task.id} clientRequestId={randomUUID()} mentionable={mentionable} /> : null}
          </Card>

          {canManage && editOpts ? (
            <details className="card p-5">
              <summary className="cursor-pointer text-lg font-bold">Görevi düzenle</summary>
              <div className="mt-4">
                <TaskForm
                  mode="edit"
                  me={s.userId}
                  taskId={task.id}
                  version={task.version}
                  {...editOpts}
                  defaults={{
                    title: task.title,
                    description: task.description,
                    assigneeId: task.assignee_id,
                    contributorIds,
                    groupId: task.group_id,
                    priority: task.priority,
                    dueDate: task.due_at ? localDateKey(task.due_at, s.timezone) : null,
                    dueTime: task.due_at && !task.due_all_day ? localTimeKey(task.due_at, s.timezone) : null,
                  }}
                />
              </div>
            </details>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card title="Bilgiler">
            <dl className="space-y-2">
              <div>
                <dt className="text-muted">Sorumlu</dt>
                <dd className="font-semibold">
                  {s.nameOf(task.assignee_id)}
                  {assigneeRemoved ? <span className="ml-1 text-danger">(şirketten ayrıldı — yeniden atayın)</span> : null}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Görevi veren</dt>
                <dd className="font-semibold">{s.nameOf(task.created_by)}</dd>
              </div>
              {contributorIds.length ? (
                <div>
                  <dt className="text-muted">Katkıda bulunanlar</dt>
                  <dd>{contributorIds.map((c) => s.nameOf(c)).join(', ')}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-muted">Grup</dt>
                <dd>{group ? <Link className="text-brand underline" href={`/gruplar/${group.id}`}>{group.name}</Link> : 'Yok'}</dd>
              </div>
              {task.source_message_id ? (
                <div>
                  <dt className="text-muted">Kaynak mesaj</dt>
                  <dd>
                    {!messagingOn ? (
                      'İletişim modülü kapalı'
                    ) : !sourceMessage ? (
                      'Mesajı görme erişiminiz yok'
                    ) : sourceMessage.deleted_at ? (
                      'Mesaj silindi'
                    ) : (
                      <Link className="text-brand underline" href={`/mesajlar/${sourceMessage.conversation_id}?m=${sourceMessage.id}`}>
                        “{sourceMessage.body.length > 80 ? `${sourceMessage.body.slice(0, 80)}…` : sourceMessage.body || 'Dosya mesajı'}”
                      </Link>
                    )}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-muted">Son tarih</dt>
                <dd>{task.due_at ? (task.due_all_day ? `${formatDate(task.due_at, s.timezone)} (gün sonu)` : formatDateTime(task.due_at, s.timezone)) : 'Yok'}</dd>
              </div>
              <div>
                <dt className="text-muted">Oluşturulma</dt>
                <dd>{formatDateTime(task.created_at, s.timezone)}</dd>
              </div>
            </dl>
          </Card>

          {task.assignee_id !== task.created_by ? (
            <Card title="Sorumlu takibi">
              <ol className="space-y-2">
                {assignmentSteps(task).map((step) => (
                  <li key={step.key} className="flex items-center justify-between gap-2">
                    <span className="font-semibold">
                      <span aria-hidden="true">{step.at ? '✓ ' : '○ '}</span>
                      {step.label}
                    </span>
                    <span className="text-[0.9375rem] text-muted">{step.at ? formatDateTime(step.at, s.timezone) : 'Henüz değil'}</span>
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}

          <Card title="İşlem geçmişi">
            <ol className="space-y-3">
              {events.map((e) => (
                <li key={e.id} className="text-[0.9375rem]">
                  <p>{describeTaskEvent(e, s.nameOf)}</p>
                  <p className="text-muted">{formatDateTime(e.created_at, s.timezone)}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
