import { ADMIN_SCOPE_LABELS, ROLE_LABELS, fetchGroups, fetchInvitations, formatDate } from '@istakip/shared';
import { removeMemberAction, revokeInviteAction } from '@/app/(app)/actions';
import { ActionButton } from '@/components/action-button';
import { InviteForm, RoleForm } from '@/components/team-forms';
import { Alert, Avatar, Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { requireSession } from '@/lib/session';

export const metadata = { title: 'Ekip' };

export default async function TeamPage() {
  const s = await requireSession();
  if (!s.can('members.invite') && !s.can('members.manage')) {
    return <Alert tone="warning" title="Yetkiniz yok">Ekip yönetimi yalnızca şirket sahibi ve yöneticiler içindir.</Alert>;
  }
  const isOwner = s.active.role === 'owner';
  const [groups, invitations, scopeRows] = await Promise.all([
    fetchGroups(s.supabase, s.companyId),
    fetchInvitations(s.supabase, s.companyId),
    s.supabase.from('member_scope_groups').select('user_id, group_id').eq('company_id', s.companyId),
  ]);
  const groupOpts = groups.map((g) => ({ id: g.id, name: g.name }));
  const groupsOf = (uid: string) => groups.filter((g) => g.members.some((m) => m.user_id === uid)).map((g) => g.name);
  const scopesOf = (uid: string) => (scopeRows.data ?? []).filter((r) => r.user_id === uid).map((r) => r.group_id as string);
  const active = s.members.filter((m) => m.status === 'active');
  const removed = s.members.filter((m) => m.status === 'removed');
  const pending = invitations.filter((i) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at) > new Date());

  return (
    <>
      <PageHeader title="Ekip" description={`${active.length} aktif üye`} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Üyeler">
            <ul className="divide-y divide-line">
              {active.map((m) => {
                const name = s.nameOf(m.user_id);
                const scopeNames = scopesOf(m.user_id).map((id) => groups.find((g) => g.id === id)?.name).filter(Boolean);
                const canRemove = s.can('members.manage') && m.user_id !== s.userId && m.role !== 'owner' && (m.role !== 'admin' || isOwner);
                return (
                  <li key={m.user_id} className="py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 gap-3">
                        <Avatar name={name} />
                        <div className="min-w-0">
                          <p className="font-semibold">
                            {name} {m.user_id === s.userId ? <span className="text-muted">(siz)</span> : null}
                          </p>
                          <p className="truncate text-[0.9375rem] text-muted">{m.profile.email}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Badge tone={m.role === 'employee' ? 'neutral' : 'info'}>{ROLE_LABELS[m.role]}</Badge>
                            {m.role === 'admin' ? (
                              <Badge tone="neutral">
                                {m.admin_scope === 'groups' ? `Kapsam: ${scopeNames.join(', ') || '—'}` : ADMIN_SCOPE_LABELS.company}
                              </Badge>
                            ) : null}
                          </div>
                          {groupsOf(m.user_id).length ? <p className="mt-1 text-[0.9375rem]">Gruplar: {groupsOf(m.user_id).join(', ')}</p> : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-start gap-2">
                        {canRemove ? (
                          <ActionButton
                            action={removeMemberAction}
                            fields={{ userId: m.user_id }}
                            label="Şirketten çıkar"
                            variant="danger"
                            confirm={`${name} şirketten çıkarılsın mı? Tüm grup ve görev erişimi hemen kapanır; geçmiş kayıtlar silinmez.`}
                          />
                        ) : null}
                      </div>
                    </div>
                    {isOwner && m.role !== 'owner' ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer font-semibold text-brand">Rolü değiştir</summary>
                        <div className="mt-2">
                          <RoleForm userId={m.user_id} role={m.role as 'admin' | 'employee'} adminScope={m.admin_scope} scopeGroupIds={scopesOf(m.user_id)} groups={groupOpts} />
                        </div>
                      </details>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>

          {removed.length ? (
            <Card title="Şirketten ayrılanlar">
              <ul className="space-y-1 text-muted">
                {removed.map((m) => (
                  <li key={m.user_id}>
                    {s.nameOf(m.user_id)} — {m.removed_at ? formatDate(m.removed_at, s.timezone) : ''}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          {s.can('members.invite') ? (
            <Card title="Çalışan davet et">
              <InviteForm groups={groupOpts} canInviteAdmin={isOwner} />
            </Card>
          ) : null}
          <Card title="Bekleyen davetler">
            {pending.length ? (
              <ul className="space-y-3">
                {pending.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">{i.email}</p>
                      <p className="text-[0.9375rem] text-muted">
                        {ROLE_LABELS[i.role]} · {formatDate(i.expires_at, s.timezone)} tarihine kadar
                      </p>
                    </div>
                    <ActionButton action={revokeInviteAction} fields={{ invitationId: i.id }} label="İptal et" variant="danger" confirm="Davet iptal edilsin mi?" />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Bekleyen davet yok" />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
