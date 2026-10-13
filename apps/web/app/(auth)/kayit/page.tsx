import Link from 'next/link';
import { SignupForm } from '@/components/auth-forms';

export const metadata = { title: 'Şirket hesabı aç' };

export default function SignupPage() {
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">Şirket hesabı aç</h1>
      <p className="mb-4 text-muted">Hesabı açan kişi şirket sahibi olur ve çalışanlarını davet eder.</p>
      <SignupForm />
      <p className="mt-6 text-center text-muted">
        Hesabınız var mı?{' '}
        <Link href="/giris" className="font-semibold text-brand underline">
          Giriş yapın
        </Link>
      </p>
    </>
  );
}
