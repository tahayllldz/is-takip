import { ROLE_LABELS, fetchAuditLog, formatDateTime, type Role } from '@istakip/shared';
import Link from 'next/link';
import { Alert, EmptyState, PageHeader } from '@/components/ui';
import { requireSession } from '@/lib/session';

export const metadata = { title: 'İşlem geçmişi' };

const ACTIONS: Record<string, string> = {
  'company.created': 'Şirketi oluşturdu',
  'company.updated': 'Şirket bilgilerini güncelledi',
  'module.enabled': 'Modül açtı',
  'module.disabled': 'Modül kapattı',
  'member.invited': 'Davet gönderdi',
  'member.invitation_revoked': 'Daveti iptal etti',
  'member.joined': 'Şirkete katıldı',
  'member.removed': 'Üyeyi şirketten çıkardı',
  'member.role_changed': 'Rol değiştirdi',
  'group.created': 'Grup oluşturdu',
  'group.updated': 'Grubu güncelledi',
  'group.members_added': 'Gruba üye ekledi',
  'group.member_removed': 'Gruptan üye çıkardı',
  'group.member_role_changed': 'Grup rolü değiştirdi',
  'group.archived': 'Grubu arşivledi',
};

export default async function AuditPage() {
  const s = await requireSession();
  if (!s.can('audit.view')) return <Alert tone="warning" title="Yetkiniz yok">İşlem geçmişini yalnızca sahip ve yöneticiler görür.</Alert>;
  const rows = await fetchAuditLog(s.supabase, s.companyId, 200);

  const detail = (action: string, data: Record<string, unknown>, entityId: string | null) => {
    if (action === 'member.invited') return `${String(data.email)} (${ROLE_LABELS[data.role as Role] ?? data.role})`;
    if (action === 'member.removed' || action === 'member.joined') return s.nameOf(entityId);
    if (action === 'member.role_changed') return `${s.nameOf(entityId)}: ${ROLE_LABELS[data.from as Role] ?? ''} → ${ROLE_LABELS[data.to as Role] ?? ''}`;
    if (action.startsWith('module.')) return String(data.module);
    if (action.startsWith('group.')) return typeof data.name === 'string' ? data.name : '';
    return '';
  };

  return (
    <>
      <p className="mb-2">
        <Link href="/ayarlar" className="font-semibold text-brand underline">
          ← Ayarlar
        </Link>
      </p>
      <PageHeader title="İşlem geçmişi" description="Son 200 yönetimsel işlem." />
      {rows.length === 0 ? (
        <EmptyState title="Kayıt yok" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="px-4 py-2">Zaman</th>
                <th scope="col" className="px-4 py-2">Kişi</th>
                <th scope="col" className="px-4 py-2">İşlem</th>
                <th scope="col" className="px-4 py-2">Ayrıntı</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="whitespace-nowrap px-4 py-2 text-[0.9375rem]">{formatDateTime(r.created_at, s.timezone)}</td>
                  <td className="px-4 py-2">{s.nameOf(r.actor_id)}</td>
                  <td className="px-4 py-2">{ACTIONS[r.action] ?? r.action}</td>
                  <td className="px-4 py-2 text-[0.9375rem] text-muted">{detail(r.action, r.data, r.entity_id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
