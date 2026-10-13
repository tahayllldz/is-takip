/**
 * Aktif şirket bağlamı: üyelikler, üyeler (ad gösterimi), açık modüller ve
 * arayüz izin hesabı. Realtime aboneliği burada kurulur.
 */
import {
  fetchEnabledModules,
  fetchMembers,
  fetchMyMemberships,
  fetchPermissionContext,
  hasPermission,
  subscribeCompanyChanges,
  type Member,
  type MembershipWithCompany,
  type ModuleId,
  type PermissionKey,
} from '@istakip/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { keys } from './query';
import { prefs } from './secure-storage';
import { useSession } from './session';
import { supabase } from './supabase';

const ACTIVE_KEY = 'istakip.activeCompany';

export interface CompanyContext {
  userId: string;
  memberships: MembershipWithCompany[];
  active: MembershipWithCompany | null;
  companyId: string | null;
  timezone: string;
  members: Member[];
  enabledModules: ModuleId[];
  loading: boolean;
  error: unknown;
  live: boolean;
  can: (perm: PermissionKey, groupId?: string | null) => boolean;
  /** İzin şirket genelinde veya kapsamdaki gruplardan birinde var mı (ör. ekip özeti) */
  canAnywhere: (perm: PermissionKey) => boolean;
  nameOf: (id: string | null | undefined) => string;
  setActive: (companyId: string) => void;
  refetch: () => void;
}

const Ctx = createContext<CompanyContext | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const userId = session?.user.id ?? '';
  const qc = useQueryClient();
  const [wanted, setWanted] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    prefs.getItem(ACTIVE_KEY).then(setWanted).catch(() => undefined);
  }, []);

  const membershipsQ = useQuery({
    queryKey: keys.memberships(userId),
    queryFn: () => fetchMyMemberships(supabase, userId),
    enabled: Boolean(userId),
  });
  const memberships = membershipsQ.data ?? [];
  const active = memberships.find((m) => m.company_id === wanted) ?? memberships[0] ?? null;
  const companyId = active?.company_id ?? null;

  const companyQ = useQuery({
    queryKey: keys.company(companyId ?? '-'),
    enabled: Boolean(companyId && userId),
    queryFn: async () => {
      const [enabledModules, members, perm] = await Promise.all([
        fetchEnabledModules(supabase, companyId!),
        fetchMembers(supabase, companyId!),
        fetchPermissionContext(supabase, companyId!, userId),
      ]);
      return { enabledModules, members, perm };
    },
  });

  // Realtime: görev/bildirim değişince ilgili sorguları yenile; yeniden bağlanınca hepsini yenile.
  useEffect(() => {
    if (!companyId || !userId) return;
    const unsubscribe = subscribeCompanyChanges(supabase, companyId, userId, {
      onTasks: () => {
        void qc.invalidateQueries({ queryKey: ['tasks', companyId] });
        void qc.invalidateQueries({ queryKey: ['task'] });
      },
      onNotifications: () => {
        void qc.invalidateQueries({ queryKey: keys.notifications(companyId) });
        void qc.invalidateQueries({ queryKey: keys.unread(companyId) });
      },
      // Mesaj olayı: sohbet listesi (okunmamış), açık sohbet ve etiketler yenilenir
      onMessages: (conversationId) => {
        void qc.invalidateQueries({ queryKey: keys.conversations(companyId) });
        void qc.invalidateQueries({ queryKey: keys.mentions(companyId) });
        void qc.invalidateQueries({ queryKey: conversationId ? keys.messages(conversationId) : ['messages'] });
      },
      onLive: (s) => {
        setLive(s === 'live');
        // Akış hazır olunca (ilk bağlantı ve yeniden bağlanma) arada kaçırılanları al
        if (s === 'live') void qc.invalidateQueries();
      },
    });
    return unsubscribe;
  }, [companyId, userId, qc]);

  const setActive = useCallback(
    (id: string) => {
      setWanted(id);
      void prefs.setItem(ACTIVE_KEY, id);
      void qc.invalidateQueries();
    },
    [qc],
  );

  const value = useMemo<CompanyContext>(() => {
    const members = companyQ.data?.members ?? [];
    const enabledModules = companyQ.data?.enabledModules ?? [];
    const names = new Map(members.map((m) => [m.user_id, m.profile?.full_name || m.profile?.email || 'İsimsiz']));
    const perm = {
      role: active?.role ?? 'employee',
      adminScope: active?.admin_scope ?? 'company',
      scopeGroupIds: companyQ.data?.perm.scopeGroupIds ?? [],
      managedGroupIds: companyQ.data?.perm.managedGroupIds ?? [],
    } as const;
    return {
      userId,
      memberships,
      active,
      companyId,
      timezone: active?.company.timezone ?? 'Asia/Famagusta',
      members,
      enabledModules,
      loading: membershipsQ.isLoading || (Boolean(companyId) && companyQ.isLoading),
      error: membershipsQ.error ?? companyQ.error,
      live,
      can: (p, g) => hasPermission(perm, p, { groupId: g, enabledModules }),
      canAnywhere: (p) =>
        hasPermission(perm, p, { enabledModules }) || perm.scopeGroupIds.some((g) => hasPermission(perm, p, { groupId: g, enabledModules })),
      nameOf: (id) => (id ? (names.get(id) ?? 'Eski üye') : '—'),
      setActive,
      refetch: () => {
        void membershipsQ.refetch();
        void companyQ.refetch();
      },
    };
  }, [userId, memberships, active, companyId, companyQ, membershipsQ, live, setActive]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCompany(): CompanyContext {
  const c = useContext(Ctx);
  if (!c) throw new Error('CompanyProvider eksik');
  return c;
}
