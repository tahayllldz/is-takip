import 'server-only';
import {
  fetchEnabledModules,
  fetchMembers,
  fetchMyMemberships,
  fetchPermissionContext,
  hasPermission,
  type Member,
  type MembershipWithCompany,
  type ModuleId,
  type PermissionKey,
} from '@istakip/shared';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { ACTIVE_COMPANY_COOKIE } from './env';
import { createClient } from './supabase/server';

export type ServerClient = Awaited<ReturnType<typeof createClient>>;

export interface BaseSession {
  supabase: ServerClient;
  userId: string;
  email: string;
  memberships: MembershipWithCompany[];
}

export interface AppSession extends BaseSession {
  active: MembershipWithCompany;
  companyId: string;
  timezone: string;
  enabledModules: ModuleId[];
  members: Member[];
  scopeGroupIds: string[];
  managedGroupIds: string[];
  /** Arayüz kararı için izin hesabı (asıl kontrol veritabanında). */
  can: (perm: PermissionKey, groupId?: string | null) => boolean;
  nameOf: (userId: string | null | undefined) => string;
}

/** Oturum açmış kullanıcı ve üyelikleri (istek başına bir kez). */
export const getBaseSession = cache(async (): Promise<BaseSession | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const memberships = await fetchMyMemberships(supabase, claims.sub);
  return { supabase, userId: claims.sub, email: String(claims.email ?? ''), memberships };
});

/** Uygulama sayfaları için tam bağlam. Oturum yoksa girişe, şirket yoksa şirket oluşturmaya yönlendirir. */
export const requireSession = cache(async (): Promise<AppSession> => {
  const base = await getBaseSession();
  if (!base) redirect('/giris');
  if (base.memberships.length === 0) redirect('/sirket-olustur');

  const wanted = (await cookies()).get(ACTIVE_COMPANY_COOKIE)?.value;
  const active = base.memberships.find((m) => m.company_id === wanted) ?? base.memberships[0]!;
  const companyId = active.company_id;

  const [enabledModules, permCtx, members] = await Promise.all([
    fetchEnabledModules(base.supabase, companyId),
    fetchPermissionContext(base.supabase, companyId, base.userId),
    fetchMembers(base.supabase, companyId),
  ]);

  const names = new Map(members.map((m) => [m.user_id, m.profile?.full_name || m.profile?.email || 'İsimsiz']));
  const membership = {
    role: active.role,
    adminScope: active.admin_scope,
    scopeGroupIds: permCtx.scopeGroupIds,
    managedGroupIds: permCtx.managedGroupIds,
  };

  return {
    ...base,
    active,
    companyId,
    timezone: active.company.timezone,
    enabledModules,
    members,
    scopeGroupIds: permCtx.scopeGroupIds,
    managedGroupIds: permCtx.managedGroupIds,
    can: (perm, groupId) => hasPermission(membership, perm, { groupId, enabledModules }),
    nameOf: (id) => (id ? (names.get(id) ?? 'Eski üye') : '—'),
  };
});

/** Modül kapalıysa sayfayı göstermez (veritabanı zaten erişimi engeller; bu kullanıcıya açık mesaj içindir). */
export function moduleOn(session: AppSession, module: ModuleId): boolean {
  return module === 'core' || session.enabledModules.includes(module);
}
