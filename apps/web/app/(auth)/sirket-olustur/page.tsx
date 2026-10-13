import { redirect } from 'next/navigation';
import { CreateCompanyForm } from '@/components/auth-forms';
import { getBaseSession } from '@/lib/session';

export const metadata = { title: 'Şirket oluştur' };

export default async function CreateCompanyPage() {
  const session = await getBaseSession();
  if (!session) redirect('/giris');
  if (session.memberships.length > 0) redirect('/');
  const { data } = await session.supabase.auth.getUser();
  const suggested = typeof data.user?.user_metadata?.company_name === 'string' ? data.user.user_metadata.company_name : '';
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">Şirketinizi oluşturun</h1>
      <p className="mb-4 text-muted">
        Henüz bir şirkete üye değilsiniz. Bir çalışansanız yöneticinizden davet bağlantısı isteyin; şirket sahibiyseniz
        şirketinizi oluşturun.
      </p>
      <CreateCompanyForm defaultName={suggested} />
      <form action="/auth/cikis" method="post" className="mt-4 text-center">
        <button type="submit" className="font-semibold text-brand underline">
          Çıkış yap
        </button>
      </form>
    </>
  );
}
