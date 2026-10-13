import {
  APPROVAL_NOTE_MAX,
  HOLD_REASON_MAX,
  acceptTask,
  approveTask,
  addTaskComment,
  assignmentSteps,
  describeTaskEvent,
  fetchTask,
  formatDateTime,
  markTaskSeen,
  requestTaskChanges,
  setTaskStatus,
  statusActions,
  toAppError,
  type TaskStatus,
} from '@istakip/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { ApprovalBadge, Button, Card, DueBadge, Empty, ErrorView, Field, Loading, Message, PriorityBadge, StatusBadge, colors, s } from '@/components/ui';
import { useCompany } from '@/lib/company';
import { keys } from '@/lib/query';
import { supabase } from '@/lib/supabase';

export default function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useCompany();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: keys.task(id), queryFn: () => fetchTask(supabase, id), enabled: Boolean(id) });
  const [holdOpen, setHoldOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [commentId, setCommentId] = useState(() => Crypto.randomUUID());
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [changesOpen, setChangesOpen] = useState(false);
  const [note, setNote] = useState('');
  const seenSent = useRef(false);

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: keys.task(id) });
    void qc.invalidateQueries({ queryKey: ['tasks'] });
  };

  const task = q.data?.task;
  const isAssignee = task?.assignee_id === c.userId;
  const tasksOn = c.enabledModules.includes('tasks');

  // Sorumlu görevi açınca bir kez "görüldü" kaydı.
  useEffect(() => {
    if (task && isAssignee && !task.seen_at && tasksOn && !seenSent.current) {
      seenSent.current = true;
      markTaskSeen(supabase, task.id).then(refreshAll).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, task?.seen_at, isAssignee, tasksOn]);

  const statusM = useMutation({
    mutationFn: (v: { status: TaskStatus; reason?: string }) =>
      setTaskStatus(supabase, { taskId: id, status: v.status, reason: v.reason ?? null, expectedVersion: task?.version }),
    onSuccess: (t) => {
      setFeedback({ kind: 'success', text: t.status === 'done' ? 'Görev tamamlandı. Görevi verene bildirildi.' : 'Durum güncellendi.' });
      setHoldOpen(false);
      setReason('');
      refreshAll();
    },
    onError: (e) => {
      setFeedback({ kind: 'error', text: toAppError(e).message });
      refreshAll();
    },
  });

  const acceptM = useMutation({
    mutationFn: () => acceptTask(supabase, id),
    onSuccess: () => {
      setFeedback({ kind: 'success', text: 'Görevi üstlendiniz.' });
      refreshAll();
    },
    onError: (e) => setFeedback({ kind: 'error', text: toAppError(e).message }),
  });

  const approveM = useMutation({
    mutationFn: () => approveTask(supabase, id),
    onSuccess: () => {
      setFeedback({ kind: 'success', text: 'Görev onaylandı; sorumluya bildirildi.' });
      refreshAll();
    },
    onError: (e) => setFeedback({ kind: 'error', text: toAppError(e).message }),
  });

  const changesM = useMutation({
    mutationFn: () => requestTaskChanges(supabase, id, note.trim()),
    onSuccess: () => {
      setFeedback({ kind: 'success', text: 'Düzeltme istendi; görev yeniden "Devam ediyor" oldu.' });
      setChangesOpen(false);
      setNote('');
      refreshAll();
    },
    onError: (e) => setFeedback({ kind: 'error', text: toAppError(e).message }),
  });

  const commentM = useMutation({
    mutationFn: () => addTaskComment(supabase, { taskId: id, body: comment.trim(), clientRequestId: commentId }),
    onSuccess: () => {
      setComment('');
      setCommentId(Crypto.randomUUID()); // aynı yorum tekrar gönderilirse çoğalmaz; yeni yorum yeni kimlik
      refreshAll();
    },
    onError: (e) => setFeedback({ kind: 'error', text: toAppError(e).message }),
  });

  if (q.isLoading) return <Loading label="Görev yükleniyor…" />;
  if (q.error) {
    return (
      <View style={[s.screen, s.content]}>
        <ErrorView message={toAppError(q.error).message} onRetry={() => void q.refetch()} />
      </View>
    );
  }
  if (!q.data || !task) {
    return (
      <View style={[s.screen, s.content]}>
        <Empty title="Görev bulunamadı" text="Görev silinmiş olabilir ya da artık erişiminiz yok." />
      </View>
    );
  }

  const { contributorIds, events, comments } = q.data;
  const canManage = task.created_by === c.userId || c.can('tasks.manage_all', task.group_id);
  const canStatus = tasksOn && (isAssignee || canManage);
  const actions = statusActions(task.status);
  const approvalOn = tasksOn && c.enabledModules.includes('task_approval');
  const approverActive = c.members.some((m) => m.user_id === task.approver_id && m.status === 'active');
  // Arayüz kararı; kesin kontrol approve_task / request_task_changes içinde
  const canDecide =
    approvalOn &&
    task.approval_status === 'pending' &&
    c.userId !== task.assignee_id &&
    ((task.approver_id === c.userId && c.can('tasks.approve', task.group_id)) ||
      (!approverActive && c.can('tasks.approve', task.group_id) && c.can('tasks.manage_all', task.group_id)));

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: 'Görev' }} />
      <ScrollView
        style={s.screen}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 8 }}>
          <Text style={s.h1} accessibilityRole="header">
            {task.title}
          </Text>
          <View style={s.row}>
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            <DueBadge task={task} tz={c.timezone} />
            {approvalOn && task.approval_status ? <ApprovalBadge status={task.approval_status} /> : null}
          </View>
          {approvalOn && task.approval_status === 'changes_requested' && task.approval_note ? (
            <View style={[s.card, { backgroundColor: colors.dangerSoft, borderColor: '#f1b8b2', padding: 12 }]} accessibilityRole="alert">
              <Text style={[s.body, { fontWeight: '700' }]}>↩ Düzeltme istendi ({c.nameOf(task.approval_decided_by)})</Text>
              <Text style={s.body}>{task.approval_note}</Text>
            </View>
          ) : null}
          {task.status === 'on_hold' && task.hold_reason ? <Text style={s.body}>Beklemede nedeni: {task.hold_reason}</Text> : null}
        </View>

        {feedback ? <Message kind={feedback.kind} text={feedback.text} /> : null}
        {!tasksOn ? <Message kind="error" text="Görevler modülü kapalı; bu kayıt yalnızca görüntülenebilir." /> : null}

        {canStatus ? (
          <Card title="İşlemler">
            <View style={{ gap: 10 }}>
              {actions
                .filter((a) => !a.needsReason)
                .map((a) => (
                  <Button
                    key={a.to}
                    title={a.to === 'done' ? `✓ ${a.label}` : a.label}
                    variant={a.to === 'done' ? 'primary' : 'secondary'}
                    busy={statusM.isPending && statusM.variables?.status === a.to}
                    disabled={statusM.isPending}
                    onPress={() => statusM.mutate({ status: a.to })}
                  />
                ))}
              {actions.some((a) => a.needsReason) && !holdOpen ? (
                <Button title="⏸ Beklemeye al" variant="secondary" onPress={() => setHoldOpen(true)} />
              ) : null}
              {holdOpen ? (
                <View>
                  <Field
                    label="Neden beklemede?"
                    hint="Kısa bir açıklama yazın (ör. parça bekleniyor)."
                    value={reason}
                    onChangeText={setReason}
                    maxLength={HOLD_REASON_MAX}
                    autoFocus
                  />
                  <View style={{ gap: 8 }}>
                    <Button
                      title="Beklemeye al"
                      busy={statusM.isPending}
                      disabled={reason.trim().length < 3}
                      onPress={() => statusM.mutate({ status: 'on_hold', reason: reason.trim() })}
                    />
                    <Button title="Vazgeç" variant="secondary" onPress={() => setHoldOpen(false)} />
                  </View>
                </View>
              ) : null}
              {isAssignee && !task.accepted_at && task.status !== 'done' ? (
                <Button title="✋ Üstlendim" variant="secondary" busy={acceptM.isPending} onPress={() => acceptM.mutate()} />
              ) : null}
            </View>
          </Card>
        ) : null}

        {approvalOn && task.requires_approval ? (
          <Card title="Onay">
            <Text style={s.body}>Onaylayacak kişi: {c.nameOf(task.approver_id)}</Text>
            <Text style={s.muted}>
              {task.approval_status === 'pending'
                ? canDecide
                  ? 'Görev tamamlandı ve onayınızı bekliyor.'
                  : 'Onaylayıcının kararı bekleniyor.'
                : task.approval_status === 'approved'
                  ? 'Onaylandı.'
                  : 'Görev tamamlanınca onaya düşer.'}
            </Text>
            {canDecide ? (
              <View style={{ gap: 10, marginTop: 10 }}>
                <Button title="✔ Onayla" busy={approveM.isPending} disabled={changesM.isPending} onPress={() => approveM.mutate()} />
                {!changesOpen ? (
                  <Button title="↩ Düzeltme iste" variant="secondary" disabled={approveM.isPending} onPress={() => setChangesOpen(true)} />
                ) : (
                  <View>
                    <Field
                      label="Neyin düzeltilmesi gerekiyor?"
                      hint="Sorumluya bildirim olarak gider; görev yeniden Devam ediyor olur."
                      value={note}
                      onChangeText={setNote}
                      maxLength={APPROVAL_NOTE_MAX}
                      multiline
                      autoFocus
                    />
                    <View style={{ gap: 8 }}>
                      <Button title="Düzeltme iste" variant="danger" busy={changesM.isPending} disabled={note.trim().length < 3} onPress={() => changesM.mutate()} />
                      <Button title="Vazgeç" variant="secondary" onPress={() => setChangesOpen(false)} />
                    </View>
                  </View>
                )}
              </View>
            ) : null}
          </Card>
        ) : null}

        <Card title="Bilgiler">
          <Text style={s.body}>Sorumlu: {c.nameOf(task.assignee_id)}</Text>
          <Text style={s.body}>Görevi veren: {c.nameOf(task.created_by)}</Text>
          {contributorIds.length ? <Text style={s.body}>Katkıda bulunanlar: {contributorIds.map((x) => c.nameOf(x)).join(', ')}</Text> : null}
          {task.due_at ? <Text style={s.body}>Son tarih: {formatDateTime(task.due_at, c.timezone)}{task.due_all_day ? ' (gün sonu)' : ''}</Text> : null}
          {task.description ? <Text style={[s.body, { marginTop: 8 }]}>{task.description}</Text> : null}
        </Card>

        {task.assignee_id !== task.created_by ? (
          <Card title="Sorumlu takibi">
            {assignmentSteps(task).map((st) => (
              <View key={st.key} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                <Text style={[s.body, { fontWeight: '600' }]}>
                  {st.at ? '✓ ' : '○ '}
                  {st.label}
                </Text>
                <Text style={s.muted}>{st.at ? formatDateTime(st.at, c.timezone) : 'Henüz değil'}</Text>
              </View>
            ))}
          </Card>
        ) : null}

        <Card title={`Yorumlar (${comments.length})`}>
          {comments.map((cm) => (
            <View key={cm.id} style={{ marginBottom: 10 }}>
              <Text style={[s.muted, { fontWeight: '600' }]}>
                {c.nameOf(cm.author_id)} · {formatDateTime(cm.created_at, c.timezone)}
              </Text>
              <Text style={s.body}>{cm.body}</Text>
            </View>
          ))}
          {tasksOn ? (
            <View style={{ marginTop: 6 }}>
              <Field label="Yorum yaz" value={comment} onChangeText={setComment} multiline maxLength={4000} style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]} />
              <Button title="Yorumu gönder" busy={commentM.isPending} disabled={!comment.trim()} onPress={() => commentM.mutate()} />
            </View>
          ) : null}
        </Card>

        <Card title="İşlem geçmişi">
          {events.map((e) => (
            <View key={e.id} style={{ marginBottom: 8 }}>
              <Text style={s.body}>{describeTaskEvent(e, c.nameOf)}</Text>
              <Text style={s.muted}>{formatDateTime(e.created_at, c.timezone)}</Text>
            </View>
          ))}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
