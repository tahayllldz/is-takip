import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main id="icerik" className="flex min-h-screen items-start justify-center px-4 py-10 sm:items-center">
      <div className="w-full max-w-md">
        <p className="mb-6 text-center text-xl font-bold text-brand">İş Takip</p>
        <div className="card p-6">{children}</div>
      </div>
    </main>
  );
}
