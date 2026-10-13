'use client';
import Link from 'next/link';

import {
  acceptInviteAction,
  acceptInviteSignupAction,
  createCompanyAction,
  signInAction,
  signUpAction,
} from '@/app/(auth)/actions';
import { Field, FormMessage, SubmitButton, fieldProps, useActionForm } from './form';

export function LoginForm({ next, defaultEmail }: { next?: string; defaultEmail?: string }) {
  const { state, pending, formProps } = useActionForm(signInAction);
  const fe = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next ?? '/'} />
      <Field id="email" label="E-posta" error={fe.email}>
        <input {...fieldProps('email', fe.email)} type="email" autoComplete="email" required className="input" defaultValue={defaultEmail} />
      </Field>
      <Field id="password" label="Şifre" error={fe.password}>
        <input {...fieldProps('password', fe.password)} type="password" autoComplete="current-password" required className="input" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pending={pending} pendingText="Giriş yapılıyor…" className="w-full">
        Giriş yap
      </SubmitButton>
    </form>
  );
}

export function SignupForm() {
  const { state, pending, formProps } = useActionForm(signUpAction);
  const fe = state.fieldErrors ?? {};
  if (state.message) return <FormMessage state={state} />;
  return (
    <form {...formProps} className="space-y-4" noValidate>
      <Field id="fullName" label="Adınız soyadınız" error={fe.fullName}>
        <input {...fieldProps('fullName', fe.fullName)} autoComplete="name" required className="input" />
      </Field>
      <Field id="companyName" label="Şirket adı" error={fe.companyName}>
        <input {...fieldProps('companyName', fe.companyName)} autoComplete="organization" required className="input" />
      </Field>
      <Field id="email" label="E-posta" error={fe.email}>
        <input {...fieldProps('email', fe.email)} type="email" autoComplete="email" required className="input" />
      </Field>
      <Field id="password" label="Şifre" hint="En az 8 karakter." error={fe.password}>
        <input {...fieldProps('password', fe.password, 'x')} type="password" autoComplete="new-password" required minLength={8} className="input" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pending={pending} pendingText="Hesap oluşturuluyor…" className="w-full">
        Şirket hesabını oluştur
      </SubmitButton>
    </form>
  );
}

export function CreateCompanyForm({ defaultName }: { defaultName?: string }) {
  const { state, pending, formProps } = useActionForm(createCompanyAction);
  const fe = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="space-y-4" noValidate>
      <Field id="companyName" label="Şirket adı" error={fe.companyName}>
        <input {...fieldProps('companyName', fe.companyName)} required className="input" defaultValue={defaultName} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pending={pending} pendingText="Oluşturuluyor…" className="w-full">
        Şirketi oluştur
      </SubmitButton>
    </form>
  );
}

export function AcceptInviteButton({ token }: { token: string }) {
  const { state, pending, formProps } = useActionForm(acceptInviteAction);
  return (
    <form {...formProps} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <FormMessage state={state} />
      <SubmitButton pending={pending} pendingText="Katılınıyor…" className="w-full">
        Daveti kabul et ve katıl
      </SubmitButton>
    </form>
  );
}

export function InviteSignupForm({ token, email }: { token: string; email: string }) {
  const { state, pending, formProps } = useActionForm(acceptInviteSignupAction);
  const fe = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />
      <div>
        <span className="label">E-posta</span>
        <p className="input flex items-center bg-neutral-soft">{email}</p>
      </div>
      <Field id="fullName" label="Adınız soyadınız" error={fe.fullName}>
        <input {...fieldProps('fullName', fe.fullName)} autoComplete="name" required className="input" />
      </Field>
      <Field id="password" label="Şifre belirleyin" hint="En az 8 karakter." error={fe.password}>
        <input {...fieldProps('password', fe.password, 'x')} type="password" autoComplete="new-password" required minLength={8} className="input" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pending={pending} pendingText="Hesap açılıyor…" className="w-full">
        Hesabı aç ve katıl
      </SubmitButton>
      <p className="hint">
        Zaten hesabınız var mı?{' '}
        <Link className="font-semibold text-brand underline" href={`/giris?next=${encodeURIComponent(`/davet/${token}`)}`}>
          Giriş yapın
        </Link>
      </p>
    </form>
  );
}
