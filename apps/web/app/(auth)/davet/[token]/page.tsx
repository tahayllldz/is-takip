import { ROLE_LABELS, formatDate, getInvitation, toAppError } from '@istakip/shared';
import Link from 'next/link';
import { AcceptInviteButton, InviteSignupForm } from '@/components/auth-forms';
import { Alert } from '@/components/ui';
import { getBaseSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Davet' };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  let invitation: Awaited<ReturnType<typeof getInvitation>> = null;
  try {
    invitation = await getInvitation(supabase, token);
  } catch (e) {
    return (
      <Alert tone="danger" title="Davet kontrol edilemedi">
        {toAppError(e).message}
      </Alert>
    );
  }

  if (!invitation) {
    return (
      <Alert tone="danger" title="Davet bulunamadı">
        Bağlantı hatalı olabilir. Yöneticinizden yeni bir davet bağlantısı isteyin.
      </Alert>
    );
  }
  if (invitation.status !== 'pending') {
    const text = {
      accepted: 'Bu davet daha önce kullanılmış. Hesabınızla giriş yapabilirsiniz.',
      revoked: 'Bu davet iptal edilmiş. Yöneticinizden yeni davet isteyin.',
      expired: 'Bu davetin süresi dolmuş. Yöneticinizden yeni davet isteyin.',
    }[invitation.status];
    return (
      <>
        <Alert tone="warning" title="Davet kullanılamıyor">
          {text}
        </Alert>
        <Link href="/giris" className="btn btn-secondary mt-4 w-full">
          Giriş sayfasına git
        </Link>
      </>
    );
  }

  const session = await getBaseSession();
  return (
    <>
      <h1 className="text-2xl font-bold">{invitation.company_name}</h1>
      <p className="mb-4 mt-1 text-muted">
        sizi <strong>{ROLE_LABELS[invitation.role].toLocaleLowerCase('tr-TR')}</strong> olarak davet etti. Davet{' '}
        {formatDate(invitation.expires_at)} tarihine kadar geçerli.
      </p>
      {session ? (
        session.email.toLowerCase() === invitation.email ? (
          <AcceptInviteButton token={token} />
        ) : (
          <>
            <Alert tone="warning" title="Farklı hesapla giriş yaptınız">
              Bu davet <strong>{invitation.email}</strong> için gönderildi. Şu an <strong>{session.email}</strong> ile giriş
              yapmış durumdasınız.
            </Alert>
            <form action="/auth/cikis" method="post" className="mt-4">
              <input type="hidden" name="next" value={`/davet/${token}`} />
              <button type="submit" className="btn btn-secondary w-full">
                Çıkış yap ve doğru hesapla devam et
              </button>
            </form>
          </>
        )
      ) : (
        <InviteSignupForm token={token} email={invitation.email} />
      )}
    </>
  );
}
