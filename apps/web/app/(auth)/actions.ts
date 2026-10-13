'use server';
import { acceptInviteSignupSchema, acceptInvitation, companyNameSchema, createCompany, fieldErrors, getInvitation, loginSchema, signupSchema, toAppError } from '@istakip/shared';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ActionState } from '@/components/form';
import { ACTIVE_COMPANY_COOKIE, SITE_URL } from '@/lib/env';
import { safeNext } from '@/lib/safe-redirect';
import { createAdminClient, isAdminConfigured } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

async function setActiveCompany(companyId: string) {
  (await cookies()).set(ACTIVE_COMPANY_COOKIE, companyId, { path: '/', sameSite: 'lax', httpOnly: true, maxAge: 60 * 60 * 24 * 365 });
}

export async function signInAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({ email: form.get('email'), password: form.get('password') });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.message.toLowerCase().includes('email not confirmed')) {
      return { error: 'E-posta adresiniz henüz onaylanmamış. Gelen kutunuzdaki bağlantıya tıklayın.' };
    }
    if (error.status === 400 || error.status === 401) return { error: 'E-posta veya şifre hatalı.' };
    return { error: toAppError(error).message };
  }
  redirect(safeNext(form.get('next')));
}

export async function signUpAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  if (process.env.ALLOW_COMPANY_SIGNUP !== 'true') {
    return { error: 'Yeni şirket hesabı açma şu an kapalı. Lütfen bizimle iletişime geçin.' };
  }
  const parsed = signupSchema.safeParse({
    fullName: form.get('fullName'),
    companyName: form.get('companyName'),
    email: form.get('email'),
    password: form.get('password'),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const { fullName, companyName, email, password } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, company_name: companyName }, emailRedirectTo: `${SITE_URL}/auth/onay` },
  });
  if (error) {
    if (error.code === 'user_already_exists' || /already registered/i.test(error.message)) {
      return { error: 'Bu e-posta ile zaten bir hesap var. Giriş yapmayı deneyin.' };
    }
    if (error.code === 'weak_password') return { fieldErrors: { password: 'Şifre çok zayıf. Daha uzun ve tahmin edilmesi zor bir şifre seçin.' } };
    return { error: toAppError(error).message };
  }
  if (!data.session) {
    return { message: 'Hesabınız oluşturuldu. E-postanıza gelen onay bağlantısına tıklayın, ardından giriş yapın.' };
  }
  try {
    const companyId = await createCompany(supabase, companyName);
    await setActiveCompany(companyId);
  } catch (e) {
    return { error: toAppError(e).message };
  }
  redirect('/');
}

export async function createCompanyAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = companyNameSchema.safeParse(form.get('companyName'));
  if (!parsed.success) return { fieldErrors: { companyName: parsed.error.issues[0]?.message ?? 'Geçersiz ad.' } };
  const supabase = await createClient();
  try {
    const companyId = await createCompany(supabase, parsed.data);
    await setActiveCompany(companyId);
  } catch (e) {
    return { error: toAppError(e).message };
  }
  redirect('/');
}

/** Oturum açmış kullanıcı daveti kabul eder (e-posta eşleşmesi veritabanında kontrol edilir). */
export async function acceptInviteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const token = String(form.get('token') ?? '');
  const supabase = await createClient();
  try {
    const companyId = await acceptInvitation(supabase, token);
    await setActiveCompany(companyId);
  } catch (e) {
    return { error: toAppError(e).message };
  }
  redirect('/');
}

/**
 * Davetle yeni hesap: güvenilir sunucu tarafında çalışır.
 * 1) Davet geçerli ve bekliyor mu (token ile)  2) Auth Admin API ile davet edilen
 * e-postaya hesap açılır (bağlantıya sahip olmak e-postanın sahibine gönderildiğini
 * varsayar — bkz. docs/ARCHITECTURE.md)  3) Kullanıcı oturumu açılır  4) Davet,
 * kullanıcının kendi oturumuyla kabul edilir (RPC tüm kontrolleri yeniden yapar).
 */
export async function acceptInviteSignupAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = acceptInviteSignupSchema.safeParse({
    token: form.get('token'),
    fullName: form.get('fullName'),
    password: form.get('password'),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  if (!isAdminConfigured()) {
    return { error: 'Sunucu yapılandırması eksik (SUPABASE_SECRET_KEY). Yöneticinize bildirin.' };
  }
  const { token, fullName, password } = parsed.data;
  const supabase = await createClient();
  const invitation = await getInvitation(supabase, token).catch(() => null);
  if (!invitation || invitation.status !== 'pending') {
    return { error: 'Davet geçersiz, kullanılmış veya süresi dolmuş.' };
  }

  const admin = createAdminClient();
  const created = await admin.auth.admin.createUser({
    email: invitation.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (created.error) {
    if (created.error.code === 'email_exists' || /already been registered|already exists/i.test(created.error.message)) {
      return { error: 'Bu e-posta ile zaten bir hesap var. “Giriş yap” ile devam edin.' };
    }
    if (created.error.code === 'weak_password') return { fieldErrors: { password: 'Şifre çok zayıf.' } };
    return { error: 'Hesap oluşturulamadı. Lütfen tekrar deneyin.' };
  }

  const signIn = await supabase.auth.signInWithPassword({ email: invitation.email, password });
  if (signIn.error) return { error: 'Hesap oluşturuldu ancak giriş yapılamadı. Giriş sayfasından deneyin.' };
  try {
    const companyId = await acceptInvitation(supabase, token);
    await setActiveCompany(companyId);
  } catch (e) {
    return { error: toAppError(e).message };
  }
  redirect('/');
}
