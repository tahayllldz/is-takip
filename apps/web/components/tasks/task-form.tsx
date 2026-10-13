'use client';
/**
 * Görev oluşturma/düzenleme formu.
 * Atanabilecek kişiler kullanıcının yetkisine göre süzülür (yalnızca kolaylık;
 * asıl kontrol veritabanındaki create_task/update_task fonksiyonlarındadır).
 */
import { TASK_PRIORITIES, TASK_PRIORITY_META } from '@istakip/shared';
import { useMemo, useState } from 'react';
import { createTaskAction, updateTaskAction } from '@/app/(app)/actions';
import { Field, FormMessage, SubmitButton, fieldProps, useActionForm } from '../form';

export interface PersonOption {
  id: string;
  name: string;
}
export interface GroupOption {
  id: string;
  name: string;
  memberIds: string[];
  managerIds: string[];
}

interface Defaults {
  title?: string;
  description?: string;
  assigneeId?: string;
  contributorIds?: string[];
  groupId?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: string;
}

interface Props {
  mode: 'create' | 'edit';
  me: string;
  people: PersonOption[];
  groups: GroupOption[];
  canAssignAnywhere: boolean;
  assignableGroupIds: string[];
  today: string;
  clientRequestId?: string;
  taskId?: string;
  version?: number;
  defaults?: Defaults;
  /** Görev onayı modülü açık mı (yalnızca oluşturma formunda kullanılır) */
  approvalOn?: boolean;
  companyApproverIds?: string[];
}

export function TaskForm(props: Props) {
  const { mode, me, people, groups, canAssignAnywhere, assignableGroupIds, today, defaults = {} } = props;
  const { state, pending, formProps } = useActionForm(mode === 'create' ? createTaskAction : updateTaskAction);
  const fe = state.fieldErrors ?? {};
  const [groupId, setGroupId] = useState<string>(defaults.groupId ?? '');
  const [assigneeId, setAssigneeId] = useState<string>(defaults.assigneeId ?? me);
  const [contributors, setContributors] = useState<string[]>(defaults.contributorIds ?? []);
  const [showMore, setShowMore] = useState(Boolean(defaults.description || (defaults.contributorIds?.length ?? 0) > 0));
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [approverId, setApproverId] = useState('');

  // Atanabilir kişiler: şirket geneli yetkide herkes; grup kapsamlı yetkide seçili grubun üyeleri; aksi halde yalnızca kendisi.
  const assignable = useMemo(() => {
    if (canAssignAnywhere) return people;
    const g = groups.find((x) => x.id === groupId);
    if (g && assignableGroupIds.includes(g.id)) return people.filter((p) => p.id === me || g.memberIds.includes(p.id));
    return people.filter((p) => p.id === me);
  }, [canAssignAnywhere, people, groups, groupId, assignableGroupIds, me]);

  const canAssignOthers = canAssignAnywhere || assignableGroupIds.length > 0;
  const effectiveAssignee = assignable.some((p) => p.id === assigneeId) ? assigneeId : me;

  // Onaylayıcı adayları: sahip/şirket geneli yöneticiler + seçili grubun yöneticileri; sorumlu hariç
  const approvers = useMemo(() => {
    const g = groups.find((x) => x.id === groupId);
    const ids = new Set([...(props.companyApproverIds ?? []), ...(g?.managerIds ?? [])]);
    ids.delete(effectiveAssignee);
    return people.filter((p) => ids.has(p.id));
  }, [groups, groupId, props.companyApproverIds, effectiveAssignee, people]);
  const effectiveApprover = approvers.some((p) => p.id === approverId) ? approverId : (approvers.find((p) => p.id === me)?.id ?? approvers[0]?.id ?? '');

  return (
    <form {...formProps} className="space-y-5" noValidate>
      {mode === 'create' ? <input type="hidden" name="clientRequestId" value={props.clientRequestId} /> : null}
      {mode === 'edit' ? (
        <>
          <input type="hidden" name="taskId" value={props.taskId} />
          <input type="hidden" name="version" value={props.version} />
        </>
      ) : null}

      <Field id="title" label="Ne yapılacak?" error={fe.title}>
        <input {...fieldProps('title', fe.title)} required maxLength={200} className="input" defaultValue={defaults.title} placeholder="Örn. Servis raporunu hazırla" />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="groupId" label="Grup (isteğe bağlı)" hint={!canAssignAnywhere && assignableGroupIds.length ? 'Başkasına atamak için yetkili olduğunuz bir grup seçin.' : undefined} error={fe.groupId}>
          <select
            {...fieldProps('groupId', fe.groupId, !canAssignAnywhere && assignableGroupIds.length ? 'x' : undefined)}
            className="input"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
          >
            <option value="">Grup yok</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>

        <Field id="assigneeId" label="Sorumlu" error={fe.assigneeId}>
          {canAssignOthers ? (
            <select {...fieldProps('assigneeId', fe.assigneeId)} className="input" value={effectiveAssignee} onChange={(e) => setAssigneeId(e.target.value)}>
              {assignable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === me ? `${p.name} (ben)` : p.name}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input type="hidden" name="assigneeId" value={me} />
              <p className="input flex items-center bg-neutral-soft">Ben</p>
            </>
          )}
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field id="dueDate" label="Son tarih" error={fe.dueDate}>
          <input {...fieldProps('dueDate', fe.dueDate)} type="date" min={mode === 'create' ? today : undefined} className="input" defaultValue={defaults.dueDate ?? ''} />
        </Field>
        <Field id="dueTime" label="Saat (isteğe bağlı)" hint="Boşsa gün sonu." error={fe.dueTime}>
          <input {...fieldProps('dueTime', fe.dueTime, 'x')} type="time" className="input" defaultValue={defaults.dueTime ?? ''} />
        </Field>
        <Field id="priority" label="Öncelik" error={fe.priority}>
          <select {...fieldProps('priority', fe.priority)} className="input" defaultValue={defaults.priority ?? 'normal'}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_META[p].label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {!showMore ? (
        <button type="button" className="font-semibold text-brand underline" onClick={() => setShowMore(true)}>
          + Açıklama ve katkıda bulunanlar ekle
        </button>
      ) : (
        <>
          <Field id="description" label="Açıklama (isteğe bağlı)" error={fe.description}>
            <textarea {...fieldProps('description', fe.description)} rows={4} maxLength={5000} className="input" defaultValue={defaults.description} />
          </Field>
          {canAssignOthers ? (
            <fieldset>
              <legend className="label">Katkıda bulunanlar (isteğe bağlı)</legend>
              <p className="hint mb-2">Ana sorumlu tek kişidir; katkıda bulunanlar görevi görür ve bildirim alır.</p>
              {fe.contributorIds ? (
                <p className="field-error" role="alert">
                  {fe.contributorIds}
                </p>
              ) : null}
              <div className="grid max-h-56 gap-1 overflow-y-auto rounded-xl border border-line p-2 sm:grid-cols-2">
                {assignable
                  .filter((p) => p.id !== effectiveAssignee)
                  .map((p) => (
                    <label key={p.id} className="flex min-h-11 items-center gap-2 rounded-lg px-2 hover:bg-canvas">
                      <input
                        type="checkbox"
                        name="contributorIds"
                        value={p.id}
                        className="h-5 w-5"
                        checked={contributors.includes(p.id)}
                        onChange={(e) => setContributors((c) => (e.target.checked ? [...c, p.id] : c.filter((x) => x !== p.id)))}
                      />
                      {p.name}
                    </label>
                  ))}
              </div>
            </fieldset>
          ) : null}
        </>
      )}

      {mode === 'create' && props.approvalOn ? (
        <fieldset className="rounded-xl border border-line p-3">
          <legend className="px-1 font-semibold">Onay</legend>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" name="requiresApproval" className="h-5 w-5" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} />
            Tamamlanınca onay gerekli
          </label>
          <p className="hint">Sorumlu görevi tamamlayınca seçtiğiniz kişi onaylar ya da açıklama yazarak düzeltme ister.</p>
          {requiresApproval ? (
            approvers.length ? (
              <Field id="approverId" label="Onaylayacak kişi" error={fe.approverId}>
                <select {...fieldProps('approverId', fe.approverId)} className="input" value={effectiveApprover} onChange={(e) => setApproverId(e.target.value)}>
                  {approvers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === me ? `${p.name} (ben)` : p.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <p role="alert" className="field-error">Bu görev için onaylayabilecek kimse yok (sorumlu kendi görevini onaylayamaz).</p>
            )
          ) : null}
        </fieldset>
      ) : null}

      <FormMessage state={state} />
      <div className="flex gap-2">
        <SubmitButton pending={pending} pendingText={mode === 'create' ? 'Oluşturuluyor…' : 'Kaydediliyor…'}>{mode === 'create' ? 'Görevi oluştur' : 'Değişiklikleri kaydet'}</SubmitButton>
      </div>
    </form>
  );
}
