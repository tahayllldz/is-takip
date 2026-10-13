'use client';
import { HOLD_REASON_MAX, statusActions, type TaskStatus } from '@istakip/shared';
import { useEffect, useRef, useState } from 'react';
import { acceptTaskAction, addCommentAction, markSeenAction, setStatusAction } from '@/app/(app)/actions';
import { Field, FormMessage, SubmitButton, fieldProps, useActionForm } from '../form';

/** Sorumlu görevi açınca bir kez "görüldü" kaydı. */
export function MarkSeen({ taskId }: { taskId: string }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void markSeenAction(taskId);
  }, [taskId]);
  return null;
}

export function StatusActions({ taskId, status, version }: { taskId: string; status: TaskStatus; version: number }) {
  const { state, pending, formProps } = useActionForm(setStatusAction);
  const [holdOpen, setHoldOpen] = useState(false);
  const [clicked, setClicked] = useState<TaskStatus | null>(null);
  const fe = state.fieldErrors ?? {};
  const actions = statusActions(status);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {actions
          .filter((a) => !a.needsReason)
          .map((a) => (
            <form key={a.to} {...formProps} onSubmitCapture={() => setClicked(a.to)}>
              <input type="hidden" name="taskId" value={taskId} />
              <input type="hidden" name="version" value={version} />
              <input type="hidden" name="status" value={a.to} />
              {/* İşlem sürerken tüm durum butonları devre dışı (çift gönderimi önler); metin yalnızca tıklananda değişir */}
              <button
                type="submit"
                className={`btn ${a.to === 'done' ? 'btn-primary' : 'btn-secondary'}`}
                disabled={pending}
                aria-busy={pending && clicked === a.to}
              >
                {pending && clicked === a.to ? 'Kaydediliyor…' : `${a.to === 'done' ? '✓ ' : ''}${a.label}`}
              </button>
            </form>
          ))}
        {actions.some((a) => a.needsReason) && !holdOpen ? (
          <button type="button" className="btn btn-secondary" onClick={() => setHoldOpen(true)} aria-expanded={false}>
            ⏸ Beklemeye al
          </button>
        ) : null}
      </div>
      {holdOpen ? (
        <form {...formProps} className="space-y-3 rounded-xl border border-line bg-canvas p-3">
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="version" value={version} />
          <input type="hidden" name="status" value="on_hold" />
          <Field id="reason" label="Neden beklemede?" hint="Kısa bir açıklama yazın (ör. parça bekleniyor)." error={fe.reason}>
            <input {...fieldProps('reason', fe.reason, 'x')} required maxLength={HOLD_REASON_MAX} className="input" autoFocus />
          </Field>
          <div className="flex gap-2">
            <SubmitButton pending={pending} pendingText="Kaydediliyor…">Beklemeye al</SubmitButton>
            <button type="button" className="btn btn-secondary" onClick={() => setHoldOpen(false)}>
              Vazgeç
            </button>
          </div>
        </form>
      ) : null}
      <FormMessage state={state} />
    </div>
  );
}

export function AcceptButton({ taskId }: { taskId: string }) {
  const { state, pending, formProps } = useActionForm(acceptTaskAction);
  return (
    <form {...formProps} className="space-y-2">
      <input type="hidden" name="taskId" value={taskId} />
      <SubmitButton pending={pending} variant="secondary" pendingText="Kaydediliyor…">
        ✋ Üstlendim
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function CommentForm({
  taskId,
  clientRequestId,
  mentionable,
}: {
  taskId: string;
  clientRequestId: string;
  mentionable: { id: string; name: string }[];
}) {
  const { state, pending, formProps } = useActionForm(addCommentAction);
  const fe = state.fieldErrors ?? {};
  const formRef = useRef<HTMLFormElement>(null);
  // Başarılı gönderimden sonra yeni istek kimliği: aynı yorum tekrar gönderilirse çoğalmaz,
  // yeni yorum ise yeni kimlikle gider.
  const [crid, setCrid] = useState(clientRequestId);
  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setCrid(crypto.randomUUID());
    }
  }, [state]);

  return (
    <form ref={formRef} {...formProps} className="space-y-3" noValidate>
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="clientRequestId" value={crid} />
      <Field id="body" label="Yorum yaz" error={fe.body}>
        <textarea {...fieldProps('body', fe.body)} rows={3} maxLength={4000} className="input" required />
      </Field>
      {mentionable.length ? (
        <fieldset>
          <legend className="label">@ Etiketle (isteğe bağlı)</legend>
          <p className="hint mb-1">Etiketlenen kişiye bildirim gider. Etiketlemek görev atamak değildir.</p>
          <div className="flex flex-wrap gap-2">
            {mentionable.map((p) => (
              <label key={p.id} className="flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-3">
                <input type="checkbox" name="mentionIds" value={p.id} className="h-5 w-5" />@{p.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <FormMessage state={state} />
      <SubmitButton pending={pending} pendingText="Gönderiliyor…">Yorumu gönder</SubmitButton>
    </form>
  );
}
