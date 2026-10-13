/**
 * Veri erişim katmanı (web ve mobil ortak).
 *
 * Okumalar doğrudan tablolardan yapılır; RLS kullanıcının görebileceği satırları süzer.
 * Yazmalar yalnızca RPC fonksiyonlarıyla yapılır; yetki, modül ve şirket sınırı
 * kontrolü veritabanındadır. Bu katman yalnızca tip ve hata dönüşümü sağlar.
 */
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { AppError, toAppError } from './errors';
import type { ModuleId } from './modules';
import type { AdminScope, GroupRole, Role } from './permissions';
import type { TaskCreateInput } from './schemas';
import type { TaskStatus } from './tasks';
import type {
  AppNotification,
  AuditEntry,
  GroupWithMembers,
  Invitation,
  Member,
  MembershipWithCompany,
  Task,
  TaskComment,
  TaskDetail,
  TaskEvent,
  TaskSummaryRow,
} from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Client = SupabaseClient<any, any, any>;

interface Result<T> {
  data: T | null;
  error: unknown;
}

async function run<T>(p: PromiseLike<Result<T>>): Promise<T> {
  let res: Result<T>;
  try {
    res = await p;
  } catch (e) {
    throw toAppError(e);
  }
  if (res.error) throw toAppError(res.error);
  return res.data as T;
}

export const TASK_COLUMNS = '*, is_overdue';

// ---------------------------------------------------------------------
// Şirket, üyelik, modüller
// ---------------------------------------------------------------------

export async function fetchMyMemberships(c: Client, userId: string): Promise<MembershipWithCompany[]> {
  return run(
    c
      .from('company_members')
      .select('*, company:companies(*)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('joined_at'),
  );
}

export async function fetchEnabledModules(c: Client, companyId: string): Promise<ModuleId[]> {
  const rows = await run<{ module_id: ModuleId }[]>(
    c.from('company_modules').select('module_id').eq('company_id', companyId).eq('enabled', true),
  );
  return rows.map((r) => r.module_id);
}

export interface ModuleState {
  module_id: ModuleId;
  enabled: boolean;
  updated_at: string;
}

export async function fetchModuleStates(c: Client, companyId: string): Promise<ModuleState[]> {
  return run(c.from('company_modules').select('module_id, enabled, updated_at').eq('company_id', companyId));
}

export async function setModuleEnabled(c: Client, companyId: string, moduleId: ModuleId, enabled: boolean): Promise<void> {
  await run(c.rpc('set_module_enabled', { p_company: companyId, p_module: moduleId, p_enabled: enabled }));
}

export async function createCompany(c: Client, name: string, timezone = 'Asia/Famagusta'): Promise<string> {
  return run(c.rpc('create_company', { p_name: name, p_timezone: timezone }));
}

export async function updateCompany(c: Client, companyId: string, name: string, timezone: string): Promise<void> {
  await run(c.rpc('update_company', { p_company: companyId, p_name: name, p_timezone: timezone }));
}

export async function updateMyProfile(c: Client, fullName: string): Promise<void> {
  await run(c.rpc('update_my_profile', { p_full_name: fullName }));
}

export interface PermissionContext {
  scopeGroupIds: string[];
  managedGroupIds: string[];
}

/** Arayüz kararları için (asıl kontrol veritabanında). */
export async function fetchPermissionContext(c: Client, companyId: string, userId: string): Promise<PermissionContext> {
  const [scope, managed] = await Promise.all([
    run<{ group_id: string }[]>(c.from('member_scope_groups').select('group_id').eq('company_id', companyId).eq('user_id', userId)),
    run<{ group_id: string }[]>(
      c.from('group_members').select('group_id').eq('company_id', companyId).eq('user_id', userId).eq('role', 'manager'),
    ),
  ]);
  return { scopeGroupIds: scope.map((r) => r.group_id), managedGroupIds: managed.map((r) => r.group_id) };
}

export async function fetchMembers(c: Client, companyId: string): Promise<Member[]> {
  return run(
    c
      .from('company_members')
      .select('*, profile:profiles(id, full_name, email)')
      .eq('company_id', companyId)
      .order('joined_at'),
  );
}

export async function changeMemberRole(
  c: Client,
  input: { companyId: string; userId: string; role: Exclude<Role, 'owner'>; adminScope?: AdminScope; scopeGroupIds?: string[] },
): Promise<void> {
  await run(
    c.rpc('change_member_role', {
      p_company: input.companyId,
      p_user: input.userId,
      p_role: input.role,
      p_admin_scope: input.adminScope ?? 'company',
      p_scope_group_ids: input.scopeGroupIds ?? [],
    }),
  );
}

export async function removeMember(c: Client, companyId: string, userId: string): Promise<void> {
  await run(c.rpc('remove_member', { p_company: companyId, p_user: userId }));
}

// ---------------------------------------------------------------------
// Davetler
// ---------------------------------------------------------------------

export async function createInvitation(
  c: Client,
  input: { companyId: string; email: string; role: 'admin' | 'employee'; adminScope?: AdminScope; groupIds?: string[]; scopeGroupIds?: string[] },
): Promise<{ invitationId: string; token: string }> {
  const rows = await run<{ invitation_id: string; token: string }[]>(
    c.rpc('create_invitation', {
      p_company: input.companyId,
      p_email: input.email,
      p_role: input.role,
      p_admin_scope: input.adminScope ?? 'company',
      p_group_ids: input.groupIds ?? [],
      p_scope_group_ids: input.scopeGroupIds ?? [],
    }),
  );
  const row = rows[0];
  if (!row) throw new AppError('unknown', 'Davet oluşturulamadı.');
  return { invitationId: row.invitation_id, token: row.token };
}

export async function fetchInvitations(c: Client, companyId: string): Promise<Invitation[]> {
  return run(
    c
      .from('invitations')
      .select('id, company_id, email, role, admin_scope, group_ids, scope_group_ids, invited_by, created_at, expires_at, accepted_at, revoked_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(100),
  );
}

export async function revokeInvitation(c: Client, invitationId: string): Promise<void> {
  await run(c.rpc('revoke_invitation', { p_invitation: invitationId }));
}

export interface InvitationPreview {
  company_name: string;
  email: string;
  role: Role;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expires_at: string;
}

export async function getInvitation(c: Client, token: string): Promise<InvitationPreview | null> {
  const rows = await run<InvitationPreview[]>(c.rpc('get_invitation', { p_token: token }));
  return rows[0] ?? null;
}

export async function acceptInvitation(c: Client, token: string): Promise<string> {
  return run(c.rpc('accept_invitation', { p_token: token }));
}

// ---------------------------------------------------------------------
// Gruplar
// ---------------------------------------------------------------------

export async function fetchGroups(c: Client, companyId: string): Promise<GroupWithMembers[]> {
  return run(
    c
      .from('groups')
      .select('*, members:group_members(user_id, role)')
      .eq('company_id', companyId)
      .is('archived_at', null)
      .order('name'),
  );
}

export async function createGroup(
  c: Client,
  input: { companyId: string; name: string; description?: string; memberIds?: string[]; managerIds?: string[] },
): Promise<string> {
  return run(
    c.rpc('create_group', {
      p_company: input.companyId,
      p_name: input.name,
      p_description: input.description ?? '',
      p_member_ids: input.memberIds ?? [],
      p_manager_ids: input.managerIds ?? [],
    }),
  );
}

export async function updateGroup(c: Client, groupId: string, name: string, description: string): Promise<void> {
  await run(c.rpc('update_group', { p_group: groupId, p_name: name, p_description: description }));
}

export async function addGroupMembers(c: Client, groupId: string, userIds: string[], role: GroupRole = 'member'): Promise<number> {
  return run(c.rpc('add_group_members', { p_group: groupId, p_user_ids: userIds, p_role: role }));
}

export async function removeGroupMember(c: Client, groupId: string, userId: string): Promise<void> {
  await run(c.rpc('remove_group_member', { p_group: groupId, p_user: userId }));
}

export async function setGroupMemberRole(c: Client, groupId: string, userId: string, role: GroupRole): Promise<void> {
  await run(c.rpc('set_group_member_role', { p_group: groupId, p_user: userId, p_role: role }));
}

export async function archiveGroup(c: Client, groupId: string): Promise<void> {
  await run(c.rpc('archive_group', { p_group: groupId }));
}

// ---------------------------------------------------------------------
// Görevler
// ---------------------------------------------------------------------

export type TaskListScope = 'mine' | 'created' | 'all' | 'group' | 'involved';

export interface TaskListFilter {
  scope: TaskListScope;
  userId: string;
  groupId?: string;
  /** 'open' = Tamamlandı dışındakiler */
  status?: TaskStatus | 'open' | 'any';
  overdueOnly?: boolean;
  limit?: number;
}

export async function fetchTasks(c: Client, companyId: string, f: TaskListFilter): Promise<Task[]> {
  let q = c.from('tasks').select(TASK_COLUMNS).eq('company_id', companyId);
  if (f.scope === 'mine') q = q.eq('assignee_id', f.userId);
  if (f.scope === 'created') q = q.eq('created_by', f.userId).neq('assignee_id', f.userId);
  if (f.scope === 'group' && f.groupId) q = q.eq('group_id', f.groupId);
  if (f.scope === 'involved') q = q.or(`assignee_id.eq.${f.userId},created_by.eq.${f.userId}`);
  const status = f.status ?? 'open';
  if (status === 'open') q = q.neq('status', 'done');
  else if (status !== 'any') q = q.eq('status', status);
  if (f.overdueOnly) q = q.neq('status', 'done').lt('due_at', new Date().toISOString());
  q = q.order('due_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }).limit(f.limit ?? 200);
  return run(q);
}

export async function fetchTask(c: Client, taskId: string): Promise<TaskDetail | null> {
  const [tasks, contributors, events, comments] = await Promise.all([
    run<Task[]>(c.from('tasks').select(TASK_COLUMNS).eq('id', taskId).limit(1)),
    run<{ user_id: string }[]>(c.from('task_contributors').select('user_id').eq('task_id', taskId)),
    run<TaskEvent[]>(c.from('task_events').select('id, task_id, actor_id, type, data, created_at').eq('task_id', taskId).order('created_at')),
    run<TaskComment[]>(
      c
        .from('task_comments')
        .select('id, task_id, author_id, body, created_at, mentions:task_comment_mentions(user_id)')
        .eq('task_id', taskId)
        .order('created_at'),
    ),
  ]);
  const task = tasks[0];
  if (!task) return null;
  return { task, contributorIds: contributors.map((r) => r.user_id), events, comments };
}

export async function createTask(c: Client, input: TaskCreateInput): Promise<Task> {
  return run(
    c
      .rpc('create_task', {
        p_company: input.companyId,
        p_title: input.title,
        p_assignee: input.assigneeId,
        p_client_request_id: input.clientRequestId,
        p_description: input.description ?? '',
        p_contributors: input.contributorIds ?? [],
        p_due_date: input.dueDate ?? null,
        p_due_time: input.dueTime ?? null,
        p_priority: input.priority ?? 'normal',
        p_group: input.groupId ?? null,
      })
      .single(),
  );
}

export interface TaskChanges {
  title?: string;
  description?: string;
  priority?: string;
  assignee_id?: string;
  group_id?: string | null;
  contributor_ids?: string[];
  due_date?: string | null;
  due_time?: string | null;
}

export async function updateTask(c: Client, taskId: string, changes: TaskChanges, expectedVersion?: number): Promise<Task> {
  return run(
    c.rpc('update_task', { p_task: taskId, p_changes: changes, p_expected_version: expectedVersion ?? null }).single(),
  );
}

export async function setTaskStatus(
  c: Client,
  input: { taskId: string; status: TaskStatus; reason?: string | null; expectedVersion?: number },
): Promise<Task> {
  return run(
    c
      .rpc('set_task_status', {
        p_task: input.taskId,
        p_status: input.status,
        p_reason: input.reason ?? null,
        p_expected_version: input.expectedVersion ?? null,
      })
      .single(),
  );
}

export async function markTaskSeen(c: Client, taskId: string): Promise<Task> {
  return run(c.rpc('mark_task_seen', { p_task: taskId }).single());
}

export async function acceptTask(c: Client, taskId: string): Promise<Task> {
  return run(c.rpc('accept_task', { p_task: taskId }).single());
}

export async function addTaskComment(
  c: Client,
  input: { taskId: string; body: string; mentionIds?: string[]; clientRequestId: string },
): Promise<TaskComment> {
  return run(
    c
      .rpc('add_task_comment', {
        p_task: input.taskId,
        p_body: input.body,
        p_client_request_id: input.clientRequestId,
        p_mentions: input.mentionIds ?? [],
      })
      .single(),
  );
}

export async function fetchTaskSummary(c: Client, companyId: string, groupId?: string): Promise<TaskSummaryRow[]> {
  const rows = await run<{ status: TaskStatus; total: number | string; overdue: number | string }[]>(
    c.rpc('task_summary', { p_company: companyId, p_group: groupId ?? null }),
  );
  return rows.map((r) => ({ status: r.status, total: Number(r.total), overdue: Number(r.overdue) }));
}

// ---------------------------------------------------------------------
// Bildirimler ve işlem geçmişi
// ---------------------------------------------------------------------

export async function fetchNotifications(c: Client, companyId: string, opts: { unreadOnly?: boolean; limit?: number } = {}): Promise<AppNotification[]> {
  let q = c.from('notifications').select('*').eq('company_id', companyId);
  if (opts.unreadOnly) q = q.is('read_at', null);
  return run(q.order('created_at', { ascending: false }).limit(opts.limit ?? 50));
}

export async function countUnreadNotifications(c: Client, companyId: string): Promise<number> {
  const res = await c
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .is('read_at', null);
  if (res.error) throw toAppError(res.error);
  return res.count ?? 0;
}

export async function markNotificationsRead(c: Client, ids?: string[]): Promise<number> {
  return run(c.rpc('mark_notifications_read', { p_ids: ids ?? null }));
}

export async function fetchAuditLog(c: Client, companyId: string, limit = 100): Promise<AuditEntry[]> {
  return run(c.from('audit_log').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(limit));
}

// ---------------------------------------------------------------------
// Realtime (RLS aboneye göre uygulanır; olay yalnızca "yenile" sinyalidir)
// ---------------------------------------------------------------------

/**
 * 'live'   : değişiklik akışı hazır (sunucunun "Subscribed to PostgreSQL" mesajı geldi).
 *            Kanalın SUBSCRIBED durumu tek başına yetmez: o an ile akışın hazır olması
 *            arasındaki değişiklikler gelmez. Bu yüzden 'live' olunca istemci veriyi bir kez
 *            yeniden çekmelidir (ilk bağlantı ve her yeniden bağlanma).
 * 'offline': kanal hatası/zaman aşımı/kapanma veya abonelik reddi; istemci otomatik yeniden dener.
 */
export type LiveStatus = 'live' | 'offline';

export function subscribeCompanyChanges(
  c: Client,
  companyId: string,
  userId: string,
  handlers: { onTasks?: () => void; onNotifications?: () => void; onLive?: (status: LiveStatus) => void },
): () => void {
  let channel: RealtimeChannel | null = null;
  let stopped = false;
  // Kanal katılım isteği o anki token'la gider. Oturum token'ı (çerez/SecureStore'dan) henüz
  // okunmadıysa katılım anonim olur ve sunucu değişiklik aboneliğini kolon yetkisi yüzünden
  // reddeder. Bu yüzden önce token'ı oturumdan yükle (argümansız setAuth: yenilemeleri izlemeye devam eder).
  void c.realtime
    .setAuth()
    .catch(() => undefined)
    .then(() => {
      if (stopped) return;
      channel = c
        .channel(`company:${companyId}:${userId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `company_id=eq.${companyId}` }, () =>
          handlers.onTasks?.(),
        )
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () =>
          handlers.onNotifications?.(),
        )
        .on('system', {}, (p: { extension?: string; status?: string }) => {
          if (p.extension === 'postgres_changes') handlers.onLive?.(p.status === 'ok' ? 'live' : 'offline');
        })
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') handlers.onLive?.('offline');
        });
    });
  return () => {
    stopped = true;
    if (channel) void c.removeChannel(channel);
  };
}
