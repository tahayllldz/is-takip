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
import { Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BrandLogo } from '@/components/brand-logo';
import { TaskRow } from '@/components/task-row';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Empty,
  ErrorView,
  Icon,
  IconButton,
  Loading,
  Message,
  Notice,
  ProgressBar,
  STATUS_ICONS,
  type IconName,
} from '@/components/ui';
import { useCompany } from '@/lib/company';
import { confirmAction } from '@/lib/confirm';
import { keys } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, space, useTheme } from '@/lib/theme';

const WIDGET_ICONS: Record<WidgetId, IconName> = {
  my_today: 'sunny-outline',
  overdue: 'alert-circle-outline',
  assigned_by_me: 'paper-plane-outline',
  mentions: 'at-outline',
  awaiting_my_approval: 'hourglass-outline',
  team_summary: 'stats-chart-outline',
};

export default function TodayScreen() {
  const c = useCompany();
  const { s } = useTheme();
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
        <Hero />

        {layoutQ.isLoading ? (
          <Loading label="Ana sayfa yükleniyor…" />
        ) : (
          <>
            {dash.widgets.length === 0 ? (
              <Empty
                icon="grid-outline"
                title="Ana sayfanızda bileşen yok"
                text="Sık baktığınız listeleri buraya ekleyebilirsiniz."
                action={<Button title="Bileşen ekle" icon="add" variant="secondary" onPress={() => setEditing(true)} />}
              />
            ) : null}
            {dash.widgets.map((id) => (
              <MobileWidget key={id} id={id} />
            ))}
            {dash.widgets.length ? (
              <View style={{ alignItems: 'center', gap: space.xs }}>
                <Button title="Ana sayfayı düzenle" icon="options-outline" variant="ghost" compact onPress={() => setEditing(true)} />
                <Text style={s.caption}>Düzen: {DASHBOARD_SOURCE_LABELS[dash.source]}</Text>
              </View>
            ) : null}
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

/** Karşılama: logo, şirket, selamlama ve günün kısa özeti */
function Hero() {
  const c = useCompany();
  const { t, s } = useTheme();
  const tasksOn = c.enabledModules.includes('tasks');
  const mineQ = useQuery({
    queryKey: keys.tasks(c.companyId ?? '-', 'mine', 'open'),
    queryFn: () => fetchTasks(supabase, c.companyId!, { scope: 'mine', userId: c.userId, status: 'open' }),
    enabled: Boolean(c.companyId) && tasksOn,
  });
  const me = c.members.find((m) => m.user_id === c.userId);
  const firstName = (me?.profile.full_name || '').split(' ')[0];
  const open = mineQ.data?.length ?? 0;
  const overdue = (mineQ.data ?? []).filter((x) => x.is_overdue).length;
  const branded = t.hero.branded;
  const name = c.active?.company.name ?? '';

  return (
    <View
      style={[
        { gap: space.md },
        branded ? { backgroundColor: t.hero.bg, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: t.hero.border } : null,
      ]}
    >
      {/* Dar ekranda şirket adı kesilmez, logonun altına geçer */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md }}>
        <BrandLogo name={name} height={44} maxWidth={160} surface={t.hero.bg} />
        <Text style={[s.muted, { color: t.hero.fgMuted, flexGrow: 1, flexShrink: 1, flexBasis: 140, fontWeight: '600' }]}>{name}</Text>
      </View>
      <View style={{ gap: space.xs }}>
        <Text style={[s.title, { color: t.hero.fg }]} accessibilityRole="header">
          Merhaba{firstName ? ` ${firstName}` : ''}
        </Text>
        {tasksOn && mineQ.data ? (
          <Text style={[s.body, { color: t.hero.fgMuted }]}>
            {open === 0 ? 'Açık işiniz yok.' : `${open} açık işiniz var${overdue ? `, ${overdue} tanesi gecikmiş` : ''}.`}
          </Text>
        ) : null}
      </View>
      {c.active?.company.is_demo ? <Badge t="warning" icon="flask-outline" label="DEMO VERİ — örnek kişiler ve görevler" /> : null}
      {!c.live ? <Notice icon="sync-outline" text="Canlı bağlantı kuruluyor; aşağı çekerek yenileyebilirsiniz." /> : null}
    </View>
  );
}

function SeeAll({ onPress, label }: { onPress: () => void; label: string }) {
  const { s } = useTheme();
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={s.link}>Tümü</Text>
    </Pressable>
  );
}

function MobileWidget({ id }: { id: WidgetId }) {
  const c = useCompany();
  const { t, s } = useTheme();
  const now = new Date();
  const canSeeTeam = c.canAnywhere('tasks.view_all');
  const enabled = Boolean(c.companyId);
  const goTasks = () => router.push('/(tabs)/gorevler');

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
  const icon = WIDGET_ICONS[id];

  switch (id) {
    case 'my_today': {
      const today = (mineQ.data ?? []).filter((x) => isTodayTask(x, c.timezone, now)).sort((a, b) => compareTasksByUrgency(a, b, now));
      return (
        <Card title="Bugünkü işlerim" icon={icon} right={<SeeAll onPress={goTasks} label="Tüm görevlerim" />}>
          {state(mineQ) ??
            (today.length ? (
              today.map((x, i) => <TaskRow key={x.id} task={x} tz={c.timezone} subtitle={`Veren: ${c.nameOf(x.created_by)}`} last={i === today.length - 1} />)
            ) : (
              <Empty plain icon="checkmark-done-outline" title="Bugün için bekleyen işiniz yok" text="Son tarihi bugün veya geçmiş açık göreviniz bulunmuyor." />
            ))}
        </Card>
      );
    }
    case 'overdue': {
      const q = canSeeTeam ? teamOverdueQ : mineQ;
      const list = (canSeeTeam ? (teamOverdueQ.data ?? []) : (mineQ.data ?? []).filter((x) => x.is_overdue)).sort((a, b) => compareTasksByUrgency(a, b, now));
      return (
        <Card title={canSeeTeam ? 'Geciken işler (ekip)' : 'Geciken işlerim'} icon={icon}>
          {state(q) ??
            (list.length ? (
              list.map((x, i) => (
                <TaskRow
                  key={x.id}
                  task={x}
                  tz={c.timezone}
                  subtitle={canSeeTeam ? `Sorumlu: ${c.nameOf(x.assignee_id)}` : `Veren: ${c.nameOf(x.created_by)}`}
                  last={i === list.length - 1}
                />
              ))
            ) : (
              <Empty plain icon="happy-outline" title="Geciken iş yok" />
            ))}
        </Card>
      );
    }
    case 'assigned_by_me': {
      const list = createdQ.data ?? [];
      return (
        <Card title="Verdiğim işler" icon={icon} right={list.length ? <SeeAll onPress={goTasks} label="Verdiğim tüm işler" /> : undefined}>
          {state(createdQ) ??
            (list.length ? (
              list.map((x, i) => <TaskRow key={x.id} task={x} tz={c.timezone} subtitle={`Sorumlu: ${c.nameOf(x.assignee_id)}`} last={i === list.length - 1} />)
            ) : (
              <Empty plain icon="paper-plane-outline" title="Başkasına verdiğiniz açık iş yok" />
            ))}
        </Card>
      );
    }
    case 'awaiting_my_approval': {
      const list = approvalQ.data ?? [];
      return (
        <Card title={`Onayımı bekleyenler${list.length ? ` (${list.length})` : ''}`} icon={icon}>
          {state(approvalQ) ??
            (list.length ? (
              list.map((x, i) => <TaskRow key={x.id} task={x} tz={c.timezone} subtitle={`Sorumlu: ${c.nameOf(x.assignee_id)}`} last={i === list.length - 1} />)
            ) : (
              <Empty plain icon="hourglass-outline" title="Onayınızı bekleyen görev yok" text="Onaylayıcısı olduğunuz bir görev tamamlandığında burada görünür." />
            ))}
        </Card>
      );
    }
    case 'team_summary': {
      const rows = summaryQ.data ?? [];
      const count = (st: string) => rows.find((r) => r.status === st)?.total ?? 0;
      const total = TASK_STATUSES.reduce((n, st) => n + count(st), 0);
      const overdue = rows.reduce((n, r) => n + r.overdue, 0);
      const done = count('done');
      return (
        <Card title="Ekip görev özeti" icon={icon}>
          {state(summaryQ) ?? (
            <View style={{ gap: space.md }}>
              <View style={{ gap: space.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={s.muted}>Tamamlanan</Text>
                  <Text style={[s.strong, { fontVariant: ['tabular-nums'] }]}>
                    {done} / {total}
                  </Text>
                </View>
                <ProgressBar value={total ? done / total : 0} label={`Ekip görevlerinin ${total ? Math.round((done / total) * 100) : 0}% tamamlandı`} />
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {TASK_STATUSES.map((st) => {
                  const meta = TASK_STATUS_META[st];
                  const tone = t.status[meta.tone];
                  return (
                    <View
                      key={st}
                      accessible
                      accessibilityLabel={`${meta.label}: ${count(st)}`}
                      style={{ flexBasis: '47%', flexGrow: 1, borderRadius: radius.md, padding: space.md, backgroundColor: t.surface.muted, gap: space.xs }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                        <Icon name={STATUS_ICONS[st]} size={16} color={tone.fg} />
                        <Text style={[s.caption, { color: t.text.secondary }]}>{meta.label}</Text>
                      </View>
                      <Text style={{ fontSize: 26, fontWeight: '700', color: t.text.primary, fontVariant: ['tabular-nums'] }}>{count(st)}</Text>
                    </View>
                  );
                })}
              </View>
              {overdue ? <Badge t="danger" icon="alert-circle" label={`${overdue} görev gecikmede`} /> : <Badge t="success" icon="checkmark" label="Geciken görev yok" />}
            </View>
          )}
        </Card>
      );
    }
    case 'mentions': {
      const list = mentionsQ.data ?? [];
      return (
        <Card title="Etiketlendiğim mesajlar" icon={icon}>
          {state(mentionsQ) ??
            (list.length ? (
              list.map((m, i) => (
                <Pressable
                  key={m.message_id}
                  accessibilityRole="button"
                  accessibilityLabel={`${m.is_read ? '' : 'Okunmamış. '}${c.nameOf(m.author_id)}, ${m.conversation_title}: ${m.body}`}
                  onPress={() => router.push({ pathname: '/mesaj/[id]', params: { id: m.conversation_id, m: m.message_id } })}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    gap: space.md,
                    minHeight: 56,
                    paddingVertical: space.md,
                    borderBottomWidth: i === list.length - 1 ? 0 : 1,
                    borderColor: t.border.default,
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  <Avatar name={c.nameOf(m.author_id)} size={36} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                      {!m.is_read ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.selection.fg }} /> : null}
                      <Text style={[s.strong, { flex: 1 }]} numberOfLines={1}>
                        {c.nameOf(m.author_id)} · {m.conversation_title}
                      </Text>
                    </View>
                    <Text style={s.muted} numberOfLines={2}>
                      {m.body || 'Dosya'}
                    </Text>
                    <Text style={s.caption}>{formatAgo(m.created_at, now)}</Text>
                  </View>
                </Pressable>
              ))
            ) : (
              <Empty plain icon="at-outline" title="Sizi etiketleyen mesaj yok" text="Biri sizi bir mesajda @ ile etiketlediğinde burada görünür." />
            ))}
        </Card>
      );
    }
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
  const { t, s } = useTheme();
  const [items, setItems] = useState<WidgetId[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addable = addableWidgets(items, c.enabledModules, canUse);
  const dirty = items.join() !== initial.join();

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

  async function close() {
    if (!dirty) return onClose();
    const ok = await confirmAction({
      title: 'Değişiklikler kaydedilmedi',
      message: 'Ana sayfa düzeninde yaptığınız değişiklikler kaybolacak.',
      confirm: 'Kaydetmeden çık',
      cancel: 'Düzenlemeye devam et',
      destructive: true,
    });
    if (ok) onClose();
  }

  async function reset() {
    const ok = await confirmAction({
      title: 'Varsayılana dönülsün mü?',
      message: 'Kendi mobil düzeniniz silinir; şirket varsayılanı (yoksa standart düzen) kullanılır.',
      confirm: 'Varsayılana dön',
    });
    if (!ok) return;
    setBusy(true);
    resetMyDashboard(supabase, c.companyId!, 'mobile')
      .then(onSaved)
      .catch((e) => setError(toAppError(e).message))
      .finally(() => setBusy(false));
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => void close()}>
      <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: space.lg, paddingBottom: space.sm, gap: space.md }}>
          <Text style={[s.heading, { flex: 1 }]} accessibilityRole="header">
            Ana sayfayı düzenle
          </Text>
          <IconButton icon="close" label="Kapat" onPress={() => void close()} />
        </View>
        <ScrollView contentContainerStyle={[s.content, { paddingTop: space.sm }]}>
          <Text style={s.muted}>Mobil düzeniniz web düzeninizden ayrıdır. Bu ayar yalnızca görünümü değiştirir; kimin neyi göreceğini değiştirmez.</Text>
          {hidden.length ? <Notice icon="eye-off-outline" text={`${hidden.length} bileşen kapalı modül nedeniyle gizli; düzeninizde korunur.`} /> : null}

          <View style={[s.card, { paddingVertical: space.xs }]}>
            {items.length === 0 ? <Text style={[s.muted, { paddingVertical: space.md }]}>Henüz bileşen yok. Aşağıdan ekleyin.</Text> : null}
            {items.map((id, i) => (
              <View
                key={id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.sm,
                  paddingVertical: space.md,
                  borderBottomWidth: i === items.length - 1 ? 0 : 1,
                  borderBottomColor: t.border.default,
                }}
              >
                <Icon name={WIDGET_ICONS[id]} size={22} color={t.text.link} />
                <View style={{ flex: 1 }}>
                  <Text style={s.strong}>
                    {i + 1}. {WIDGETS[id].title}
                  </Text>
                  <Text style={s.muted} numberOfLines={2}>
                    {WIDGETS[id].description}
                  </Text>
                </View>
                <IconButton icon="arrow-up" label={`${WIDGETS[id].title}: yukarı taşı`} disabled={i === 0} onPress={() => setItems(moveItem(items, i, -1))} />
                <IconButton
                  icon="arrow-down"
                  label={`${WIDGETS[id].title}: aşağı taşı`}
                  disabled={i === items.length - 1}
                  onPress={() => setItems(moveItem(items, i, 1))}
                />
                <IconButton icon="trash-outline" tone="danger" label={`${WIDGETS[id].title}: kaldır`} onPress={() => setItems(items.filter((x) => x !== id))} />
              </View>
            ))}
          </View>

          {addable.length && items.length < DASHBOARD_MAX_WIDGETS ? (
            <Card title="Bileşen ekle" icon="add-circle-outline">
              <View style={{ gap: space.sm }}>
                {addable.map((w) => (
                  <Button key={w.id} title={w.title} icon="add" variant="secondary" onPress={() => setItems([...items, w.id])} />
                ))}
              </View>
            </Card>
          ) : null}
          {error ? <Message kind="error" text={error} /> : null}
          <Button title="Varsayılana dön" icon="refresh" variant="ghost" disabled={busy} onPress={() => void reset()} />
        </ScrollView>
        <View style={{ flexDirection: 'row', gap: space.md, padding: space.lg, borderTopWidth: 1, borderTopColor: t.border.default, backgroundColor: t.surface.default }}>
          <View style={{ flex: 1 }}>
            <Button title="Vazgeç" variant="secondary" onPress={() => void close()} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title={busy ? 'Kaydediliyor…' : 'Kaydet'} icon="checkmark" busy={busy} disabled={!dirty} onPress={() => void save()} />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
