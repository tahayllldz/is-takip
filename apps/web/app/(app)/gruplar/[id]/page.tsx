import { GROUP_ROLE_LABELS, compareTasksByUrgency, fetchGroupConversationId, fetchGroups, fetchTasks } from '@istakip/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { archiveGroupAction, removeGroupMemberAction, setGroupRoleAction } from '@/app/(app)/actions';
import { ActionButton } from '@/components/action-button';
import { AddMembersForm, EditGroupForm } from '@/components/group-forms';
import { TaskList } from '@/components/tasks/task-list';
import { Avatar, Badge, ButtonLink, Card, EmptyState, PageHeader } from '@/components/ui';
import { moduleOn, requireSession } from '@/lib/session';

export const metadata = { title: 'Grup' };

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const groups = await fetchGroups(s.supabase, s.companyId);
  const group = groups.find((g) => g.id === id);
  if (!group) notFound();

  const canManage = s.can('groups.manage', group.id);
  const isMember = group.members.some((m) => m.user_id === s.userId);
  const [tasks, conversationId] = await Promise.all([
    moduleOn(s, 'tasks') ? fetchTasks(s.supabase, s.companyId, { scope: 'group', groupId: group.id, userId: s.userId, status: 'open' }) : Promise.resolve([]),
    moduleOn(s, 'messaging') && isMember ? fetchGroupConversationId(s.supabase, group.id).catch(() => null) : Promise.resolve(null),
  ]);
  tasks.sort((a, b) => compareTasksByUrgency(a, b));
  const memberIds = new Set(group.members.map((m) => m.user_id));
  const candidates = s.members
    .filter((m) => m.status === 'active' && !memberIds.has(m.user_id))
    .map((m) => ({ id: m.user_id, name: s.nameOf(m.user_id) }));
  const members = [...group.members].sort((a, b) => (a.role === b.role ? s.nameOf(a.user_id).localeCompare(s.nameOf(b.user_id), 'tr') : a.role === 'manager' ? -1 : 1));

  return (
    <>
      <p className="mb-2">
        <Link href="/gruplar" className="font-semibold text-brand underline">
          ← Gruplar
        </Link>
      </p>
      <PageHeader
        title={group.name}
        description={group.description || undefined}
        actions={
          <>
            {conversationId ? (
              <ButtonLink href={`/mesajlar/${conversationId}`} variant="secondary">
                Grup sohbeti
              </ButtonLink>
            ) : null}
            {moduleOn(s, 'tasks') && (s.can('tasks.assign', group.id) || isMember) ? (
              <ButtonLink href={`/gorevler/yeni?grup=${group.id}`}>+ Bu gruba görev</ButtonLink>
            ) : null}
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title={`Açık görevler (${tasks.length})`}>
            {tasks.length ? <TaskList approvalOn={moduleOn(s, 'task_approval')} tasks={tasks} tz={s.timezone} nameOf={s.nameOf} showCreator /> : <EmptyState title="Bu grupta açık görev yok" />}
          </Card>
          <Card title={`Üyeler (${group.members.length})`}>
            <ul className="divide-y divide-line">
              {members.map((m) => (
                <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex items-center gap-2">
                    <Avatar name={s.nameOf(m.user_id)} />
                    <span className="font-semibold">{s.nameOf(m.user_id)}</span>
                    {m.role === 'manager' ? <Badge tone="info">{GROUP_ROLE_LABELS.manager}</Badge> : null}
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {canManage ? (
                      <ActionButton
                        action={setGroupRoleAction}
                        fields={{ groupId: group.id, userId: m.user_id, role: m.role === 'manager' ? 'member' : 'manager' }}
                        label={m.role === 'manager' ? 'Yöneticiliği kaldır' : 'Grup yöneticisi yap'}
                      />
                    ) : null}
                    {canManage || m.user_id === s.userId ? (
                      <ActionButton
                        action={removeGroupMemberAction}
                        fields={{ groupId: group.id, userId: m.user_id }}
                        label={m.user_id === s.userId ? 'Gruptan ayrıl' : 'Çıkar'}
                        variant="danger"
                        confirm={`${s.nameOf(m.user_id)} gruptan çıkarılsın mı? Grup mesaj ve görevlerine erişimi hemen kapanır.`}
                      />
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        {canManage ? (
          <div className="space-y-6">
            <Card title="Üye ekle">
              <AddMembersForm groupId={group.id} candidates={candidates} />
            </Card>
            <Card title="Grup bilgileri">
              <EditGroupForm groupId={group.id} name={group.name} description={group.description} />
            </Card>
            {s.can('groups.create') ? (
              <Card title="Grubu arşivle">
                <p className="mb-3 text-muted">Arşivlenen grup listelerden kalkar; geçmiş görevler silinmez.</p>
                <ActionButton action={archiveGroupAction} fields={{ groupId: group.id }} label="Arşivle" variant="danger" confirm="Grup arşivlensin mi?" />
              </Card>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
