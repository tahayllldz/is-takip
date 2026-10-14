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
import { Children, useEffect, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import {
  ApprovalBadge,
  Avatar,
  Button,
  Card,
  DueBadge,
  Empty,
  ErrorView,
  Field,
  Icon,
  Loading,
  Message,
  PriorityBadge,
  StatusBadge,
  type IconName,
} from '@/components/ui';
import { useCompany } from '@/lib/company';
import { keys } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, space, useTheme } from '@/lib/theme';

const ACTION_ICONS: Partial<Record<TaskStatus, IconName>> = { in_progress: 'play', done: 'checkmark-circle', on_hold: 'pause' };

/** Bilgi satırı: simge + etiket + değer */
function InfoRow({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  const { s } = useTheme();
  const text = Children.toArray(children).join('');
  return (
    <View style={{ flexDirection: 'row', gap: space.md, paddingVertical: space.sm }} accessible accessibilityLabel={`${label}: ${text}`}>
      <Icon name={icon} size={20} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={s.caption}>{label}</Text>
        <Text style={s.body}>{children}</Text>
      </View>
    </View>
  );
}

/** Dikey zaman çizelgesi (sorumlu takibi, işlem geçmişi) */
function Timeline({ items }: { items: { key: string; title: string; when: string; done: boolean }[] }) {
  const { t, s } = useTheme();
  return (
    <View>
      {items.map((it, i) => (
        <View key={it.key} style={{ flexDirection: 'row', gap: space.md }} accessible accessibilityLabel={`${it.title}, ${it.when}`}>
          <View style={{ alignItems: 'center', width: 20 }}>
            <View
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                marginTop: 5,
                backgroundColor: it.done ? t.selection.fg : t.surface.default,
                borderWidth: 2,
                borderColor: it.done ? t.selection.fg : t.border.strong,
              }}
            />
            {i < items.length - 1 ? <View style={{ flex: 1, width: 2, backgroundColor: t.border.default, marginVertical: 2 }} /> : null}
          </View>
          <View style={{ flex: 1, paddingBottom: i < items.length - 1 ? space.md : 0 }}>
            <Text style={[s.body, !it.done ? { color: t.text.secondary } : null]}>{it.title}</Text>
            <Text style={s.caption}>{it.when}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export default function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useCompany();
  const { t, s } = useTheme();
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
    onSuccess: (r) => {
      setFeedback({
        kind: 'success',
        text:
          r.status === 'done'
            ? r.approval_status === 'pending'
              ? 'Görev tamamlandı ve onaya gönderildi.'
              : 'Görev tamamlandı. Görevi verene bildirildi.'
            : 'Durum güncellendi.',
      });
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
        <Empty icon="search-outline" title="Görev bulunamadı" text="Görev silinmiş olabilir ya da artık erişiminiz yok." />
      </View>
    );
  }

  const { contributorIds, events, comments } = q.data;
  const canManage = task.created_by === c.userId || c.can('tasks.manage_all', task.group_id);
  const canStatus = tasksOn && (isAssignee || canManage);
  const actions = statusActions(task.status);
  const primaryAction = actions.find((a) => a.to === 'done');
  const otherActions = actions.filter((a) => !a.needsReason && a.to !== 'done');
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
        <View style={{ gap: space.md }}>
          <Text style={s.title} accessibilityRole="header">
            {task.title}
          </Text>
          <View style={s.row}>
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            <DueBadge task={task} tz={c.timezone} />
            {approvalOn && task.approval_status ? <ApprovalBadge status={task.approval_status} /> : null}
          </View>
          {approvalOn && task.approval_status === 'changes_requested' && task.approval_note ? (
            <View
              style={{ borderRadius: radius.md, borderWidth: 1, borderColor: t.status.danger.border, backgroundColor: t.status.danger.bg, padding: space.md, gap: space.xs }}
              accessibilityRole="alert"
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Icon name="arrow-undo" size={18} color={t.status.danger.fg} />
                <Text style={[s.strong, { color: t.status.danger.fg, flex: 1 }]}>Düzeltme istendi ({c.nameOf(task.approval_decided_by)})</Text>
              </View>
              <Text style={s.body}>{task.approval_note}</Text>
            </View>
          ) : null}
          {task.status === 'on_hold' && task.hold_reason ? (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Icon name="pause-circle-outline" size={20} color={t.status.warning.fg} />
              <Text style={[s.body, { flex: 1 }]}>Beklemede nedeni: {task.hold_reason}</Text>
            </View>
          ) : null}
        </View>

        {feedback ? <Message kind={feedback.kind} text={feedback.text} /> : null}
        {!tasksOn ? <Message kind="info" text="Görevler modülü kapalı; bu kayıt yalnızca görüntülenebilir." /> : null}

        {canStatus ? (
          <Card title="İşlemler" icon="flash-outline">
            <View style={{ gap: space.md }}>
              {primaryAction ? (
                <Button
                  title={primaryAction.label}
                  icon="checkmark-circle"
                  busy={statusM.isPending && statusM.variables?.status === 'done'}
                  disabled={statusM.isPending}
                  accessibilityHint={task.requires_approval && approvalOn ? 'Görev onaylayıcıya gönderilir' : 'Görevi verene bildirilir'}
                  onPress={() => statusM.mutate({ status: 'done' })}
                />
              ) : null}
              {otherActions.map((a) => (
                <Button
                  key={a.to}
                  title={a.label}
                  icon={ACTION_ICONS[a.to] ?? 'refresh'}
                  variant="secondary"
                  busy={statusM.isPending && statusM.variables?.status === a.to}
                  disabled={statusM.isPending}
                  onPress={() => statusM.mutate({ status: a.to })}
                />
              ))}
              {actions.some((a) => a.needsReason) && !holdOpen ? (
                <Button title="Beklemeye al" icon="pause" variant="secondary" onPress={() => setHoldOpen(true)} />
              ) : null}
              {holdOpen ? (
                <View style={{ borderTopWidth: 1, borderTopColor: t.border.default, paddingTop: space.md }}>
                  <Field
                    label="Neden beklemede?"
                    hint="Kısa bir açıklama yazın (ör. parça bekleniyor)."
                    value={reason}
                    onChangeText={setReason}
                    maxLength={HOLD_REASON_MAX}
                    autoFocus
                  />
                  <View style={{ flexDirection: 'row', gap: space.md }}>
                    <View style={{ flex: 1 }}>
                      <Button title="Vazgeç" variant="secondary" onPress={() => setHoldOpen(false)} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button
                        title="Beklemeye al"
                        busy={statusM.isPending}
                        disabled={reason.trim().length < 3}
                        onPress={() => statusM.mutate({ status: 'on_hold', reason: reason.trim() })}
                      />
                    </View>
                  </View>
                </View>
              ) : null}
              {isAssignee && !task.accepted_at && task.status !== 'done' ? (
                <Button title="Üstlendim" icon="hand-left-outline" variant="ghost" busy={acceptM.isPending} onPress={() => acceptM.mutate()} />
              ) : null}
            </View>
          </Card>
        ) : null}

        {approvalOn && task.requires_approval ? (
          <Card title="Onay" icon="shield-checkmark-outline">
            <InfoRow icon="person-outline" label="Onaylayacak kişi">
              {c.nameOf(task.approver_id)}
            </InfoRow>
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
              <View style={{ gap: space.md, marginTop: space.md }}>
                <Button title="Onayla" icon="checkmark-done" busy={approveM.isPending} disabled={changesM.isPending} onPress={() => approveM.mutate()} />
                {!changesOpen ? (
                  <Button title="Düzeltme iste" icon="arrow-undo" variant="secondary" disabled={approveM.isPending} onPress={() => setChangesOpen(true)} />
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
                      style={{ minHeight: 96, textAlignVertical: 'top' }}
                    />
                    <View style={{ flexDirection: 'row', gap: space.md }}>
                      <View style={{ flex: 1 }}>
                        <Button title="Vazgeç" variant="secondary" onPress={() => setChangesOpen(false)} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Button title="Gönder" variant="danger" busy={changesM.isPending} disabled={note.trim().length < 3} onPress={() => changesM.mutate()} />
                      </View>
                    </View>
                  </View>
                )}
              </View>
            ) : null}
          </Card>
        ) : null}

        <Card title="Bilgiler" icon="information-circle-outline">
          <InfoRow icon="person-outline" label="Sorumlu">
            {c.nameOf(task.assignee_id)}
          </InfoRow>
          <InfoRow icon="person-add-outline" label="Görevi veren">
            {c.nameOf(task.created_by)}
          </InfoRow>
          {contributorIds.length ? (
            <InfoRow icon="people-outline" label="Katkıda bulunanlar">
              {contributorIds.map((x) => c.nameOf(x)).join(', ')}
            </InfoRow>
          ) : null}
          {task.due_at ? (
            <InfoRow icon="calendar-outline" label="Son tarih">
              {formatDateTime(task.due_at, c.timezone)}
              {task.due_all_day ? ' (gün sonu)' : ''}
            </InfoRow>
          ) : null}
          {task.description ? (
            <View style={{ borderTopWidth: 1, borderTopColor: t.border.default, marginTop: space.sm, paddingTop: space.md }}>
              <Text style={s.body}>{task.description}</Text>
            </View>
          ) : null}
        </Card>

        {task.assignee_id !== task.created_by ? (
          <Card title="Sorumlu takibi" icon="footsteps-outline">
            <Timeline
              items={assignmentSteps(task).map((st) => ({
                key: st.key,
                title: st.label,
                when: st.at ? formatDateTime(st.at, c.timezone) : 'Henüz değil',
                done: Boolean(st.at),
              }))}
            />
          </Card>
        ) : null}

        <Card title={`Yorumlar (${comments.length})`} icon="chatbox-ellipses-outline">
          {comments.length === 0 ? <Text style={[s.muted, { marginBottom: space.md }]}>Henüz yorum yok.</Text> : null}
          {comments.map((cm) => (
            <View key={cm.id} style={{ flexDirection: 'row', gap: space.md, marginBottom: space.md }}>
              <Avatar name={c.nameOf(cm.author_id)} size={36} />
              <View style={{ flex: 1, backgroundColor: t.surface.muted, borderRadius: radius.md, padding: space.md, gap: 2 }}>
                <Text style={s.caption}>
                  {c.nameOf(cm.author_id)} · {formatDateTime(cm.created_at, c.timezone)}
                </Text>
                <Text style={s.body}>{cm.body}</Text>
              </View>
            </View>
          ))}
          {tasksOn ? (
            <View>
              <Field label="Yorum yaz" value={comment} onChangeText={setComment} multiline maxLength={4000} style={{ minHeight: 88, textAlignVertical: 'top' }} />
              <Button title="Yorumu gönder" icon="send" busy={commentM.isPending} disabled={!comment.trim()} onPress={() => commentM.mutate()} />
            </View>
          ) : null}
        </Card>

        <Card title="İşlem geçmişi" icon="time-outline">
          <Timeline
            items={events.map((e) => ({
              key: String(e.id),
              title: describeTaskEvent(e, c.nameOf),
              when: formatDateTime(e.created_at, c.timezone),
              done: true,
            }))}
          />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
