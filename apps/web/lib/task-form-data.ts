import 'server-only';
import { fetchGroups, localDateKey } from '@istakip/shared';
import type { GroupOption, PersonOption } from '@/components/tasks/task-form';
import type { AppSession } from './session';

/** Görev formu için kişi/grup seçenekleri ve atama yetkisi (arayüz kolaylığı). */
export async function taskFormOptions(s: AppSession) {
  const groups = await fetchGroups(s.supabase, s.companyId);
  const people: PersonOption[] = s.members
    .filter((m) => m.status === 'active')
    .map((m) => ({ id: m.user_id, name: m.profile?.full_name || m.profile?.email || 'İsimsiz' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const groupOptions: GroupOption[] = groups.map((g) => ({ id: g.id, name: g.name, memberIds: g.members.map((m) => m.user_id) }));
  return {
    people,
    groups: groupOptions,
    canAssignAnywhere: s.can('tasks.assign'),
    assignableGroupIds: groups.filter((g) => s.can('tasks.assign', g.id)).map((g) => g.id),
    today: localDateKey(new Date(), s.timezone),
  };
}
