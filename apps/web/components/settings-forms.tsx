'use client';

import { setModuleAction, updateCompanyAction } from '@/app/(app)/actions';
import { Field, FormMessage, SubmitButton, fieldProps, useActionForm } from './form';

export function CompanyForm({ name, timezone }: { name: string; timezone: string }) {
  const { state, pending, formProps } = useActionForm(updateCompanyAction);
  return (
    <form {...formProps} className="space-y-3">
      <Field id="name" label="Şirket adı">
        <input {...fieldProps('name')} required className="input" defaultValue={name} />
      </Field>
      <Field id="timezone" label="Saat dilimi" hint="Son tarihler ve günler bu saat dilimine göre hesaplanır.">
        <select {...fieldProps('timezone', undefined, 'x')} className="input" defaultValue={timezone}>
          <option value="Asia/Famagusta">KKTC (Asia/Famagusta)</option>
          <option value="Asia/Nicosia">Kıbrıs (Asia/Nicosia)</option>
          <option value="Europe/Istanbul">Türkiye (Europe/Istanbul)</option>
        </select>
      </Field>
      <FormMessage state={state} />
      <SubmitButton pending={pending} variant="secondary">Kaydet</SubmitButton>
    </form>
  );
}

export function ModuleToggle({ module, enabled, label }: { module: string; enabled: boolean; label: string }) {
  const { state, pending, formProps } = useActionForm(setModuleAction);
  return (
    <form
      action={formProps.action}
      className="flex flex-col items-end gap-1"
      onSubmit={(e) => {
        if (enabled && !window.confirm(`${label} modülü kapatılsın mı? Menüler kalkar ve yeni işlem yapılamaz; veriler silinmez.`)) {
          e.preventDefault();
          return;
        }
        formProps.onSubmit(e);
      }}
    >
      <input type="hidden" name="module" value={module} />
      <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />
      <SubmitButton pending={pending} variant={enabled ? 'danger' : 'primary'} className="btn-sm" pendingText="Kaydediliyor…">
        {enabled ? 'Kapat' : 'Aç'}
      </SubmitButton>
      {state.error ? (
        <span role="alert" className="max-w-xs text-right text-sm text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
