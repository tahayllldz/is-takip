'use client';
import { useState } from 'react';
import { changeRoleAction, inviteAction } from '@/app/(app)/actions';
import { Field, FormMessage, SubmitButton, fieldProps, useActionForm } from './form';

interface GroupOpt {
  id: string;
  name: string;
}

function GroupChecks({ name, groups, defaultChecked = [] }: { name: string; groups: GroupOpt[]; defaultChecked?: string[] }) {
  if (!groups.length) return <p className="hint">Henüz grup yok.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {groups.map((g) => (
        <label key={g.id} className="flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-3">
          <input type="checkbox" name={name} value={g.id} className="h-5 w-5" defaultChecked={defaultChecked.includes(g.id)} />
          {g.name}
        </label>
      ))}
    </div>
  );
}

export function InviteForm({ groups, canInviteAdmin }: { groups: GroupOpt[]; canInviteAdmin: boolean }) {
  const { state, pending, formProps } = useActionForm(inviteAction);
  const [role, setRole] = useState<'employee' | 'admin'>('employee');
  const [scope, setScope] = useState<'company' | 'groups'>('company');
  const [copied, setCopied] = useState(false);
  const fe = state.fieldErrors ?? {};
  const link = typeof state.data?.link === 'string' ? state.data.link : null;

  return (
    <div className="space-y-4">
      <form {...formProps} className="space-y-4" noValidate>
        <Field id="email" label="E-posta" error={fe.email}>
          <input {...fieldProps('email', fe.email)} type="email" required className="input" autoComplete="off" />
        </Field>
        <fieldset>
          <legend className="label">Rol</legend>
          <div className="flex flex-wrap gap-2">
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3">
              <input type="radio" name="role" value="employee" checked={role === 'employee'} onChange={() => setRole('employee')} className="h-5 w-5" />
              Çalışan
            </label>
            {canInviteAdmin ? (
              <label className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3">
                <input type="radio" name="role" value="admin" checked={role === 'admin'} onChange={() => setRole('admin')} className="h-5 w-5" />
                Yönetici
              </label>
            ) : null}
          </div>
        </fieldset>
        {role === 'admin' ? (
          <fieldset>
            <legend className="label">Yönetici yetkisinin kapsamı</legend>
            <div className="flex flex-wrap gap-2">
              <label className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3">
                <input type="radio" name="adminScope" value="company" checked={scope === 'company'} onChange={() => setScope('company')} className="h-5 w-5" />
                Tüm şirket
              </label>
              <label className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3">
                <input type="radio" name="adminScope" value="groups" checked={scope === 'groups'} onChange={() => setScope('groups')} className="h-5 w-5" />
                Yalnızca seçili gruplar
              </label>
            </div>
            {scope === 'groups' ? (
              <div className="mt-2">
                <p className="hint mb-1">Yönetici yalnızca bu gruplarda görev atar, görevleri görür ve grubu düzenler.</p>
                {fe.scopeGroupIds ? (
                  <p className="field-error" role="alert">
                    {fe.scopeGroupIds}
                  </p>
                ) : null}
                <GroupChecks name="scopeGroupIds" groups={groups} />
              </div>
            ) : null}
          </fieldset>
        ) : null}
        <fieldset>
          <legend className="label">Katılacağı gruplar (isteğe bağlı)</legend>
          <GroupChecks name="groupIds" groups={groups} />
        </fieldset>
        <FormMessage state={{ error: state.error }} />
        <SubmitButton pending={pending} pendingText="Oluşturuluyor…">Davet bağlantısı oluştur</SubmitButton>
      </form>
      {link ? (
        <div role="status" className="space-y-2 rounded-xl border border-[#b6dfc7] bg-ok-soft p-4">
          <p className="font-semibold text-ok">{String(state.data?.email)} için davet hazır.</p>
          <p className="hint">Bağlantı yalnızca şimdi gösterilir, 7 gün geçerlidir ve tek kullanımlıktır. Kişiye güvenli bir kanaldan iletin.</p>
          <input readOnly value={link} className="input font-mono text-sm" aria-label="Davet bağlantısı" onFocus={(e) => e.currentTarget.select()} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={async () => {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              }}
            >
              {copied ? '✓ Kopyalandı' : 'Bağlantıyı kopyala'}
            </button>
            <a className="btn btn-secondary btn-sm" href={`https://wa.me/?text=${encodeURIComponent(`İş Takip davetiniz: ${link}`)}`} target="_blank" rel="noopener noreferrer">
              WhatsApp ile paylaş
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function RoleForm({
  userId,
  role,
  adminScope,
  scopeGroupIds,
  groups,
}: {
  userId: string;
  role: 'admin' | 'employee';
  adminScope: 'company' | 'groups';
  scopeGroupIds: string[];
  groups: GroupOpt[];
}) {
  const { state, pending, formProps } = useActionForm(changeRoleAction);
  const [r, setR] = useState(role);
  const [sc, setSc] = useState(adminScope);
  return (
    <form {...formProps} className="space-y-3">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex flex-wrap gap-2">
        <label className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3">
          <input type="radio" name="role" value="employee" checked={r === 'employee'} onChange={() => setR('employee')} className="h-5 w-5" />
          Çalışan
        </label>
        <label className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3">
          <input type="radio" name="role" value="admin" checked={r === 'admin'} onChange={() => setR('admin')} className="h-5 w-5" />
          Yönetici
        </label>
      </div>
      {r === 'admin' ? (
        <>
          <div className="flex flex-wrap gap-2">
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3">
              <input type="radio" name="adminScope" value="company" checked={sc === 'company'} onChange={() => setSc('company')} className="h-5 w-5" />
              Tüm şirket
            </label>
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3">
              <input type="radio" name="adminScope" value="groups" checked={sc === 'groups'} onChange={() => setSc('groups')} className="h-5 w-5" />
              Yalnızca seçili gruplar
            </label>
          </div>
          {sc === 'groups' ? <GroupChecks name="scopeGroupIds" groups={groups} defaultChecked={scopeGroupIds} /> : null}
        </>
      ) : null}
      <FormMessage state={state} />
      <SubmitButton pending={pending} variant="secondary" pendingText="Kaydediliyor…" className="btn-sm">
        Rolü kaydet
      </SubmitButton>
    </form>
  );
}
