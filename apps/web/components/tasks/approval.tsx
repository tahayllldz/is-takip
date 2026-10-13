'use client';
/** Görev onayı: onaylayıcının kararı ve görevi düzenleyenin onay ayarı. Asıl yetki kontrolü veritabanında. */
import { APPROVAL_NOTE_MAX } from '@istakip/shared';
import { useState } from 'react';
import { approveTaskAction, requestChangesAction, setTaskApprovalAction } from '@/app/(app)/actions';
import { Field, FormMessage, SubmitButton, fieldProps, useActionForm } from '../form';

export function ApprovalDecision({ taskId }: { taskId: string }) {
  const approve = useActionForm(approveTaskAction);
  const changes = useActionForm(requestChangesAction);
  const [open, setOpen] = useState(false);
  const fe = changes.state.fieldErrors ?? {};
  const busy = approve.pending || changes.pending;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <form {...approve.formProps}>
          <input type="hidden" name="taskId" value={taskId} />
          <SubmitButton pending={approve.pending} pendingText="Onaylanıyor…" className={busy && !approve.pending ? 'pointer-events-none opacity-60' : ''}>
            ✔ Onayla
          </SubmitButton>
        </form>
        {!open ? (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setOpen(true)}>
            ↩ Düzeltme iste
          </button>
        ) : null}
      </div>
      <FormMessage state={approve.state} />
      {open ? (
        <form {...changes.formProps} className="space-y-2">
          <input type="hidden" name="taskId" value={taskId} />
          <Field id="note" label="Neyin düzeltilmesi gerekiyor?" hint="Sorumluya bildirim olarak gider; görev yeniden “Devam ediyor” olur." error={fe.note}>
            <textarea {...fieldProps('note', fe.note, 'x')} rows={3} maxLength={APPROVAL_NOTE_MAX} className="input" required />
          </Field>
          <FormMessage state={changes.state} />
          <div className="flex gap-2">
            <SubmitButton pending={changes.pending} pendingText="Gönderiliyor…" variant="danger">
              Düzeltme iste
            </SubmitButton>
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
              Vazgeç
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function ApprovalSettings({
  taskId,
  requiresApproval,
  approverId,
  candidates,
  me,
}: {
  taskId: string;
  requiresApproval: boolean;
  approverId: string | null;
  candidates: { id: string; name: string }[];
  me: string;
}) {
  const { state, pending, formProps } = useActionForm(setTaskApprovalAction);
  const [on, setOn] = useState(requiresApproval);
  const [who, setWho] = useState(approverId ?? candidates.find((c) => c.id === me)?.id ?? candidates[0]?.id ?? '');
  return (
    <form {...formProps} className="space-y-2">
      <input type="hidden" name="taskId" value={taskId} />
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" name="requiresApproval" className="h-5 w-5" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Tamamlanınca onay gerekli
      </label>
      {on ? (
        candidates.length ? (
          <div>
            <label htmlFor={`onaylayici-${taskId}`} className="label">
              Onaylayacak kişi
            </label>
            <select id={`onaylayici-${taskId}`} name="approverId" className="input" value={who} onChange={(e) => setWho(e.target.value)}>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id === me ? `${c.name} (ben)` : c.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="field-error">Bu görev için onaylayabilecek kimse yok.</p>
        )
      ) : null}
      <FormMessage state={state} />
      <SubmitButton pending={pending} variant="secondary" className="btn-sm">
        Onay ayarını kaydet
      </SubmitButton>
    </form>
  );
}
