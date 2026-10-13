import { isSupabaseConfigured } from '@/lib/env';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Kurulum gerekli' };
export const dynamic = 'force-dynamic';

/** Supabase bağlantısı tanımlı değilse gösterilir. Sahte veriyle çalışmaz. */
export default function SetupPage() {
  if (isSupabaseConfigured) redirect('/');
  return (
    <main id="icerik" className="mx-auto max-w-2xl px-4 py-12">
      <div className="card p-6">
        <h1 className="text-2xl font-bold">Sunucu bağlantısı tanımlı değil</h1>
        <p className="mt-2 text-muted">
          Uygulama gerçek bir Supabase sunucusu olmadan çalışmaz; tarayıcıda sahte veri gösterilmez.
        </p>
        <ol className="mt-4 list-decimal space-y-2 pl-6">
          <li>
            Yerel geliştirme için Docker Desktop kurun ve kök dizinde <code>pnpm db:start</code> çalıştırın.
          </li>
          <li>
            <code>pnpm db:status</code> çıktısındaki API adresi ve anahtarlarla <code>apps/web/.env.local</code> dosyasını
            <code> .env.example</code> örneğine göre doldurun.
          </li>
          <li>Web sunucusunu yeniden başlatın.</li>
        </ol>
        <p className="mt-4 text-muted">Ayrıntılar: README.md → “Kurulum”.</p>
      </div>
    </main>
  );
}
