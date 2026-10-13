import 'server-only';
import { fetchGroups, localDateKey } from '@istakip/shared';
import type { GroupOption, PersonOption } from '@/components/tasks/task-form';
import { moduleOn, type AppSession } from './session';

/** Görev formu için kişi/grup seçenekleri ve atama yetkisi (arayüz kolaylığı). */
export async function taskFormOptions(s: AppSession) {
  const groups = await fetchGroups(s.supabase, s.companyId);
  const people: PersonOption[] = s.members
    .filter((m) => m.status === 'active')
    .map((m) => ({ id: m.user_id, name: m.profile?.full_name || m.profile?.email || 'İsimsiz' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const groupOptions: GroupOption[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    memberIds: g.members.map((m) => m.user_id),
    managerIds: g.members.filter((m) => m.role === 'manager').map((m) => m.user_id),
  }));
  // Onaylayıcı adayları (arayüz kolaylığı; asıl kontrol assert_valid_approver): sahip ve şirket geneli yöneticiler.
  // Grup görevlerinde ayrıca o grubun yöneticileri (GroupOption.managerIds).
  const companyApproverIds = s.members
    .filter((m) => m.status === 'active' && (m.role === 'owner' || (m.role === 'admin' && m.admin_scope === 'company')))
    .map((m) => m.user_id);
  return {
    people,
    groups: groupOptions,
    canAssignAnywhere: s.can('tasks.assign'),
    assignableGroupIds: groups.filter((g) => s.can('tasks.assign', g.id)).map((g) => g.id),
    today: localDateKey(new Date(), s.timezone),
    approvalOn: moduleOn(s, 'task_approval'),
    companyApproverIds,
  };
}
