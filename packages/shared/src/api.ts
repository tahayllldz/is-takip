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
  Conversation,
  ConversationDetail,
  ConversationListItem,
  GroupWithMembers,
  Invitation,
  Member,
  MembershipWithCompany,
  MentionItem,
  Message,
  MessageTaskLink,
  Task,
  TaskComment,
  TaskDetail,
  TaskEvent,
  TaskSummaryRow,
} from './types';
import type { TaskPriority } from './tasks';
import type { DashboardPlatform } from './dashboard';
import { brandingConfigSchema, normalizeTargets, type BrandingConfig, type CompanyBranding } from './branding';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Client = SupabaseClient<any, any, any>;

interface Result<T> {
  data: T | null;
  error: unknown;
  status?: number;
}

async function run<T>(p: PromiseLike<Result<T>>): Promise<T> {
  let res: Result<T>;
  try {
    res = await p;
  } catch (e) {
    throw toAppError(e);
  }
  if (res.error) throw toAppError(res.error, res.status);
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
        p_requires_approval: input.requiresApproval ?? false,
        p_approver: input.requiresApproval ? (input.approverId ?? null) : null,
      })
      .single(),
  );
}

// ---------------------------------------------------------------------
// Görev onayı (task_approval modülü)
// ---------------------------------------------------------------------

export async function setTaskApproval(c: Client, taskId: string, requiresApproval: boolean, approverId?: string | null): Promise<Task> {
  return run(c.rpc('set_task_approval', { p_task: taskId, p_requires_approval: requiresApproval, p_approver: approverId ?? null }).single());
}

export async function approveTask(c: Client, taskId: string): Promise<Task> {
  return run(c.rpc('approve_task', { p_task: taskId }).single());
}

export async function requestTaskChanges(c: Client, taskId: string, note: string): Promise<Task> {
  return run(c.rpc('request_task_changes', { p_task: taskId, p_note: note }).single());
}

/** Onayımı bekleyen görevler (RLS: onaylayıcı görevi görebilir) */
export async function fetchAwaitingMyApproval(c: Client, companyId: string, userId: string, limit = 50): Promise<Task[]> {
  return run(
    c
      .from('tasks')
      .select(TASK_COLUMNS)
      .eq('company_id', companyId)
      .eq('approver_id', userId)
      .eq('approval_status', 'pending')
      .order('approval_requested_at', { ascending: true })
      .limit(limit),
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

export type NotificationTarget =
  | { kind: 'task'; taskId: string }
  | { kind: 'group'; groupId: string }
  | { kind: 'conversation'; conversationId: string; messageId: string | null };

/** Bildirime tıklanınca gidilecek kayıt (web ve mobil aynı kuralı kullanır). */
export function notificationTarget(n: Pick<AppNotification, 'entity_type' | 'entity_id' | 'data'>): NotificationTarget | null {
  if (!n.entity_id) return null;
  if (n.entity_type === 'task') return { kind: 'task', taskId: n.entity_id };
  if (n.entity_type === 'group') return { kind: 'group', groupId: n.entity_id };
  if (n.entity_type === 'message') {
    const conv = typeof n.data?.conversation_id === 'string' ? n.data.conversation_id : null;
    return conv ? { kind: 'conversation', conversationId: conv, messageId: n.entity_id } : null;
  }
  if (n.entity_type === 'conversation') return { kind: 'conversation', conversationId: n.entity_id, messageId: null };
  return null;
}

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
// Push cihaz kaydı (mobil)
// ---------------------------------------------------------------------

export async function registerPushDevice(c: Client, token: string, platform: 'ios' | 'android', deviceName?: string | null): Promise<string> {
  return run(c.rpc('register_push_device', { p_token: token, p_platform: platform, p_device_name: deviceName ?? null }));
}

export async function unregisterPushDevice(c: Client, token: string): Promise<void> {
  await run(c.rpc('unregister_push_device', { p_token: token }));
}

// ---------------------------------------------------------------------
// Ana sayfa düzeni
// ---------------------------------------------------------------------

export async function fetchDashboardLayouts(
  c: Client,
  companyId: string,
  userId: string,
  role: Role,
  platform: DashboardPlatform,
): Promise<{ personal: string[] | null; roleDefault: string[] | null }> {
  const [mine, defaults] = await Promise.all([
    run<{ widgets: string[] }[]>(
      c.from('dashboard_user_layouts').select('widgets').eq('company_id', companyId).eq('user_id', userId).eq('platform', platform).limit(1),
    ),
    run<{ widgets: string[] }[]>(
      c.from('dashboard_role_defaults').select('widgets').eq('company_id', companyId).eq('role', role).eq('platform', platform).limit(1),
    ),
  ]);
  return { personal: mine[0]?.widgets ?? null, roleDefault: defaults[0]?.widgets ?? null };
}

export async function saveMyDashboard(c: Client, companyId: string, platform: DashboardPlatform, widgets: string[]): Promise<string[]> {
  return run(c.rpc('save_my_dashboard', { p_company: companyId, p_platform: platform, p_widgets: widgets }));
}

export async function resetMyDashboard(c: Client, companyId: string, platform: DashboardPlatform): Promise<void> {
  await run(c.rpc('reset_my_dashboard', { p_company: companyId, p_platform: platform }));
}

export interface DashboardRoleDefault {
  role: Role;
  platform: DashboardPlatform;
  widgets: string[];
  updated_at: string;
}

export async function fetchDashboardRoleDefaults(c: Client, companyId: string): Promise<DashboardRoleDefault[]> {
  return run(c.from('dashboard_role_defaults').select('role, platform, widgets, updated_at').eq('company_id', companyId));
}

export async function saveDashboardDefault(c: Client, companyId: string, role: Role, platform: DashboardPlatform, widgets: string[]): Promise<string[]> {
  return run(c.rpc('save_dashboard_default', { p_company: companyId, p_role: role, p_platform: platform, p_widgets: widgets }));
}

export async function resetDashboardDefault(c: Client, companyId: string, role: Role, platform: DashboardPlatform): Promise<void> {
  await run(c.rpc('reset_dashboard_default', { p_company: companyId, p_role: role, p_platform: platform }));
}

// ---------------------------------------------------------------------
// İletişim: sohbetler, mesajlar, ekler
// ---------------------------------------------------------------------

export const ATTACHMENT_BUCKET = 'message-attachments';
export const MESSAGE_PAGE_SIZE = 50;
/** Storage kovasındaki sınırla aynı (10 MB) */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MAX_COUNT = 10;
export const ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

const MESSAGE_COLUMNS = '*, attachments:message_attachments(*), mentions:message_mentions(user_id)';

export async function fetchConversationList(c: Client, companyId: string): Promise<ConversationListItem[]> {
  const rows = await run<(ConversationListItem & { unread_count: number | string })[]>(
    c.rpc('conversation_list', { p_company: companyId }),
  );
  return rows.map((r) => ({ ...r, unread_count: Number(r.unread_count) }));
}

export async function fetchConversation(c: Client, conversationId: string): Promise<ConversationDetail | null> {
  const rows = await run<Conversation[]>(c.from('conversations').select('*').eq('id', conversationId).limit(1));
  const conversation = rows[0];
  if (!conversation) return null;
  if (conversation.kind === 'group' && conversation.group_id) {
    const [groups, members] = await Promise.all([
      run<{ name: string }[]>(c.from('groups').select('name').eq('id', conversation.group_id).limit(1)),
      run<{ user_id: string }[]>(c.from('group_members').select('user_id').eq('group_id', conversation.group_id)),
    ]);
    return { conversation, groupName: groups[0]?.name ?? null, memberIds: members.map((m) => m.user_id) };
  }
  const participants = await run<{ user_id: string }[]>(
    c.from('conversation_participants').select('user_id').eq('conversation_id', conversationId),
  );
  return { conversation, groupName: null, memberIds: participants.map((p) => p.user_id) };
}

/** En yeni sayfa (veya `before` öncesi) — eskiden yeniye sıralı döner. */
export async function fetchMessages(
  c: Client,
  conversationId: string,
  opts: { before?: string; limit?: number } = {},
): Promise<Message[]> {
  let q = c.from('messages').select(MESSAGE_COLUMNS).eq('conversation_id', conversationId);
  if (opts.before) q = q.lt('created_at', opts.before);
  const rows = await run<Message[]>(q.order('created_at', { ascending: false }).limit(opts.limit ?? MESSAGE_PAGE_SIZE));
  return rows.reverse();
}

/** Grubun sohbeti (RLS: yalnızca grup üyesine döner) */
export async function fetchGroupConversationId(c: Client, groupId: string): Promise<string | null> {
  const rows = await run<{ id: string }[]>(c.from('conversations').select('id').eq('group_id', groupId).limit(1));
  return rows[0]?.id ?? null;
}

/** Görevin kaynak mesajı (RLS: konuşmayı göremeyen için null döner) */
export async function fetchMessageRef(
  c: Client,
  messageId: string,
): Promise<{ id: string; conversation_id: string; body: string; deleted_at: string | null } | null> {
  const rows = await run<{ id: string; conversation_id: string; body: string; deleted_at: string | null }[]>(
    c.from('messages').select('id, conversation_id, body, deleted_at').eq('id', messageId).limit(1),
  );
  return rows[0] ?? null;
}

/** Mesajlardan oluşturulmuş görevler (RLS: yalnızca görebildikleri) */
export async function fetchMessageTasks(c: Client, messageIds: string[]): Promise<MessageTaskLink[]> {
  if (messageIds.length === 0) return [];
  return run(c.from('tasks').select('id, title, status, source_message_id').in('source_message_id', messageIds));
}

export interface SendMessageInput {
  conversationId: string;
  body: string;
  /** Aynı mesaj yeniden gönderilirse (bağlantı koptu, çift dokunma) aynı kimlik kullanılır → tek mesaj */
  clientRequestId: string;
  mentionIds?: string[];
  attachments?: { path: string; name: string }[];
}

export async function sendMessage(c: Client, input: SendMessageInput): Promise<Message> {
  const row = await run<Omit<Message, 'attachments' | 'mentions'>>(
    c
      .rpc('send_message', {
        p_conversation: input.conversationId,
        p_body: input.body,
        p_client_request_id: input.clientRequestId,
        p_mentions: input.mentionIds ?? [],
        p_attachments: input.attachments ?? [],
      })
      .single(),
  );
  return { ...row, attachments: [], mentions: (input.mentionIds ?? []).map((user_id) => ({ user_id })) };
}

export async function deleteMessage(c: Client, messageId: string): Promise<void> {
  await run(c.rpc('delete_message', { p_message: messageId }));
}

export async function markConversationRead(c: Client, conversationId: string): Promise<void> {
  await run(c.rpc('mark_conversation_read', { p_conversation: conversationId }));
}

export async function getOrCreateDirectConversation(c: Client, companyId: string, userId: string): Promise<string> {
  return run(c.rpc('get_or_create_direct_conversation', { p_company: companyId, p_user: userId }));
}

export interface MessageToTaskInput {
  messageId: string;
  title: string;
  assigneeId: string;
  clientRequestId: string;
  description?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: TaskPriority;
}

export async function createTaskFromMessage(c: Client, input: MessageToTaskInput): Promise<Task> {
  return run(
    c
      .rpc('create_task_from_message', {
        p_message: input.messageId,
        p_title: input.title,
        p_assignee: input.assigneeId,
        p_client_request_id: input.clientRequestId,
        p_description: input.description ?? null,
        p_due_date: input.dueDate ?? null,
        p_due_time: input.dueTime ?? null,
        p_priority: input.priority ?? 'normal',
      })
      .single(),
  );
}

export async function fetchMyMentions(c: Client, companyId: string, limit = 10): Promise<MentionItem[]> {
  return run(c.rpc('my_mentions', { p_company: companyId, p_limit: limit }));
}

const TR_ASCII: Record<string, string> = { ı: 'i', İ: 'I', ş: 's', Ş: 'S', ğ: 'g', Ğ: 'G', ü: 'u', Ü: 'U', ö: 'o', Ö: 'O', ç: 'c', Ç: 'C' };

/** Storage anahtarı yalnızca ASCII kabul eder; görünen ad ayrıca saklanır. */
export function safeStorageFileName(name: string): string {
  const ascii = name
    .replace(/[ıİşŞğĞüÜöÖçÇ]/g, (ch) => TR_ASCII[ch] ?? ch)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
  const dot = ascii.lastIndexOf('.');
  const base = (dot > 0 ? ascii.slice(0, dot) : ascii).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'dosya';
  const ext = dot > 0 ? ascii.slice(dot + 1).replace(/[^A-Za-z0-9]/g, '').slice(0, 10) : '';
  return (base.slice(0, 80) + (ext ? `.${ext.toLowerCase()}` : '')).slice(0, 100);
}

/** <şirket>/<konuşma>/<yükleme>/<dosya> — veritabanındaki RLS bu biçimi denetler */
export function attachmentPath(companyId: string, conversationId: string, uploadId: string, fileName: string): string {
  return `${companyId}/${conversationId}/${uploadId.toLowerCase()}/${safeStorageFileName(fileName)}`;
}

export function attachmentProblem(file: { size: number; type: string }): string | null {
  if (file.size > ATTACHMENT_MAX_BYTES) return 'Dosya 10 MB’tan büyük olamaz.';
  if (file.type && !(ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
    return 'Bu dosya türü desteklenmiyor. Fotoğraf, PDF, Word, Excel, PowerPoint veya metin dosyası ekleyin.';
  }
  return null;
}

/**
 * Dosyayı kullanıcının kendi oturumuyla özel kovaya yükler (RLS: yalnızca yazabildiği konuşmaya).
 * Aynı yol yeniden yüklenirse (ağ hatası sonrası tekrar) "zaten var" hatası başarı sayılır.
 */
export async function uploadAttachment(
  c: Client,
  input: { companyId: string; conversationId: string; uploadId: string; fileName: string; body: Blob | ArrayBuffer | Uint8Array; contentType: string },
): Promise<string> {
  const path = attachmentPath(input.companyId, input.conversationId, input.uploadId, input.fileName);
  let res: { error: unknown };
  try {
    res = await c.storage.from(ATTACHMENT_BUCKET).upload(path, input.body, { contentType: input.contentType, upsert: false });
  } catch (e) {
    throw toAppError(e);
  }
  if (res.error) {
    const err = res.error as { statusCode?: string | number; status?: number; message?: string };
    const status = String(err.statusCode ?? err.status ?? '');
    if (status === '409' || /already exists|duplicate/i.test(err.message ?? '')) return path;
    if (status === '413' || /maximum allowed size|too large/i.test(err.message ?? '')) {
      throw new AppError('invalid', 'Dosya 10 MB’tan büyük olamaz.');
    }
    if (status === '415' || /mime type/i.test(err.message ?? '')) {
      throw new AppError('invalid', 'Bu dosya türü desteklenmiyor.');
    }
    throw toAppError(res.error);
  }
  return path;
}

// =====================================================================
// Şirket marka teması (logo özel depoda; tema satırını üyeler okur, yazma RPC ile)
// =====================================================================
export const BRANDING_BUCKET = 'company-branding';
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export function brandLogoPath(companyId: string, uploadId: string): string {
  return `${companyId}/logo-${uploadId}.png`;
}

interface BrandingRow {
  company_id: string;
  logo_path: string | null;
  logo_background: CompanyBranding['logoBackground'];
  palette: CompanyBranding['palette'];
  overrides: CompanyBranding['overrides'] | null;
  swatches: CompanyBranding['swatches'] | null;
  targets: unknown;
  preset: CompanyBranding['preset'];
  mode: 'light';
  config_version: number;
  version: number;
  updated_at: string;
  updated_by: string | null;
}

function toBranding(r: BrandingRow): CompanyBranding {
  return {
    companyId: r.company_id,
    logoPath: r.logo_path,
    logoBackground: r.logo_background,
    palette: r.palette,
    overrides: r.overrides ?? {},
    swatches: r.swatches ?? [],
    targets: normalizeTargets(r.targets),
    preset: r.preset,
    mode: r.mode,
    configVersion: r.config_version,
    version: r.version,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

/** Şirketin teması; hiç kaydedilmemişse null (uygulamanın kendi teması) */
export async function fetchCompanyBranding(c: Client, companyId: string): Promise<CompanyBranding | null> {
  const row = await run<BrandingRow | null>(c.from('company_branding').select('*').eq('company_id', companyId).maybeSingle());
  return row ? toBranding(row) : null;
}

/** Kaydeder; `expectedVersion` başkasının arada yaptığı değişikliği ezmeyi önler (ilk kayıtta null) */
export async function saveCompanyBranding(
  c: Client,
  companyId: string,
  config: BrandingConfig,
  expectedVersion: number | null,
): Promise<CompanyBranding> {
  const parsed = brandingConfigSchema.safeParse(config);
  if (!parsed.success) throw new AppError('invalid', parsed.error.issues[0]?.message ?? 'Tema ayarları geçersiz.');
  const row = await run<BrandingRow>(
    c.rpc('save_company_branding', { p_company: companyId, p_config: parsed.data, p_expected_version: expectedVersion }),
  );
  return toBranding(row);
}

/** Uygulamanın kendi temasına döner; eski logo depodan silinir (kullanılmayan logo politikası izin verir) */
export async function resetCompanyBranding(c: Client, companyId: string, expectedVersion: number | null): Promise<void> {
  const oldLogo = await run<string | null>(c.rpc('reset_company_branding', { p_company: companyId, p_expected_version: expectedVersion }));
  if (oldLogo) await removeBrandLogo(c, oldLogo);
}

/** Logoyu (uygulamada küçültülüp PNG'ye çevrilmiş hâliyle) özel depoya yükler; yolu döndürür */
export async function uploadBrandLogo(c: Client, companyId: string, uploadId: string, body: ArrayBuffer | Uint8Array): Promise<string> {
  if (body.byteLength > LOGO_MAX_BYTES) throw new AppError('invalid', 'Logo 2 MB’tan büyük olamaz.');
  const path = brandLogoPath(companyId, uploadId);
  let res: { error: unknown };
  try {
    res = await c.storage.from(BRANDING_BUCKET).upload(path, body, { contentType: 'image/png', upsert: false });
  } catch (e) {
    throw toAppError(e);
  }
  if (res.error) {
    const err = res.error as { statusCode?: string | number; status?: number; message?: string };
    const status = String(err.statusCode ?? err.status ?? '');
    if (status === '409' || /already exists|duplicate/i.test(err.message ?? '')) return path;
    if (status === '413' || /maximum allowed size|too large/i.test(err.message ?? '')) throw new AppError('invalid', 'Logo 2 MB’tan büyük olamaz.');
    if (status === '415' || /mime type/i.test(err.message ?? '')) throw new AppError('invalid', 'Logo PNG veya JPEG olmalı.');
    if (status === '403' || /row-level security|unauthorized/i.test(err.message ?? '')) throw new AppError('forbidden', 'Logo yükleme yetkiniz yok.');
    throw toAppError(res.error);
  }
  return path;
}

/** Kullanılmayan (kaydedilmemiş veya değiştirilmiş) logoyu siler. Hata kullanıcıyı engellemez. */
export async function removeBrandLogo(c: Client, path: string): Promise<void> {
  try {
    await c.storage.from(BRANDING_BUCKET).remove([path]);
  } catch {
    // Silinemeyen dosya yalnızca yer kaplar; tema etkilenmez
  }
}

export async function signBrandLogoUrl(c: Client, path: string, expiresInSeconds = 3600): Promise<string> {
  const { data, error } = await c.storage.from(BRANDING_BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) throw toAppError(error ?? new Error('Logo bağlantısı alınamadı.'));
  return data.signedUrl;
}

/** Gönderilmeden vazgeçilen yüklemeyi siler (mesaja bağlı dosya RLS ile silinemez). */
export async function removePendingAttachment(c: Client, path: string): Promise<void> {
  await c.storage.from(ATTACHMENT_BUCKET).remove([path]);
}

/** Kısa süreli imzalı bağlantılar (yalnızca RLS'in izin verdiği dosyalar için üretilir). */
export async function signAttachmentUrls(c: Client, paths: string[], expiresInSeconds = 600): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const res = await c.storage.from(ATTACHMENT_BUCKET).createSignedUrls(paths, expiresInSeconds);
  if (res.error) throw toAppError(res.error);
  const out: Record<string, string> = {};
  for (const r of res.data ?? []) if (r.path && r.signedUrl && !r.error) out[r.path] = r.signedUrl;
  return out;
}

/** Mesaj metnindeki @Ad Soyad ifadelerini parçalara ayırır (yalnızca gerçekten etiketlenen kişiler vurgulanır). */
export function splitMentions(body: string, mentioned: { id: string; name: string }[]): { text: string; userId?: string }[] {
  const names = mentioned.filter((m) => m.name).sort((a, b) => b.name.length - a.name.length);
  if (names.length === 0) return [{ text: body }];
  const escaped = names.map((m) => m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`@(${escaped.join('|')})`, 'g');
  const parts: { text: string; userId?: string }[] = [];
  let last = 0;
  for (const match of body.matchAll(re)) {
    const idx = match.index ?? 0;
    if (idx > last) parts.push({ text: body.slice(last, idx) });
    const who = names.find((m) => m.name === match[1]);
    parts.push({ text: match[0], userId: who?.id });
    last = idx + match[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
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
  handlers: {
    onTasks?: () => void;
    onNotifications?: () => void;
    /** Yeni/silinen mesaj. Konuşma kimliği yalnızca hangi listenin yenileneceğine dair ipucudur. */
    onMessages?: (conversationId: string | null) => void;
    /** Şirket teması değişti (başka bir yönetici kaydetti) */
    onBranding?: () => void;
    onLive?: (status: LiveStatus) => void;
  },
  /** Aynı istemcide birden çok abonelik (ör. kabuk + mesaj ekranı) ayrı kanal adı kullanmalı */
  channelName = 'app',
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
      let ch = c.channel(`${channelName}:${companyId}:${userId}`);
      if (handlers.onTasks) {
        const onTasks = handlers.onTasks;
        ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `company_id=eq.${companyId}` }, () => onTasks());
      }
      if (handlers.onNotifications) {
        const onNotifications = handlers.onNotifications;
        ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () =>
          onNotifications(),
        );
      }
      if (handlers.onMessages) {
        const onMessages = handlers.onMessages;
        ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `company_id=eq.${companyId}` }, (p) => {
          const row = (p.new ?? p.old ?? {}) as { conversation_id?: string };
          onMessages(row.conversation_id ?? null);
        });
      }
      if (handlers.onBranding) {
        const onBranding = handlers.onBranding;
        ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: 'company_branding', filter: `company_id=eq.${companyId}` }, () =>
          onBranding(),
        );
      }
      channel = ch
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
