/**
 * Yetki tablosu — tek doğruluk kaynağı.
 *
 * Veritabanındaki `public.permissions`, `public.role_permissions` ve
 * `public.group_role_permissions` tabloları migration'larda aynı içerikle
 * doldurulur. `packages/db-tests` içindeki test, iki tarafın birebir aynı
 * olduğunu doğrular. Burada değişiklik yaparsanız yeni bir migration yazın.
 *
 * Kurallar:
 * - Şirket sahibi (owner) her izne şirket genelinde sahiptir.
 * - Çalışan (employee) izinleri herkes için tabandır (yöneticiler de alır).
 * - Yönetici (admin) iki kapsamda olabilir:
 *     admin_scope = 'company' → yönetici izinleri şirket genelinde geçerli.
 *     admin_scope = 'groups'  → yönetici izinleri yalnızca kapsamına eklenen
 *                               gruplarda ve yalnızca kapsamı 'group' olan izinlerde geçerli.
 * - Grup yöneticisi (group_members.role = 'manager') yalnızca kendi grubunda
 *   GROUP_MANAGER_PERMISSIONS izinlerini alır.
 * - Bir iznin modülü kapalıysa izin kimse için geçerli değildir.
 */
import type { ModuleId } from './modules';

export const ROLES = ['owner', 'admin', 'employee'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Şirket sahibi',
  admin: 'Yönetici',
  employee: 'Çalışan',
};

export const ADMIN_SCOPES = ['company', 'groups'] as const;
export type AdminScope = (typeof ADMIN_SCOPES)[number];

export const ADMIN_SCOPE_LABELS: Record<AdminScope, string> = {
  company: 'Tüm şirket',
  groups: 'Yalnızca seçili gruplar',
};

export const GROUP_ROLES = ['member', 'manager'] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

export const GROUP_ROLE_LABELS: Record<GroupRole, string> = {
  member: 'Üye',
  manager: 'Grup yöneticisi',
};

/** 'company': yalnızca şirket genelinde verilebilir. 'group': belirli gruplarla sınırlanabilir. */
export type PermissionScope = 'company' | 'group';

export interface PermissionDef {
  key: string;
  module: ModuleId;
  scope: PermissionScope;
  label: string;
}

export const PERMISSIONS = [
  { key: 'company.manage', module: 'core', scope: 'company', label: 'Şirket bilgilerini ve ayarlarını yönetme' },
  { key: 'modules.manage', module: 'core', scope: 'company', label: 'Modülleri açma ve kapatma' },
  { key: 'members.invite', module: 'core', scope: 'company', label: 'Çalışan davet etme' },
  { key: 'members.manage', module: 'core', scope: 'company', label: 'Çalışanın rolünü değiştirme, şirketten çıkarma' },
  { key: 'groups.create', module: 'core', scope: 'company', label: 'Grup oluşturma' },
  { key: 'groups.manage', module: 'core', scope: 'group', label: 'Grup bilgisini ve üyelerini düzenleme' },
  { key: 'audit.view', module: 'core', scope: 'company', label: 'İşlem geçmişini görme' },
  { key: 'archive.view', module: 'core', scope: 'company', label: 'Kapalı modüllerin verisini salt okunur görme' },
  { key: 'dashboard.manage_defaults', module: 'core', scope: 'company', label: 'Varsayılan ana sayfa düzenini belirleme' },
  { key: 'tasks.create', module: 'tasks', scope: 'company', label: 'Kendine görev oluşturma' },
  { key: 'tasks.assign', module: 'tasks', scope: 'group', label: 'Başkasına görev atama' },
  { key: 'tasks.view_all', module: 'tasks', scope: 'group', label: 'Kapsamdaki tüm görevleri görme' },
  { key: 'tasks.manage_all', module: 'tasks', scope: 'group', label: 'Kapsamdaki görevleri düzenleme ve yeniden atama' },
  { key: 'tasks.approve', module: 'task_approval', scope: 'group', label: 'Tamamlanan görevi onaylama veya düzeltme isteme' },
  { key: 'messages.direct', module: 'messaging', scope: 'company', label: 'Birebir mesaj başlatma' },
  { key: 'messages.moderate', module: 'messaging', scope: 'group', label: 'Grup sohbetinde başkasının mesajını silme' },
] as const satisfies readonly PermissionDef[];

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

const ALL_KEYS = PERMISSIONS.map((p) => p.key);

/** Rol → varsayılan izinler. Owner her şeye sahiptir. */
export const ROLE_PERMISSIONS: Record<Role, readonly PermissionKey[]> = {
  owner: ALL_KEYS,
  admin: ALL_KEYS.filter((k) => k !== 'company.manage'),
  employee: ['tasks.create', 'messages.direct'],
};

/** Grup yöneticisinin yalnızca kendi grubunda aldığı izinler. */
export const GROUP_MANAGER_PERMISSIONS: readonly PermissionKey[] = ['groups.manage', 'messages.moderate', 'tasks.approve'];

export interface MembershipForPermission {
  role: Role;
  adminScope: AdminScope;
  /** admin_scope = 'groups' ise kapsamdaki grup kimlikleri */
  scopeGroupIds: readonly string[];
  /** Kullanıcının grup yöneticisi olduğu gruplar */
  managedGroupIds: readonly string[];
}

/**
 * İstemci tarafında arayüz kararları için izin hesabı (ör. butonu göster/gizle).
 * GÜVENLİK İÇİN TEK BAŞINA KULLANILMAZ — asıl kontrol veritabanındaki
 * `private.has_perm` fonksiyonunda yapılır ve bu fonksiyonla aynı mantığı izler.
 */
export function hasPermission(
  m: MembershipForPermission,
  perm: PermissionKey,
  opts: { groupId?: string | null; enabledModules: readonly ModuleId[] },
): boolean {
  const def = PERMISSIONS.find((p) => p.key === perm);
  if (!def) return false;
  if (def.module !== 'core' && !opts.enabledModules.includes(def.module)) return false;
  if (m.role === 'owner') return true;
  if ((ROLE_PERMISSIONS.employee as readonly string[]).includes(perm)) return true;
  const groupId = opts.groupId ?? null;
  if (
    groupId &&
    def.scope === 'group' &&
    GROUP_MANAGER_PERMISSIONS.includes(perm) &&
    m.managedGroupIds.includes(groupId)
  ) {
    return true;
  }
  if (!(ROLE_PERMISSIONS[m.role] as readonly string[]).includes(perm)) return false;
  if (m.adminScope === 'company') return true;
  return def.scope === 'group' && groupId !== null && m.scopeGroupIds.includes(groupId);
}
