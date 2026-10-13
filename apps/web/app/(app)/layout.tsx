import { ROLE_LABELS, countUnreadNotifications, menuFor, type PermissionKey } from '@istakip/shared';
import type { ReactNode } from 'react';
import { CompanySwitcher, LiveRefresh, NavLinks, type NavItem } from '@/components/shell';
import { requireSession } from '@/lib/session';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const s = await requireSession();
  const unread = await countUnreadNotifications(s.supabase, s.companyId).catch(() => 0);

  // Menü, açık modüllerden ve kullanıcının izinlerinden türetilir. Kapalı modülün menüsü yoktur.
  const items: NavItem[] = menuFor(s.enabledModules)
    .filter((m) => m.key !== 'notifications')
    .filter((m) => !m.requires || s.can(m.requires as PermissionKey))
    .map((m) => ({ key: m.key, label: m.label, href: m.webPath }));

  const me = s.members.find((m) => m.user_id === s.userId);

  return (
    <div className="min-h-screen">
      {s.active.company.is_demo ? (
        <div role="note" className="bg-warn-soft px-4 py-2 text-center font-semibold text-warn">
          <span aria-hidden="true">⚠ </span>DEMO VERİ — Bu şirketteki kişiler ve görevler örnektir, gerçek değildir.
        </div>
      ) : null}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-brand">İş Takip</span>
            <span aria-hidden="true" className="text-line">
              |
            </span>
            <CompanySwitcher companies={s.memberships.map((m) => ({ id: m.company_id, name: m.company.name }))} activeId={s.companyId} />
          </div>
          <div className="flex items-center gap-3">
            <LiveRefresh companyId={s.companyId} userId={s.userId} initialUnread={unread} />
            <span className="hidden text-right text-sm leading-tight sm:block">
              <span className="block font-semibold">{me?.profile.full_name || s.email}</span>
              <span className="text-muted">{ROLE_LABELS[s.active.role]}</span>
            </span>
            <form action="/auth/cikis" method="post">
              <button type="submit" className="btn btn-secondary btn-sm">
                Çıkış
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:flex-row">
        <nav aria-label="Ana menü" className="md:w-52 md:shrink-0">
          <NavLinks items={items} />
        </nav>
        <main id="icerik" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
