/**
 * Bugün (mobil ana sayfa): bileşenler mobil düzene göre sıralanır
 * (kişisel → şirket/rol varsayılanı → standart). Web düzeninden ayrıdır.
 * Düzenleme: yukarı/aşağı taşı, kaldır, ekle. Düzen erişimi değiştirmez (veri RLS'li sorgularla gelir).
 */
import {
  DASHBOARD_MAX_WIDGETS,
  DASHBOARD_SOURCE_LABELS,
  TASK_STATUSES,
  TASK_STATUS_META,
  WIDGETS,
  addableWidgets,
  compareTasksByUrgency,
  fetchAwaitingMyApproval,
  fetchDashboardLayouts,
  fetchMyMentions,
  fetchTaskSummary,
  fetchTasks,
  formatAgo,
  isTodayTask,
  layoutToSave,
  moveItem,
  resetMyDashboard,
  resolveDashboard,
  saveMyDashboard,
  toAppError,
  type WidgetDef,
  type WidgetId,
} from '@istakip/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TaskRow } from '@/components/task-row';
import { Badge, Button, Card, Empty, ErrorView, Loading, Message, colors, s } from '@/components/ui';
import { useCompany } from '@/lib/company';
import { keys } from '@/lib/query';
import { supabase } from '@/lib/supabase';

export default function TodayScreen() {
  const c = useCompany();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const role = c.active?.role ?? 'employee';
  const canUse = (w: WidgetDef) => !w.requires || c.canAnywhere(w.requires);

  const layoutQ = useQuery({
    queryKey: keys.dashboard(c.companyId ?? '-'),
    queryFn: () => fetchDashboardLayouts(supabase, c.companyId!, c.userId, role, 'mobile'),
    enabled: Boolean(c.companyId),
  });
  const dash = resolveDashboard({
    personal: layoutQ.data?.personal ?? null,
    roleDefault: layoutQ.data?.roleDefault ?? null,
    role,
    platform: 'mobile',
    enabledModules: c.enabledModules,
    canUse,
  });

  const me = c.members.find((m) => m.user_id === c.userId);
  const firstName = (me?.profile.full_name || '').split(' ')[0];

  return (
    <>
      <ScrollView
        style={s.screen}
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={layoutQ.isRefetching}
            onRefresh={() => {
              void qc.invalidateQueries({ queryKey: ['tasks', c.companyId] });
              void qc.invalidateQueries({ queryKey: keys.mentions(c.companyId ?? '-') });
              void layoutQ.refetch();
            }}
          />
        }
      >
        <View>
          <Text style={s.h1} accessibilityRole="header">
            Merhaba{firstName ? ` ${firstName}` : ''}
          </Text>
          <Text style={s.muted}>{c.active?.company.name}</Text>
          {c.active?.company.is_demo ? (
            <View style={{ marginTop: 6 }}>
              <Badge t="warning" symbol="⚠" label="DEMO VERİ — örnek kişiler ve görevler" />
            </View>
          ) : null}
          {!c.live ? <Text style={[s.muted, { marginTop: 4 }]}>Canlı bağlantı kuruluyor; aşağı çekerek yenileyebilirsiniz.</Text> : null}
        </View>

        {layoutQ.isLoading ? (
          <Loading label="Ana sayfa yükleniyor…" />
        ) : (
          <>
            {dash.widgets.length === 0 ? <Empty title="Ana sayfanızda bileşen yok" text="Aşağıdaki “Düzenle” ile ekleyebilirsiniz." /> : null}
            {dash.widgets.map((id) => (
              <MobileWidget key={id} id={id} />
            ))}
            <Text style={[s.muted, { textAlign: 'center' }]}>Düzen: {DASHBOARD_SOURCE_LABELS[dash.source]}</Text>
            <Button title="Ana sayfayı düzenle" variant="secondary" onPress={() => setEditing(true)} />
          </>
        )}
      </ScrollView>

      {editing ? (
        <Editor
          initial={dash.widgets}
          hidden={dash.hidden}
          canUse={canUse}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void qc.invalidateQueries({ queryKey: keys.dashboard(c.companyId ?? '-') });
          }}
        />
      ) : null}
    </>
  );
}

function MobileWidget({ id }: { id: WidgetId }) {
  const c = useCompany();
  const now = new Date();
  const canSeeTeam = c.canAnywhere('tasks.view_all');
  const enabled = Boolean(c.companyId);

  const mineQ = useQuery({
    queryKey: keys.tasks(c.companyId ?? '-', 'mine', 'open'),
    queryFn: () => fetchTasks(supabase, c.companyId!, { scope: 'mine', userId: c.userId, status: 'open' }),
    enabled: enabled && (id === 'my_today' || (id === 'overdue' && !canSeeTeam)),
  });
  const teamOverdueQ = useQuery({
    queryKey: keys.tasks(c.companyId ?? '-', 'all', 'overdue'),
    queryFn: () => fetchTasks(supabase, c.companyId!, { scope: 'all', userId: c.userId, overdueOnly: true, limit: 20 }),
    enabled: enabled && id === 'overdue' && canSeeTeam,
  });
  const createdQ = useQuery({
    queryKey: keys.tasks(c.companyId ?? '-', 'created', 'open'),
    queryFn: () => fetchTasks(supabase, c.companyId!, { scope: 'created', userId: c.userId, status: 'open', limit: 20 }),
    enabled: enabled && id === 'assigned_by_me',
  });
  const approvalQ = useQuery({
    queryKey: ['tasks', c.companyId ?? '-', 'awaiting-approval'],
    queryFn: () => fetchAwaitingMyApproval(supabase, c.companyId!, c.userId, 20),
    enabled: enabled && id === 'awaiting_my_approval',
  });
  const summaryQ = useQuery({
    queryKey: ['tasks', c.companyId ?? '-', 'summary'],
    queryFn: () => fetchTaskSummary(supabase, c.companyId!),
    enabled: enabled && id === 'team_summary',
  });
  const mentionsQ = useQuery({
    queryKey: keys.mentions(c.companyId ?? '-'),
    queryFn: () => fetchMyMentions(supabase, c.companyId!, 5),
    enabled: enabled && id === 'mentions',
  });

  const state = (q: { isLoading: boolean; error: unknown; refetch: () => unknown }) =>
    q.isLoading ? <Loading /> : q.error ? <ErrorView message={toAppError(q.error).message} onRetry={() => void q.refetch()} /> : null;

  switch (id) {
    case 'my_today': {
      const today = (mineQ.data ?? []).filter((t) => isTodayTask(t, c.timezone, now)).sort((a, b) => compareTasksByUrgency(a, b, now));
      const overdue = (mineQ.data ?? []).filter((t) => t.is_overdue).length;
      return (
        <Card title="Bugünkü işlerim">
          {state(mineQ) ?? (
            <>
              <View style={[s.row, { gap: 8, marginBottom: 6 }]}>
                <Badge t="info" label={`${mineQ.data?.length ?? 0} açık iş`} />
                {overdue ? <Badge t="danger" symbol="⚠" label={`${overdue} gecikmiş`} /> : null}
              </View>
              {today.length ? (
                today.map((t) => <TaskRow key={t.id} task={t} tz={c.timezone} subtitle={`Veren: ${c.nameOf(t.created_by)}`} />)
              ) : (
                <Empty title="Bugün için bekleyen işiniz yok" />
              )}
            </>
          )}
        </Card>
      );
    }
    case 'overdue': {
      const q = canSeeTeam ? teamOverdueQ : mineQ;
      const list = (canSeeTeam ? (teamOverdueQ.data ?? []) : (mineQ.data ?? []).filter((t) => t.is_overdue)).sort((a, b) => compareTasksByUrgency(a, b, now));
      return (
        <Card title={canSeeTeam ? 'Geciken işler (ekip)' : 'Geciken işlerim'}>
          {state(q) ??
            (list.length ? (
              list.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  tz={c.timezone}
                  subtitle={canSeeTeam ? `Sorumlu: ${c.nameOf(t.assignee_id)}` : `Veren: ${c.nameOf(t.created_by)}`}
                />
              ))
            ) : (
              <Empty title="Geciken iş yok" />
            ))}
        </Card>
      );
    }
    case 'assigned_by_me':
      return (
        <Card title="Verdiğim işler">
          {state(createdQ) ??
            ((createdQ.data ?? []).length ? (
              (createdQ.data ?? []).map((t) => <TaskRow key={t.id} task={t} tz={c.timezone} subtitle={`Sorumlu: ${c.nameOf(t.assignee_id)}`} />)
            ) : (
              <Empty title="Başkasına verdiğiniz açık iş yok" />
            ))}
        </Card>
      );
    case 'awaiting_my_approval':
      return (
        <Card title={`Onayımı bekleyenler${approvalQ.data?.length ? ` (${approvalQ.data.length})` : ''}`}>
          {state(approvalQ) ??
            ((approvalQ.data ?? []).length ? (
              (approvalQ.data ?? []).map((t) => <TaskRow key={t.id} task={t} tz={c.timezone} subtitle={`Sorumlu: ${c.nameOf(t.assignee_id)}`} />)
            ) : (
              <Empty title="Onayınızı bekleyen görev yok" />
            ))}
        </Card>
      );
    case 'team_summary': {
      const rows = summaryQ.data ?? [];
      return (
        <Card title="Ekip görev özeti">
          {state(summaryQ) ?? (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {TASK_STATUSES.map((st) => (
                  <View key={st} style={{ flexBasis: '47%', flexGrow: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 10 }} accessible>
                    <Text style={s.muted}>
                      {TASK_STATUS_META[st].symbol} {TASK_STATUS_META[st].label}
                    </Text>
                    <Text style={{ fontSize: 22, fontWeight: '800', color: colors.ink }}>{rows.find((r) => r.status === st)?.total ?? 0}</Text>
                  </View>
                ))}
              </View>
              <Text style={[s.body, { color: colors.danger, fontWeight: '700', marginTop: 8 }]}>⚠ {rows.reduce((n, r) => n + r.overdue, 0)} görev gecikmede</Text>
            </>
          )}
        </Card>
      );
    }
    case 'mentions':
      return (
        <Card title="Etiketlendiğim mesajlar">
          {state(mentionsQ) ??
            ((mentionsQ.data ?? []).length ? (
              (mentionsQ.data ?? []).map((m) => (
                <Pressable
                  key={m.message_id}
                  accessibilityRole="button"
                  accessibilityLabel={`${m.is_read ? '' : 'Okunmamış. '}${c.nameOf(m.author_id)}, ${m.conversation_title}: ${m.body}`}
                  onPress={() => router.push({ pathname: '/mesaj/[id]', params: { id: m.conversation_id, m: m.message_id } })}
                  style={{ minHeight: 48, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.line }}
                >
                  <Text style={[s.body, { fontWeight: '700' }]}>
                    {m.is_read ? '' : '● '}
                    {c.nameOf(m.author_id)} · {m.conversation_title}
                  </Text>
                  <Text style={s.muted} numberOfLines={2}>
                    {m.body || '📎 Dosya'} · {formatAgo(m.created_at, now)}
                  </Text>
                </Pressable>
              ))
            ) : (
              <Empty title="Sizi etiketleyen mesaj yok" />
            ))}
        </Card>
      );
  }
}

function Editor({
  initial,
  hidden,
  canUse,
  onClose,
  onSaved,
}: {
  initial: WidgetId[];
  hidden: WidgetId[];
  canUse: (w: WidgetDef) => boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const c = useCompany();
  const [items, setItems] = useState<WidgetId[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addable = addableWidgets(items, c.enabledModules, canUse);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveMyDashboard(supabase, c.companyId!, 'mobile', layoutToSave(items, hidden));
      onSaved();
    } catch (e) {
      setError(toAppError(e).message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    Alert.alert('Varsayılana dönülsün mü?', 'Kendi mobil düzeniniz silinir; şirket varsayılanı (yoksa standart düzen) kullanılır.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Varsayılana dön',
        onPress: () => {
          setBusy(true);
          resetMyDashboard(supabase, c.companyId!, 'mobile')
            .then(onSaved)
            .catch((e) => setError(toAppError(e).message))
            .finally(() => setBusy(false));
        },
      },
    ]);
  }

  const small = { minHeight: 44, minWidth: 44, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1, borderColor: colors.line, borderRadius: 10, backgroundColor: colors.surface };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.screen}>
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.h1} accessibilityRole="header">
            Ana sayfayı düzenle
          </Text>
          <Text style={s.muted}>Mobil düzeniniz web düzeninizden ayrıdır. Bu ayar yalnızca görünümü değiştirir; kimin neyi göreceğini değiştirmez.</Text>
          {hidden.length ? <Text style={s.muted}>{hidden.length} bileşen kapalı modül nedeniyle gizli; düzeninizde korunur.</Text> : null}

          {items.map((id, i) => (
            <View key={id} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 }]}>
              <View style={{ flex: 1 }}>
                <Text style={[s.body, { fontWeight: '700' }]}>
                  {i + 1}. {WIDGETS[id].title}
                </Text>
                <Text style={s.muted}>{WIDGETS[id].description}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${WIDGETS[id].title}: yukarı taşı`}
                accessibilityState={{ disabled: i === 0 }}
                disabled={i === 0}
                onPress={() => setItems(moveItem(items, i, -1))}
                style={[small, { opacity: i === 0 ? 0.4 : 1 }]}
              >
                <Text style={{ fontSize: 20, fontWeight: '800' }}>↑</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${WIDGETS[id].title}: aşağı taşı`}
                disabled={i === items.length - 1}
                onPress={() => setItems(moveItem(items, i, 1))}
                style={[small, { opacity: i === items.length - 1 ? 0.4 : 1 }]}
              >
                <Text style={{ fontSize: 20, fontWeight: '800' }}>↓</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${WIDGETS[id].title}: kaldır`}
                onPress={() => setItems(items.filter((x) => x !== id))}
                style={[small, { borderColor: '#f1b8b2' }]}
              >
                <Text style={{ fontSize: 18, fontWeight: '800', color: colors.danger }}>×</Text>
              </Pressable>
            </View>
          ))}

          {addable.length && items.length < DASHBOARD_MAX_WIDGETS ? (
            <Card title="Bileşen ekle">
              <View style={{ gap: 8 }}>
                {addable.map((w) => (
                  <Button key={w.id} title={`+ ${w.title}`} variant="secondary" onPress={() => setItems([...items, w.id])} />
                ))}
              </View>
            </Card>
          ) : null}

          {error ? <Message kind="error" text={error} /> : null}
          <Button title={busy ? 'Kaydediliyor…' : 'Düzeni kaydet'} busy={busy} onPress={() => void save()} />
          <Button title="Varsayılana dön" variant="secondary" disabled={busy} onPress={reset} />
          <Button title="Vazgeç" variant="secondary" onPress={onClose} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
