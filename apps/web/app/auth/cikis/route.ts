import { NextResponse, type NextRequest } from 'next/server';
import { ACTIVE_COMPANY_COOKIE } from '@/lib/env';
import { safeNext } from '@/lib/safe-redirect';
import { createClient } from '@/lib/supabase/server';

/** Çıkış (yalnızca POST — bağlantıyla istemeden çıkış yapılmasın). */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const form = await request.formData().catch(() => null);
  const next = safeNext(form?.get('next'), '/giris');
  const target = next === '/giris' ? '/giris' : `/giris?next=${encodeURIComponent(next)}`;
  const res = NextResponse.redirect(new URL(target, request.url), { status: 303 });
  res.cookies.delete(ACTIVE_COMPANY_COOKIE);
  return res;
}
