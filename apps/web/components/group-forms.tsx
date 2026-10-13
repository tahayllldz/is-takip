'use client';
import { useState } from 'react';
import { addGroupMembersAction, createGroupAction, updateGroupAction } from '@/app/(app)/actions';
import { Field, FormMessage, SubmitButton, fieldProps, useActionForm } from './form';

interface Person {
  id: string;
  name: string;
}

/** Grup oluşturma: çalışanlar seçilerek grup kurulur; bir kişi birden fazla grupta olabilir. */
export function CreateGroupForm({ people, me }: { people: Person[]; me: string }) {
  const { state, pending, formProps } = useActionForm(createGroupAction);
  const [members, setMembers] = useState<string[]>([me]);
  const [managers, setManagers] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const fe = state.fieldErrors ?? {};
  const shown = people.filter((p) => p.name.toLocaleLowerCase('tr-TR').includes(filter.toLocaleLowerCase('tr-TR')));

  return (
    <form {...formProps} className="space-y-4" noValidate>
      <Field id="name" label="Grup adı" error={fe.name}>
        <input {...fieldProps('name', fe.name)} required maxLength={80} className="input" placeholder="Örn. Teknik servis" />
      </Field>
      <Field id="description" label="Açıklama (isteğe bağlı)" error={fe.description}>
        <input {...fieldProps('description', fe.description)} maxLength={500} className="input" />
      </Field>
      <fieldset>
        <legend className="label">Üyeler ({members.length} seçili)</legend>
        <label htmlFor="people-filter" className="sr-only">
          Kişi ara
        </label>
        <input id="people-filter" className="input mb-2" placeholder="Kişi ara…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <ul className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
          {shown.map((p) => {
            const isMember = members.includes(p.id);
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1 hover:bg-canvas">
                <label className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    name="memberIds"
                    value={p.id}
                    className="h-5 w-5"
                    checked={isMember}
                    onChange={(e) => {
                      setMembers((m) => (e.target.checked ? [...m, p.id] : m.filter((x) => x !== p.id)));
                      if (!e.target.checked) setManagers((m) => m.filter((x) => x !== p.id));
                    }}
                  />
                  {p.id === me ? `${p.name} (ben)` : p.name}
                </label>
                {isMember ? (
                  <label className="flex min-h-11 items-center gap-2 text-[0.9375rem]">
                    <input
                      type="checkbox"
                      name="managerIds"
                      value={p.id}
                      className="h-5 w-5"
                      checked={managers.includes(p.id)}
                      onChange={(e) => setManagers((m) => (e.target.checked ? [...m, p.id] : m.filter((x) => x !== p.id)))}
                    />
                    Grup yöneticisi
                  </label>
                ) : null}
              </li>
            );
          })}
        </ul>
      </fieldset>
      <FormMessage state={state} />
      <SubmitButton pending={pending} pendingText="Oluşturuluyor…">Grubu oluştur</SubmitButton>
    </form>
  );
}

export function EditGroupForm({ groupId, name, description }: { groupId: string; name: string; description: string }) {
  const { state, pending, formProps } = useActionForm(updateGroupAction);
  const fe = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="space-y-3" noValidate>
      <input type="hidden" name="groupId" value={groupId} />
      <Field id="name" label="Grup adı" error={fe.name}>
        <input {...fieldProps('name', fe.name)} required maxLength={80} className="input" defaultValue={name} />
      </Field>
      <Field id="description" label="Açıklama" error={fe.description}>
        <input {...fieldProps('description', fe.description)} maxLength={500} className="input" defaultValue={description} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pending={pending} variant="secondary" pendingText="Kaydediliyor…">
        Kaydet
      </SubmitButton>
    </form>
  );
}

export function AddMembersForm({ groupId, candidates }: { groupId: string; candidates: Person[] }) {
  const { state, pending, formProps } = useActionForm(addGroupMembersAction);
  if (!candidates.length) return <p className="text-muted">Şirketteki herkes bu grupta.</p>;
  return (
    <form {...formProps} className="space-y-3">
      <input type="hidden" name="groupId" value={groupId} />
      <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto">
        {candidates.map((p) => (
          <label key={p.id} className="flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-3">
            <input type="checkbox" name="userIds" value={p.id} className="h-5 w-5" />
            {p.name}
          </label>
        ))}
      </div>
      <FormMessage state={state} />
      <SubmitButton pending={pending} variant="secondary" pendingText="Ekleniyor…">
        Seçilenleri ekle
      </SubmitButton>
    </form>
  );
}
