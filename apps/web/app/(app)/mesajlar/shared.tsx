import 'server-only';
import { fetchConversationList } from '@istakip/shared';
import { MessagesApp, type MessagingContext } from '@/components/messages/messages-app';
import { Alert } from '@/components/ui';
import { moduleOn, type AppSession } from '@/lib/session';

/** Mesajlar sayfalarının ortak sunucu kısmı: modül kontrolü + istemciye geçen bağlam. */
export async function MessagesPage({ s, selectedId, highlightId }: { s: AppSession; selectedId: string | null; highlightId: string | null }) {
  if (!moduleOn(s, 'messaging')) {
    return (
      <Alert tone="warning" title="İletişim modülü kapalı">
        Şirket yöneticiniz mesajlaşmayı kapattı. Mesajlar silinmedi; modül yeniden açılınca kaldığı yerden görünür.
      </Alert>
    );
  }
  const list = await fetchConversationList(s.supabase, s.companyId);
  const ctx: MessagingContext = {
    companyId: s.companyId,
    userId: s.userId,
    timezone: s.timezone,
    people: s.members.map((m) => ({ id: m.user_id, name: m.profile?.full_name || m.profile?.email || 'İsimsiz', active: m.status === 'active' })),
    perm: {
      role: s.active.role,
      adminScope: s.active.admin_scope,
      scopeGroupIds: s.scopeGroupIds,
      managedGroupIds: s.managedGroupIds,
      enabledModules: s.enabledModules,
    },
  };
  return <MessagesApp ctx={ctx} selectedId={selectedId} highlightId={highlightId} initialList={list} />;
}
