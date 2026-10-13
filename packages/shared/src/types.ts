/** Veritabanı satır tipleri (supabase/migrations ile birebir). */
import type { AdminScope, GroupRole, Role } from './permissions';
import type { ModuleId } from './modules';
import type { TaskApprovalStatus, TaskPriority, TaskStatus } from './tasks';

export interface Company {
  id: string;
  name: string;
  timezone: string;
  is_demo: boolean;
  created_at: string;
}

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
}

export interface Membership {
  company_id: string;
  user_id: string;
  role: Role;
  admin_scope: AdminScope;
  title: string | null;
  status: 'active' | 'removed';
  joined_at: string;
  removed_at: string | null;
}

export interface MembershipWithCompany extends Membership {
  company: Company;
}

export interface Member extends Membership {
  profile: Profile;
}

export interface Group {
  id: string;
  company_id: string;
  name: string;
  description: string;
  created_by: string | null;
  created_at: string;
  archived_at: string | null;
}

export interface GroupMember {
  user_id: string;
  role: GroupRole;
}

export interface GroupWithMembers extends Group {
  members: GroupMember[];
}

export interface Task {
  id: string;
  company_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  hold_reason: string | null;
  priority: TaskPriority;
  assignee_id: string;
  created_by: string;
  group_id: string | null;
  due_at: string | null;
  due_all_day: boolean;
  source_message_id: string | null;
  client_request_id: string;
  requires_approval: boolean;
  approver_id: string | null;
  approval_status: TaskApprovalStatus | null;
  approval_note: string | null;
  approval_requested_at: string | null;
  approval_decided_at: string | null;
  approval_decided_by: string | null;
  notified_at: string | null;
  seen_at: string | null;
  accepted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  /** Hesaplanan alan (public.is_overdue) */
  is_overdue?: boolean;
}

export interface TaskEvent {
  id: number;
  task_id: string;
  actor_id: string | null;
  type: string;
  data: Record<string, unknown>;
  created_at: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string;
  body: string;
  created_at: string;
  mentions?: { user_id: string }[];
}

export interface TaskDetail {
  task: Task;
  contributorIds: string[];
  events: TaskEvent[];
  comments: TaskComment[];
}

export interface AppNotification {
  id: string;
  company_id: string;
  user_id: string;
  module_id: ModuleId;
  type: string;
  actor_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  title: string;
  body: string;
  data: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
}

export interface Invitation {
  id: string;
  company_id: string;
  email: string;
  role: Role;
  admin_scope: AdminScope;
  group_ids: string[];
  scope_group_ids: string[];
  invited_by: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

export type ConversationKind = 'group' | 'direct';

export interface Conversation {
  id: string;
  company_id: string;
  kind: ConversationKind;
  group_id: string | null;
  direct_key: string | null;
  created_at: string;
  last_message_at: string | null;
}

/** public.conversation_list satırı */
export interface ConversationListItem {
  id: string;
  kind: ConversationKind;
  group_id: string | null;
  title: string;
  other_user_id: string | null;
  last_message_at: string | null;
  last_message_body: string | null;
  last_message_author: string | null;
  last_message_deleted: boolean;
  last_message_has_files: boolean;
  unread_count: number;
  can_post: boolean;
}

export interface ConversationDetail {
  conversation: Conversation;
  /** Grup adı veya karşı tarafın adı (çağıran tarafta doldurulur) */
  groupName: string | null;
  /** Konuşmayı görebilen kişiler: grup üyeleri veya iki katılımcı (@etiket adayları) */
  memberIds: string[];
}

export interface MessageAttachment {
  id: string;
  message_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  is_image: boolean;
}

export interface Message {
  id: string;
  company_id: string;
  conversation_id: string;
  author_id: string;
  body: string;
  client_request_id: string;
  created_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  attachments: MessageAttachment[];
  mentions: { user_id: string }[];
}

/** Mesajdan oluşturulmuş görevin özeti (yalnızca görebildiği görevler döner) */
export interface MessageTaskLink {
  id: string;
  title: string;
  status: Task['status'];
  source_message_id: string;
}

export interface MentionItem {
  message_id: string;
  conversation_id: string;
  conversation_title: string;
  author_id: string;
  body: string;
  created_at: string;
  is_read: boolean;
}

export interface AuditEntry {
  id: number;
  company_id: string;
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

export interface TaskSummaryRow {
  status: TaskStatus;
  total: number;
  overdue: number;
}
