/**
 * Düzenlenebilir ana sayfa: hangi bileşenler hangi sırada görünür.
 *
 * Çözüm sırası: kişisel düzen → şirketin rol varsayılanı → yerleşik varsayılan (aşağıda).
 * Web ve mobil düzenleri ayrıdır. Düzen erişimi değiştirmez: bileşenin verisi her zaman RLS'li
 * sorguyla gelir; izin gerektiren bileşen izni olmayan kişiye gösterilmez ve eklenemez
 * (veritabanında save_my_dashboard da aynı kuralı uygular). Kapalı modülün bileşeni kayıtlı düzende
 * kalır ama gösterilmez; modül açılınca aynı yerde geri gelir.
 */
import { WIDGETS, isModuleEnabled, type ModuleId, type WidgetDef, type WidgetId } from './modules';
import type { Role } from './permissions';

export const DASHBOARD_PLATFORMS = ['web', 'mobile'] as const;
export type DashboardPlatform = (typeof DASHBOARD_PLATFORMS)[number];
export const DASHBOARD_PLATFORM_LABELS: Record<DashboardPlatform, string> = { web: 'Web', mobile: 'Mobil' };
export const DASHBOARD_MAX_WIDGETS = 12;

/** Yerleşik varsayılan: çalışanda kendi işleri, yönetici/sahipte bekleyen ve geciken işler öne çıkar. */
export const BUILTIN_DASHBOARDS: Record<Role, Record<DashboardPlatform, WidgetId[]>> = {
  owner: {
    web: ['overdue', 'awaiting_my_approval', 'team_summary', 'my_today', 'assigned_by_me', 'mentions'],
    mobile: ['my_today', 'awaiting_my_approval', 'overdue', 'mentions'],
  },
  admin: {
    web: ['overdue', 'awaiting_my_approval', 'team_summary', 'my_today', 'assigned_by_me', 'mentions'],
    mobile: ['my_today', 'awaiting_my_approval', 'overdue', 'mentions'],
  },
  employee: {
    web: ['my_today', 'overdue', 'mentions', 'assigned_by_me'],
    mobile: ['my_today', 'mentions', 'overdue'],
  },
};

export type DashboardSource = 'personal' | 'role_default' | 'builtin';

export const DASHBOARD_SOURCE_LABELS: Record<DashboardSource, string> = {
  personal: 'Kendi düzeniniz',
  role_default: 'Şirket varsayılanı',
  builtin: 'Standart düzen',
};

export interface ResolvedDashboard {
  /** Gösterilecek bileşenler (sıralı) */
  widgets: WidgetId[];
  /** Kayıtlı ama modülü kapalı olduğu için gizlenen bileşenler */
  hidden: WidgetId[];
  source: DashboardSource;
}

const isWidgetId = (id: string): id is WidgetId => Object.prototype.hasOwnProperty.call(WIDGETS, id);

export function resolveDashboard(input: {
  personal: readonly string[] | null;
  roleDefault: readonly string[] | null;
  role: Role;
  platform: DashboardPlatform;
  enabledModules: readonly ModuleId[];
  /** Kişinin bileşeni görme izni (ör. ekip özeti için tasks.view_all) */
  canUse: (w: WidgetDef) => boolean;
}): ResolvedDashboard {
  const source: DashboardSource = input.personal ? 'personal' : input.roleDefault ? 'role_default' : 'builtin';
  const raw = input.personal ?? input.roleDefault ?? BUILTIN_DASHBOARDS[input.role][input.platform];
  const usable = [...new Set(raw)].filter(isWidgetId).filter((id) => input.canUse(WIDGETS[id]));
  const widgets = usable.filter((id) => isModuleEnabled(WIDGETS[id].module, input.enabledModules));
  return { widgets, hidden: usable.filter((id) => !widgets.includes(id)), source };
}

/** Eklenebilecek bileşenler: modülü açık, izni olan ve düzende olmayanlar */
export function addableWidgets(current: readonly WidgetId[], enabledModules: readonly ModuleId[], canUse: (w: WidgetDef) => boolean): WidgetDef[] {
  return (Object.values(WIDGETS) as WidgetDef[]).filter(
    (w) => !current.includes(w.id) && isModuleEnabled(w.module, enabledModules) && canUse(w),
  );
}

/** Kaydedilecek liste: görünen sıra + gizli (kapalı modül) bileşenler sonda — modül açılınca kaybolmasınlar */
export function layoutToSave(visible: readonly WidgetId[], hidden: readonly WidgetId[]): WidgetId[] {
  return [...visible, ...hidden.filter((h) => !visible.includes(h))].slice(0, DASHBOARD_MAX_WIDGETS);
}

/** Klavye/dokunmatik için yukarı-aşağı taşıma */
export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** Sürükle-bırak: bir öğeyi başka bir öğenin yerine taşı */
export function moveTo<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}
