/**
 * Görev iş kuralları (gösterim ve istemci tarafı kararlar).
 * Durum geçişlerinin ve yetkinin kesin kontrolü veritabanındaki
 * `public.set_task_status` RPC fonksiyonundadır; buradaki kurallar onunla aynıdır.
 */
import { DEFAULT_TIMEZONE, dayDiff, formatDayRelative, localDateKey, localTimeKey } from './time';

export const TASK_STATUSES = ['new', 'in_progress', 'on_hold', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

/**
 * Durumlar yalnızca renkle anlatılmaz: her durumun metni ve ayrı bir simgesi vardır.
 * `symbol` ekran okuyucudan gizlenir, `label` her zaman görünür.
 */
export const TASK_STATUS_META: Record<TaskStatus, { label: string; symbol: string; tone: Tone }> = {
  new: { label: 'Yeni', symbol: '○', tone: 'neutral' },
  in_progress: { label: 'Devam ediyor', symbol: '▶', tone: 'info' },
  on_hold: { label: 'Beklemede', symbol: '⏸', tone: 'warning' },
  done: { label: 'Tamamlandı', symbol: '✓', tone: 'success' },
};

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_META: Record<TaskPriority, { label: string; symbol: string; tone: Tone }> = {
  low: { label: 'Düşük', symbol: '↓', tone: 'neutral' },
  normal: { label: 'Normal', symbol: '–', tone: 'neutral' },
  high: { label: 'Yüksek', symbol: '↑', tone: 'warning' },
  urgent: { label: 'Acil', symbol: '‼', tone: 'danger' },
};

export const HOLD_REASON_MIN = 3;
export const HOLD_REASON_MAX = 300;

export interface TaskTiming {
  status: TaskStatus;
  due_at: string | null;
  due_all_day: boolean;
  completed_at: string | null;
}

/** Gecikme: son tarih geçmiş ve görev tamamlanmamış. Tamamlanan görev gecikmede sayılmaz. */
export function isOverdue(t: TaskTiming, now: Date = new Date()): boolean {
  return t.status !== 'done' && t.due_at !== null && new Date(t.due_at).getTime() < now.getTime();
}

/** Son tarihten sonra tamamlanmış mı? */
export function completedLate(t: TaskTiming): boolean {
  return t.status === 'done' && t.due_at !== null && t.completed_at !== null && new Date(t.completed_at) > new Date(t.due_at);
}

/** Şirket saat dilimine göre kaç takvim günü gecikti (bugün içinde geçtiyse 0). */
export function overdueDays(t: TaskTiming, tz: string = DEFAULT_TIMEZONE, now: Date = new Date()): number {
  if (!isOverdue(t, now) || !t.due_at) return 0;
  return Math.max(0, dayDiff(localDateKey(t.due_at, tz), localDateKey(now, tz)));
}

export type DueState = 'none' | 'overdue' | 'today' | 'upcoming' | 'done' | 'done_late';

export function dueState(t: TaskTiming, tz: string = DEFAULT_TIMEZONE, now: Date = new Date()): DueState {
  if (t.status === 'done') return completedLate(t) ? 'done_late' : 'done';
  if (!t.due_at) return 'none';
  if (isOverdue(t, now)) return 'overdue';
  return localDateKey(t.due_at, tz) === localDateKey(now, tz) ? 'today' : 'upcoming';
}

/** Kullanıcıya gösterilen son tarih metni: "3 gün gecikti", "Bugün 17:00", "Yarın", "15 Eki". */
export function dueLabel(t: TaskTiming, tz: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  if (!t.due_at) return 'Son tarih yok';
  const day = formatDayRelative(t.due_at, tz, now);
  const when = t.due_all_day ? day : `${day} ${localTimeKey(t.due_at, tz)}`;
  const state = dueState(t, tz, now);
  if (state === 'overdue') {
    const d = overdueDays(t, tz, now);
    return d === 0 ? `Gecikti (${when})` : `${d} gün gecikti`;
  }
  if (state === 'done_late') return `Gecikmeli tamamlandı (son tarih: ${when})`;
  return when;
}

export interface TaskActorContext {
  userId: string;
  /** Kullanıcının bu görev için tasks.manage_all izni var mı (veritabanından gelir) */
  canManageAll: boolean;
}

export interface TaskPeople {
  assignee_id: string;
  created_by: string;
}

/** Durumu değiştirebilenler: ana sorumlu, görevi veren, kapsamında yönetim izni olan. */
export function canChangeStatus(t: TaskPeople, a: TaskActorContext): boolean {
  return t.assignee_id === a.userId || t.created_by === a.userId || a.canManageAll;
}

/** Başlık, açıklama, son tarih, sorumlu değişikliği: görevi veren veya yönetim izni olan. */
export function canEditTask(t: TaskPeople, a: TaskActorContext): boolean {
  return t.created_by === a.userId || a.canManageAll;
}

export interface StatusAction {
  to: TaskStatus;
  label: string;
  needsReason?: boolean;
}

/** Mevcut duruma göre gösterilecek durum butonları. */
export function statusActions(status: TaskStatus): StatusAction[] {
  switch (status) {
    case 'new':
      return [
        { to: 'in_progress', label: 'Başla' },
        { to: 'done', label: 'Tamamlandı' },
        { to: 'on_hold', label: 'Beklemeye al', needsReason: true },
      ];
    case 'in_progress':
      return [
        { to: 'done', label: 'Tamamlandı' },
        { to: 'on_hold', label: 'Beklemeye al', needsReason: true },
      ];
    case 'on_hold':
      return [
        { to: 'in_progress', label: 'Devam et' },
        { to: 'done', label: 'Tamamlandı' },
      ];
    case 'done':
      return [{ to: 'in_progress', label: 'Yeniden aç' }];
  }
}

export interface AssignmentTimes {
  notified_at: string | null;
  seen_at: string | null;
  accepted_at: string | null;
  completed_at: string | null;
}

/**
 * Bildirildi → Görüldü → Üstlenildi → Tamamlandı adımları birbirinden bağımsız
 * zaman damgalarıdır; biri diğerinden türetilmez (Başla butonu dışında: işe başlamak
 * üstlenmeyi de kaydeder, bkz. docs/ARCHITECTURE.md).
 */
export function assignmentSteps(t: AssignmentTimes): { key: keyof AssignmentTimes; label: string; at: string | null }[] {
  return [
    { key: 'notified_at', label: 'Bildirildi', at: t.notified_at },
    { key: 'seen_at', label: 'Görüldü', at: t.seen_at },
    { key: 'accepted_at', label: 'Üstlenildi', at: t.accepted_at },
    { key: 'completed_at', label: 'Tamamlandı', at: t.completed_at },
  ];
}

const FIELD_LABELS: Record<string, string> = {
  title: 'başlık',
  description: 'açıklama',
  priority: 'öncelik',
  assignee_id: 'sorumlu',
  due_at: 'son tarih',
  contributors: 'katkıda bulunanlar',
  group_id: 'grup',
};

/** İşlem geçmişi satırını okunur Türkçe cümleye çevirir. */
export function describeTaskEvent(
  e: { type: string; actor_id: string | null; data: Record<string, unknown> },
  nameOf: (id: string | null | undefined) => string,
): string {
  const actor = nameOf(e.actor_id);
  const d = e.data ?? {};
  const statusLabel = (s: unknown) => (typeof s === 'string' && s in TASK_STATUS_META ? TASK_STATUS_META[s as TaskStatus].label : String(s));
  switch (e.type) {
    case 'created':
      return d.source_message_id
        ? `${actor} görevi bir mesajdan oluşturdu ve ${nameOf(d.assignee_id as string)} kişisine verdi.`
        : `${actor} görevi oluşturdu ve ${nameOf(d.assignee_id as string)} kişisine verdi.`;
    case 'status_changed': {
      const base = `${actor} durumu “${statusLabel(d.from)}” → “${statusLabel(d.to)}” olarak değiştirdi.`;
      return d.reason ? `${base} Neden: ${String(d.reason)}` : base;
    }
    case 'updated': {
      const fields = Array.isArray(d.fields) ? (d.fields as string[]) : [];
      if (fields.includes('assignee_id')) {
        const rest = fields.filter((f) => f !== 'assignee_id').map((f) => FIELD_LABELS[f] ?? f);
        const re = `${actor} görevi ${nameOf(d.assignee_from as string)} yerine ${nameOf(d.assignee_to as string)} kişisine verdi.`;
        return rest.length ? `${re} Ayrıca değişti: ${rest.join(', ')}.` : re;
      }
      return `${actor} şunları değiştirdi: ${fields.map((f) => FIELD_LABELS[f] ?? f).join(', ')}.`;
    }
    case 'seen':
      return `${actor} görevi gördü.`;
    case 'accepted':
      return `${actor} görevi üstlendi.`;
    case 'comment_added':
      return `${actor} yorum yazdı.`;
    case 'approval_requested':
      return `${actor} görevi onaya gönderdi.`;
    case 'approved':
      return `${actor} görevi onayladı.`;
    case 'changes_requested':
      return d.note ? `${actor} düzeltme istedi: ${String(d.note)}` : `${actor} düzeltme istedi.`;
    default:
      return `${actor}: ${e.type}`;
  }
}

/** "Bugünkü işlerim": açık ve (son tarihi bugün/öncesi olan veya devam eden) görevler. */
export function isTodayTask(t: TaskTiming, tz: string = DEFAULT_TIMEZONE, now: Date = new Date()): boolean {
  if (t.status === 'done') return false;
  if (t.status === 'in_progress') return true;
  if (!t.due_at) return false;
  return dayDiff(localDateKey(now, tz), localDateKey(t.due_at, tz)) <= 0;
}

/** Sıralama: gecikenler önce, sonra son tarihe göre, son tarihsizler en sonda. */
export function compareTasksByUrgency(a: TaskTiming & { priority?: TaskPriority }, b: TaskTiming & { priority?: TaskPriority }, now: Date = new Date()): number {
  const ao = isOverdue(a, now) ? 0 : 1;
  const bo = isOverdue(b, now) ? 0 : 1;
  if (ao !== bo) return ao - bo;
  if (a.due_at && b.due_at) return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
  if (a.due_at) return -1;
  if (b.due_at) return 1;
  const pr = (p?: TaskPriority) => (p ? TASK_PRIORITIES.indexOf(p) : 1);
  return pr(b.priority) - pr(a.priority);
}
