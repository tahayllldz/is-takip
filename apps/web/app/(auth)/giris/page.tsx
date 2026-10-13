import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth-forms';
import { safeNext } from '@/lib/safe-redirect';
import { getBaseSession } from '@/lib/session';

export const metadata = { title: 'Giriş' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const session = await getBaseSession();
  if (session) redirect(safeNext(next));
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Giriş yap</h1>
      <LoginForm next={safeNext(next)} />
      <p className="mt-6 text-center text-muted">
        Şirketiniz için yeni hesap mı açacaksınız?{' '}
        <Link href="/kayit" className="font-semibold text-brand underline">
          Kayıt olun
        </Link>
      </p>
      <p className="mt-2 text-center text-muted">Çalışansanız yöneticinizden davet bağlantısı isteyin.</p>
    </>
  );
}
