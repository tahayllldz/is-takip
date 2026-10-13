/**
 * Modül tanımları.
 *
 * Bir modül: kimlik, menü öğeleri, izinler (permissions.ts içinde `module` alanı),
 * bağımlılıklar ve ana sayfa bileşenlerinden oluşur.
 *
 * Bu dosya arayüzün neyi göstereceğini belirler. Modülün açık/kapalı olması ve
 * kapalı modülde yeni işlem/bildirim üretiminin engellenmesi veritabanında
 * (`public.company_modules`, `private.module_enabled`) uygulanır.
 *
 * Bağımlılık kuralları (docs/MODULES.md):
 * - `core` her zaman açıktır; gruplar, üyelik, bildirim kutusu ve işlem geçmişi core'dadır.
 * - Bir modül, bağımlı olduğu modüller açıkken açılabilir.
 * - Bir modül, ona bağımlı açık modül varken kapatılamaz (önce bağımlı kapatılır).
 * - Görevler, İletişim'e bağımlı DEĞİLDİR: grup üyeliği core'dan gelir.
 * - İki modül gerektiren özellikler FEATURES içinde tanımlıdır (ör. mesajdan göreve dönüştür).
 */

export const MODULE_IDS = ['core', 'tasks', 'messaging', 'task_approval'] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

export interface MenuItem {
  key: string;
  label: string;
  /** Web rotası */
  webPath: string;
  /** Mobil sekme/rota adı (yoksa mobilde menüde yer almaz) */
  mobileRoute?: string;
  /** Öğeyi görmek için gereken izin (yoksa her üye görür) */
  requires?: string;
  /** Menüdeki yeri (modül sırasından bağımsız; küçük olan önce) */
  order: number;
}

export type WidgetId =
  | 'my_today'
  | 'overdue'
  | 'assigned_by_me'
  | 'mentions'
  | 'awaiting_my_approval'
  | 'team_summary';

export interface WidgetDef {
  id: WidgetId;
  module: ModuleId;
  title: string;
  description: string;
  /** Bileşeni eklemek için gereken izin. Bileşen yalnızca veriyi gösterir; erişimi RLS belirler. */
  requires?: string;
}

export interface ModuleDef {
  id: ModuleId;
  name: string;
  description: string;
  /** Kapatılamaz temel modül */
  core: boolean;
  dependsOn: readonly ModuleId[];
  menu: readonly MenuItem[];
  widgets: readonly WidgetId[];
}

export const MODULES: Record<ModuleId, ModuleDef> = {
  core: {
    id: 'core',
    name: 'Temel',
    description: 'Şirket, üyeler, gruplar, davetler, bildirim kutusu ve işlem geçmişi.',
    core: true,
    dependsOn: [],
    menu: [
      { key: 'home', label: 'Ana sayfa', webPath: '/', mobileRoute: 'index', order: 10 },
      { key: 'team', label: 'Ekip', webPath: '/ekip', requires: 'members.invite', order: 40 },
      { key: 'groups', label: 'Gruplar', webPath: '/gruplar', order: 50 },
      { key: 'notifications', label: 'Bildirimler', webPath: '/bildirimler', mobileRoute: 'bildirimler', order: 60 },
      { key: 'settings', label: 'Ayarlar', webPath: '/ayarlar', order: 90 },
    ],
    widgets: [],
  },
  tasks: {
    id: 'tasks',
    name: 'Görevler',
    description: 'Görev atama, durum ve gecikme takibi, görev içi yorumlar.',
    core: false,
    dependsOn: [],
    menu: [{ key: 'tasks', label: 'Görevler', webPath: '/gorevler', mobileRoute: 'gorevler', order: 20 }],
    widgets: ['my_today', 'overdue', 'assigned_by_me', 'team_summary'],
  },
  messaging: {
    id: 'messaging',
    name: 'İletişim',
    description: 'Grup ve birebir mesajlar, @etiketleme, dosya ekleri.',
    core: false,
    dependsOn: [],
    menu: [{ key: 'messages', label: 'Mesajlar', webPath: '/mesajlar', mobileRoute: 'mesajlar', order: 30 }],
    widgets: ['mentions'],
  },
  task_approval: {
    id: 'task_approval',
    name: 'Görev onayı',
    description: 'Tamamlanan görevlerin onaylayıcı tarafından onaylanması veya düzeltme istenmesi.',
    core: false,
    dependsOn: ['tasks'],
    menu: [],
    widgets: ['awaiting_my_approval'],
  },
};

export const WIDGETS: Record<WidgetId, WidgetDef> = {
  my_today: { id: 'my_today', module: 'tasks', title: 'Bugünkü işlerim', description: 'Bugün ve öncesine tarihli açık görevleriniz.' },
  overdue: { id: 'overdue', module: 'tasks', title: 'Geciken işler', description: 'Son tarihi geçmiş, tamamlanmamış görevler.' },
  assigned_by_me: { id: 'assigned_by_me', module: 'tasks', title: 'Verdiğim işler', description: 'Başkalarına verdiğiniz açık görevler.' },
  team_summary: { id: 'team_summary', module: 'tasks', title: 'Ekip görev özeti', description: 'Kapsamınızdaki görevlerin durum dağılımı.', requires: 'tasks.view_all' },
  mentions: { id: 'mentions', module: 'messaging', title: 'Etiketlendiğim mesajlar', description: 'Sizi @etiketleyen son mesajlar.' },
  awaiting_my_approval: { id: 'awaiting_my_approval', module: 'task_approval', title: 'Onayımı bekleyenler', description: 'Onayınızı bekleyen tamamlanmış görevler.' },
};

/** Birden fazla modül gerektiren özellikler. */
export const FEATURES = {
  message_to_task: { label: 'Mesajdan göreve dönüştür', requires: ['messaging', 'tasks'] as ModuleId[] },
} as const;

export function isFeatureEnabled(feature: keyof typeof FEATURES, enabled: readonly ModuleId[]): boolean {
  return FEATURES[feature].requires.every((m) => m === 'core' || enabled.includes(m));
}

export function isModuleEnabled(id: ModuleId, enabled: readonly ModuleId[]): boolean {
  return id === 'core' || enabled.includes(id);
}

export type ToggleCheck =
  | { ok: true }
  | { ok: false; reason: 'core' | 'missing_dependencies' | 'has_dependents'; modules: ModuleId[] };

/** Veritabanındaki `set_module_enabled` ile aynı bağımlılık kuralları. */
export function checkModuleToggle(id: ModuleId, enable: boolean, enabled: readonly ModuleId[]): ToggleCheck {
  const def = MODULES[id];
  if (def.core) return { ok: false, reason: 'core', modules: [] };
  if (enable) {
    const missing = def.dependsOn.filter((d) => !isModuleEnabled(d, enabled));
    return missing.length ? { ok: false, reason: 'missing_dependencies', modules: missing } : { ok: true };
  }
  const dependents = (Object.values(MODULES) as ModuleDef[])
    .filter((m) => m.dependsOn.includes(id) && enabled.includes(m.id))
    .map((m) => m.id);
  return dependents.length ? { ok: false, reason: 'has_dependents', modules: dependents } : { ok: true };
}

/** Açık modüllerin menü öğeleri (izin filtresi çağıran tarafta uygulanır). */
export function menuFor(enabled: readonly ModuleId[]): MenuItem[] {
  return MODULE_IDS.filter((id) => isModuleEnabled(id, enabled))
    .flatMap((id) => MODULES[id].menu)
    .sort((a, b) => a.order - b.order);
}

/** Açık modüllerin bileşenleri. Kapalı modülün bileşeni asla dönmez. */
export function widgetsFor(enabled: readonly ModuleId[]): WidgetDef[] {
  return (Object.values(WIDGETS) as WidgetDef[]).filter((w) => isModuleEnabled(w.module, enabled));
}
