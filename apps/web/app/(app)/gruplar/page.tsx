import { fetchGroups } from '@istakip/shared';
import Link from 'next/link';
import { CreateGroupForm } from '@/components/group-forms';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { requireSession } from '@/lib/session';

export const metadata = { title: 'Gruplar' };

export default async function GroupsPage() {
  const s = await requireSession();
  const groups = await fetchGroups(s.supabase, s.companyId);
  const people = s.members
    .filter((m) => m.status === 'active')
    .map((m) => ({ id: m.user_id, name: s.nameOf(m.user_id) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  return (
    <>
      <PageHeader title="Gruplar" description="Ekipler ve ekip içi görev/mesaj kapsamı. Bir kişi birden fazla grupta olabilir." />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          {groups.length ? (
            <ul className="grid gap-3 sm:grid-cols-2">
              {groups.map((g) => (
                <li key={g.id}>
                  <Link href={`/gruplar/${g.id}`} className="card block h-full p-4 hover:border-brand">
                    <p className="text-lg font-bold">{g.name}</p>
                    {g.description ? <p className="text-muted">{g.description}</p> : null}
                    <p className="mt-2 text-[0.9375rem]">
                      {g.members.length} üye
                      {g.members.some((m) => m.user_id === s.userId) ? ' · üyesiniz' : ''}
                      {g.members.some((m) => m.user_id === s.userId && m.role === 'manager') ? ' · grup yöneticisisiniz' : ''}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Görebildiğiniz bir grup yok">
              {s.can('groups.create') ? 'Sağdaki formla ilk grubunuzu oluşturun.' : 'Bir gruba eklendiğinizde burada görünür.'}
            </EmptyState>
          )}
        </div>
        {s.can('groups.create') ? (
          <Card title="Yeni grup">
            <CreateGroupForm people={people} me={s.userId} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
