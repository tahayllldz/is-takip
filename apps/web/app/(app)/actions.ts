'use server';
/**
 * Uygulama içi sunucu işlemleri. Her işlem kullanıcının kendi oturumuyla
 * (RLS + RPC) çalışır; yönetim anahtarı kullanılmaz. Doğrulama burada kullanıcıya
 * hızlı geri bildirim içindir, kesin kontrol veritabanı fonksiyonlarındadır.
 */
import {
  acceptTask,
  addGroupMembers,
  approvalNoteSchema,
  approveTask,
  addTaskComment,
  archiveGroup,
  changeMemberRole,
  commentSchema,
  createGroup,
  createInvitation,
  createTask,
  fieldErrors,
  groupSchema,
  inviteSchema,
  markNotificationsRead,
  markTaskSeen,
  removeGroupMember,
  removeMember,
  requestTaskChanges,
  resetDashboardDefault,
  resetMyDashboard,
  saveDashboardDefault,
  saveMyDashboard,
  revokeInvitation,
  setGroupMemberRole,
  setModuleEnabled,
  setTaskApproval,
  setTaskStatus,
  statusChangeSchema,
  taskCreateSchema,
  toAppError,
  updateCompany,
  updateGroup,
  updateTask,
  DASHBOARD_PLATFORMS,
  ROLES,
  type DashboardPlatform,
  type ModuleId,
  type Role,
  type TaskChanges,
} from '@istakip/shared';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ActionState } from '@/components/form';
import { ACTIVE_COMPANY_COOKIE, SITE_URL } from '@/lib/env';
import { requireSession } from '@/lib/session';

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' ? v : '';
};
const opt = (f: FormData, k: string) => str(f, k).trim() || null;
const ids = (f: FormData, k: string) => f.getAll(k).filter((v): v is string => typeof v === 'string' && v.length > 0);

function fail(e: unknown): ActionState {
  return { error: toAppError(e).message };
}

function done(message?: string, data?: Record<string, unknown>): ActionState {
  revalidatePath('/', 'layout');
  return { ok: true, message, data };
}

// ---------------------------------------------------------------------
// Şirket
// ---------------------------------------------------------------------

export async function switchCompanyAction(form: FormData): Promise<void> {
  const s = await requireSession();
  const id = str(form, 'companyId');
  if (s.memberships.some((m) => m.company_id === id)) {
    (await cookies()).set(ACTIVE_COMPANY_COOKIE, id, { path: '/', sameSite: 'lax', httpOnly: true, maxAge: 60 * 60 * 24 * 365 });
  }
  redirect('/');
}

export async function updateCompanyAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  try {
    await updateCompany(s.supabase, s.companyId, str(form, 'name'), str(form, 'timezone') || s.timezone);
    return done('Şirket bilgileri kaydedildi.');
  } catch (e) {
    return fail(e);
  }
}

export async function setModuleAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const enable = str(form, 'enabled') === 'true';
  try {
    await setModuleEnabled(s.supabase, s.companyId, str(form, 'module') as ModuleId, enable);
    return done(enable ? 'Modül açıldı.' : 'Modül kapatıldı. Veriler silinmedi.');
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------
// Görevler
// ---------------------------------------------------------------------

export async function createTaskAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const parsed = taskCreateSchema.safeParse({
    companyId: s.companyId,
    title: str(form, 'title'),
    description: str(form, 'description'),
    assigneeId: str(form, 'assigneeId') || s.userId,
    contributorIds: ids(form, 'contributorIds'),
    dueDate: opt(form, 'dueDate'),
    dueTime: opt(form, 'dueTime'),
    priority: str(form, 'priority') || 'normal',
    groupId: opt(form, 'groupId'),
    clientRequestId: str(form, 'clientRequestId'),
    requiresApproval: form.get('requiresApproval') === 'on',
    approverId: opt(form, 'approverId'),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  let taskId: string;
  try {
    taskId = (await createTask(s.supabase, parsed.data)).id;
  } catch (e) {
    return fail(e);
  }
  revalidatePath('/', 'layout');
  redirect(`/gorevler/${taskId}?yeni=1`);
}

export async function updateTaskAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const taskId = str(form, 'taskId');
  const title = str(form, 'title').trim();
  if (!title) return { fieldErrors: { title: 'Görev başlığı gerekli.' } };
  const changes: TaskChanges = {
    title,
    description: str(form, 'description'),
    priority: str(form, 'priority'),
    assignee_id: str(form, 'assigneeId'),
    group_id: opt(form, 'groupId'),
    contributor_ids: ids(form, 'contributorIds'),
    due_date: opt(form, 'dueDate'),
    due_time: opt(form, 'dueTime'),
  };
  if (changes.due_time && !changes.due_date) return { fieldErrors: { dueDate: 'Saat seçtiyseniz tarih de seçin.' } };
  try {
    await updateTask(s.supabase, taskId, changes, Number(str(form, 'version')) || undefined);
    return done('Görev güncellendi.');
  } catch (e) {
    return fail(e);
  }
}

export async function setStatusAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const parsed = statusChangeSchema.safeParse({ taskId: str(form, 'taskId'), status: str(form, 'status'), reason: opt(form, 'reason') });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  try {
    await setTaskStatus(s.supabase, { ...parsed.data, expectedVersion: Number(str(form, 'version')) || undefined });
    return done('Durum güncellendi.');
  } catch (e) {
    return fail(e);
  }
}

export async function acceptTaskAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  try {
    await acceptTask(s.supabase, str(form, 'taskId'));
    return done('Görevi üstlendiniz.');
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------
// Ana sayfa düzeni (doğrudan argümanla çağrılır; yetki ve bileşen kontrolü veritabanında)
// ---------------------------------------------------------------------

const isPlatform = (p: unknown): p is DashboardPlatform => (DASHBOARD_PLATFORMS as readonly unknown[]).includes(p);
const isRole = (r: unknown): r is Role => (ROLES as readonly unknown[]).includes(r);
const isWidgetList = (w: unknown): w is string[] => Array.isArray(w) && w.length <= 12 && w.every((x) => typeof x === 'string' && x.length <= 40);

export async function saveMyDashboardAction(platform: DashboardPlatform, widgets: string[]): Promise<ActionState> {
  if (!isPlatform(platform) || !isWidgetList(widgets)) return { error: 'Geçersiz düzen.' };
  const s = await requireSession();
  try {
    await saveMyDashboard(s.supabase, s.companyId, platform, widgets);
    return done('Ana sayfa düzeniniz kaydedildi.');
  } catch (e) {
    return fail(e);
  }
}

export async function resetMyDashboardAction(platform: DashboardPlatform): Promise<ActionState> {
  if (!isPlatform(platform)) return { error: 'Geçersiz düzen.' };
  const s = await requireSession();
  try {
    await resetMyDashboard(s.supabase, s.companyId, platform);
    return done('Varsayılan düzene dönüldü.');
  } catch (e) {
    return fail(e);
  }
}

export async function saveDashboardDefaultAction(role: Role, platform: DashboardPlatform, widgets: string[]): Promise<ActionState> {
  if (!isRole(role) || !isPlatform(platform) || !isWidgetList(widgets)) return { error: 'Geçersiz düzen.' };
  const s = await requireSession();
  try {
    await saveDashboardDefault(s.supabase, s.companyId, role, platform, widgets);
    return done('Varsayılan düzen kaydedildi; kendi düzenini kaydetmemiş kişilere uygulanır.');
  } catch (e) {
    return fail(e);
  }
}

export async function resetDashboardDefaultAction(role: Role, platform: DashboardPlatform): Promise<ActionState> {
  if (!isRole(role) || !isPlatform(platform)) return { error: 'Geçersiz düzen.' };
  const s = await requireSession();
  try {
    await resetDashboardDefault(s.supabase, s.companyId, role, platform);
    return done('Standart düzene dönüldü.');
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------
// Görev onayı
// ---------------------------------------------------------------------

export async function approveTaskAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  try {
    await approveTask(s.supabase, str(form, 'taskId'));
    return done('Görev onaylandı; sorumluya bildirildi.');
  } catch (e) {
    return fail(e);
  }
}

export async function requestChangesAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const note = approvalNoteSchema.safeParse(str(form, 'note'));
  if (!note.success) return { fieldErrors: { note: note.error.issues[0]?.message ?? 'Açıklama yazın.' } };
  try {
    await requestTaskChanges(s.supabase, str(form, 'taskId'), note.data);
    return done('Düzeltme istendi; görev yeniden "Devam ediyor" oldu ve sorumluya açıklamanız gönderildi.');
  } catch (e) {
    return fail(e);
  }
}

export async function setTaskApprovalAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const requires = form.get('requiresApproval') === 'on';
  try {
    await setTaskApproval(s.supabase, str(form, 'taskId'), requires, requires ? opt(form, 'approverId') : null);
    return done(requires ? 'Onay ayarı kaydedildi.' : 'Bu görev artık onay gerektirmiyor.');
  } catch (e) {
    return fail(e);
  }
}

/** Sorumlu görevi açtığında "görüldü" kaydı (istemci etkisiyle bir kez çağrılır). */
export async function markSeenAction(taskId: string): Promise<void> {
  const s = await requireSession();
  try {
    await markTaskSeen(s.supabase, taskId);
    revalidatePath(`/gorevler/${taskId}`);
  } catch {
    /* görüldü kaydı kritik değil */
  }
}

export async function addCommentAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const parsed = commentSchema.safeParse({
    taskId: str(form, 'taskId'),
    body: str(form, 'body'),
    mentionIds: ids(form, 'mentionIds'),
    clientRequestId: str(form, 'clientRequestId'),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  try {
    await addTaskComment(s.supabase, parsed.data);
    return done('Yorum eklendi.');
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------
// Gruplar
// ---------------------------------------------------------------------

export async function createGroupAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const parsed = groupSchema.safeParse({ name: str(form, 'name'), description: str(form, 'description') });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  let groupId: string;
  try {
    groupId = await createGroup(s.supabase, {
      companyId: s.companyId,
      ...parsed.data,
      memberIds: ids(form, 'memberIds'),
      managerIds: ids(form, 'managerIds'),
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath('/', 'layout');
  redirect(`/gruplar/${groupId}`);
}

export async function updateGroupAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const parsed = groupSchema.safeParse({ name: str(form, 'name'), description: str(form, 'description') });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  try {
    await updateGroup(s.supabase, str(form, 'groupId'), parsed.data.name, parsed.data.description);
    return done('Grup bilgileri kaydedildi.');
  } catch (e) {
    return fail(e);
  }
}

export async function addGroupMembersAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const users = ids(form, 'userIds');
  if (users.length === 0) return { error: 'Eklenecek en az bir kişi seçin.' };
  try {
    const n = await addGroupMembers(s.supabase, str(form, 'groupId'), users);
    return done(`${n} kişi gruba eklendi.`);
  } catch (e) {
    return fail(e);
  }
}

export async function removeGroupMemberAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  try {
    await removeGroupMember(s.supabase, str(form, 'groupId'), str(form, 'userId'));
    return done('Kişi gruptan çıkarıldı.');
  } catch (e) {
    return fail(e);
  }
}

export async function setGroupRoleAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  try {
    await setGroupMemberRole(s.supabase, str(form, 'groupId'), str(form, 'userId'), str(form, 'role') === 'manager' ? 'manager' : 'member');
    return done('Grup rolü güncellendi.');
  } catch (e) {
    return fail(e);
  }
}

export async function archiveGroupAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  try {
    await archiveGroup(s.supabase, str(form, 'groupId'));
  } catch (e) {
    return fail(e);
  }
  revalidatePath('/', 'layout');
  redirect('/gruplar');
}

// ---------------------------------------------------------------------
// Ekip: davet, rol, çıkarma
// ---------------------------------------------------------------------

export async function inviteAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const parsed = inviteSchema.safeParse({
    companyId: s.companyId,
    email: str(form, 'email'),
    role: str(form, 'role') || 'employee',
    adminScope: str(form, 'adminScope') || 'company',
    groupIds: ids(form, 'groupIds'),
    scopeGroupIds: ids(form, 'scopeGroupIds'),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  try {
    const { token } = await createInvitation(s.supabase, parsed.data);
    return done('Davet oluşturuldu.', { link: `${SITE_URL}/davet/${token}`, email: parsed.data.email });
  } catch (e) {
    return fail(e);
  }
}

export async function revokeInviteAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  try {
    await revokeInvitation(s.supabase, str(form, 'invitationId'));
    return done('Davet iptal edildi.');
  } catch (e) {
    return fail(e);
  }
}

export async function removeMemberAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  try {
    await removeMember(s.supabase, s.companyId, str(form, 'userId'));
    return done('Kişi şirketten çıkarıldı; erişimi kapatıldı.');
  } catch (e) {
    return fail(e);
  }
}

export async function changeRoleAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const role = str(form, 'role') === 'admin' ? 'admin' : 'employee';
  const adminScope = str(form, 'adminScope') === 'groups' ? 'groups' : 'company';
  try {
    await changeMemberRole(s.supabase, {
      companyId: s.companyId,
      userId: str(form, 'userId'),
      role,
      adminScope,
      scopeGroupIds: ids(form, 'scopeGroupIds'),
    });
    return done('Rol güncellendi.');
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------
// Bildirimler
// ---------------------------------------------------------------------

export async function markReadAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const list = ids(form, 'notificationId');
  try {
    await markNotificationsRead(s.supabase, list.length ? list : undefined);
    return done();
  } catch (e) {
    return fail(e);
  }
}
