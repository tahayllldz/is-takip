'use client';
/**
 * Uygulama kabuğunun istemci parçaları: aktif menü öğesi, şirket seçici,
 * bildirim zili ve Realtime ile canlı yenileme.
 */
import { countUnreadNotifications, subscribeCompanyChanges } from '@istakip/shared';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { switchCompanyAction } from '@/app/(app)/actions';
import { createClient } from '@/lib/supabase/client';

export interface NavItem {
  key: string;
  label: string;
  href: string;
  /** Okunmamış sayısı (ör. Mesajlar) */
  badge?: number;
}

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {items.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.key}>
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-11 items-center whitespace-nowrap rounded-xl px-3 font-semibold ${
                active ? 'bg-brand-soft text-brand' : 'text-ink hover:bg-neutral-soft'
              }`}
            >
              {item.label}
              {item.badge ? (
                <span className="ml-2 rounded-full bg-danger px-2 text-sm font-bold text-white">
                  {item.badge > 99 ? '99+' : item.badge}
                  <span className="sr-only"> okunmamış</span>
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function CompanySwitcher({ companies, activeId }: { companies: { id: string; name: string }[]; activeId: string }) {
  if (companies.length < 2) return <span className="font-bold">{companies[0]?.name}</span>;
  return (
    <form action={switchCompanyAction} className="flex items-center gap-2">
      <label htmlFor="company" className="sr-only">
        Şirket
      </label>
      <select id="company" name="companyId" defaultValue={activeId} className="input min-h-10 py-1 font-semibold" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="btn btn-secondary btn-sm">
          Geç
        </button>
      </noscript>
    </form>
  );
}

/**
 * Realtime aboneliği: görev veya bildirim değişince sayfa verisini sunucudan yeniden
 * çeker (olay içeriği kullanılmaz; RLS'li sorgu tekrar çalışır). Bağlantı koptuğunda,
 * sekmeye geri dönüldüğünde veya internet geri geldiğinde de yeniler — böylece
 * kaçırılan olaylar tutarlı biçimde telafi edilir.
 */
export function LiveRefresh({ companyId, userId, initialUnread }: { companyId: string; userId: string; initialUnread: number }) {
  const router = useRouter();
  const [unread, setUnread] = useState(initialUnread);
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  useEffect(() => setUnread(initialUnread), [initialUnread]);

  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 300);
  }, [router]);

  const refreshUnread = useCallback(async () => {
    const supabase = supabaseRef.current;
    if (!supabase) return;
    try {
      setUnread(await countUnreadNotifications(supabase, companyId));
    } catch {
      /* ağ hatası: bir sonraki olayda yeniden denenir */
    }
  }, [companyId]);

  useEffect(() => {
    const supabase = createClient();
    supabaseRef.current = supabase;
    const unsubscribe = subscribeCompanyChanges(supabase, companyId, userId, {
      onTasks: refresh,
      onNotifications: () => {
        void refreshUnread();
        refresh();
      },
      // Menüdeki okunmamış mesaj sayısı sunucuda hesaplanır; mesaj gelince yenilenir
      onMessages: refresh,
      onLive: (s) => {
        setStatus(s);
        // Akış hazır olunca (ilk bağlantı ve yeniden bağlanma) arada kaçırılanları al
        if (s === 'live') {
          refresh();
          void refreshUnread();
        }
      },
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refresh();
        void refreshUnread();
      }
    };
    const onOnline = () => {
      refresh();
      void refreshUnread();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [companyId, userId, refresh, refreshUnread]);

  return (
    <div className="flex items-center gap-3">
      <span className="sr-only" aria-live="polite">
        {status === 'offline' ? 'Canlı bağlantı koptu, yeniden bağlanılıyor.' : ''}
      </span>
      {status === 'offline' ? (
        <span className="rounded-full border border-[#f3d39a] bg-warn-soft px-2.5 py-0.5 text-sm font-semibold text-warn">
          <span aria-hidden="true">⚠ </span>Bağlantı yok
        </span>
      ) : null}
      <Link href="/bildirimler" className="btn btn-secondary btn-sm relative" aria-label={`Bildirimler, ${unread} okunmamış`}>
        <span aria-hidden="true">🔔</span>
        <span aria-hidden="true">Bildirimler</span>
        {unread > 0 ? (
          <span aria-hidden="true" className="rounded-full bg-danger px-2 text-sm font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </Link>
    </div>
  );
}
