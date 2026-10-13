'use client';
/**
 * Erişilebilir form parçaları: etiket, ipucu ve hata metni alana bağlıdır
 * (aria-describedby), gönderim sırasında buton durumu ekran okuyucuya bildirilir.
 */
import { useFormStatus } from 'react-dom';
import { startTransition, useActionState, type FormEvent, type ReactNode } from 'react';

export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: Record<string, unknown>;
}

export const initialState: ActionState = {};

/**
 * Sunucu işlemli form. React 19 form işlemi bitince alanları sıfırlar; hata durumunda
 * kullanıcının yazdıkları kaybolmasın diye JS açıkken gönderim startTransition ile yapılır
 * (sıfırlama olmaz). JS kapalıysa `action` ile normal form gönderimi çalışır.
 */
export function useActionForm(action: (prev: ActionState, form: FormData) => Promise<ActionState>) {
  const [state, dispatch, pending] = useActionState(action, initialState);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => dispatch(data));
  };
  return { state, pending, formProps: { action: dispatch, onSubmit } } as const;
}

export function SubmitButton({ children, pendingText = 'Kaydediliyor…', variant = 'primary', className = '', pending: pendingProp }: {
  children: ReactNode;
  pendingText?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  className?: string;
  pending?: boolean;
}) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <button type="submit" className={`btn btn-${variant} ${className}`} disabled={pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="hint mb-1">
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-error`} className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Alanın aria özellikleri (Field ile birlikte kullanılır). */
export function fieldProps(id: string, error?: string, hint?: string) {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return { id, name: id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy } as const;
}

export function FormMessage({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-xl border border-[#f1b8b2] bg-danger-soft px-4 py-3 font-medium text-danger">
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="rounded-xl border border-[#b6dfc7] bg-ok-soft px-4 py-3 font-medium text-ok">
        {state.message}
      </p>
    );
  }
  return null;
}
