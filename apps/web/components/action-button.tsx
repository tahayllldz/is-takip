'use client';
/** Tek tıklık işlem butonu: gizli alanlar + isteğe bağlı onay sorusu + hata gösterimi. */

import { SubmitButton, useActionForm, type ActionState } from './form';

export function ActionButton({
  action,
  fields,
  label,
  pendingText,
  confirm,
  variant = 'secondary',
  small = true,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  fields: Record<string, string>;
  label: string;
  pendingText?: string;
  confirm?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  small?: boolean;
}) {
  const { state, pending, formProps } = useActionForm(action);
  return (
    <form
      action={formProps.action}
      className="inline-flex flex-col items-start gap-1"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) {
          e.preventDefault();
          return;
        }
        formProps.onSubmit(e);
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton pending={pending} variant={variant} pendingText={pendingText ?? 'İşleniyor…'} className={small ? 'btn-sm' : ''}>
        {label}
      </SubmitButton>
      {state.error ? (
        <span role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
