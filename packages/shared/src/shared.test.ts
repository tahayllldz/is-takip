import { describe, expect, it } from 'vitest';
import {
  addableWidgets,
  attachmentPath,
  attachmentProblem,
  checkModuleToggle,
  dueLabel,
  dueState,
  hasPermission,
  isFeatureEnabled,
  isOverdue,
  isTodayTask,
  localDateKey,
  layoutToSave,
  menuFor,
  moveItem,
  moveTo,
  overdueDays,
  resolveDashboard,
  safeStorageFileName,
  splitMentions,
  statusChangeSchema,
  taskCreateSchema,
  toAppError,
  widgetsFor,
  type TaskTiming,
} from './index';

const TZ = 'Asia/Famagusta';
const t = (o: Partial<TaskTiming>): TaskTiming => ({ status: 'new', due_at: null, due_all_day: false, completed_at: null, ...o });

describe('saat dilimi', () => {
  it('Famagusta kışın UTC+2, yazın UTC+3', () => {
    // 2026-01-15 22:30 UTC → Famagusta 16 Ocak 00:30 (UTC+2)
    expect(localDateKey('2026-01-15T22:30:00Z', TZ)).toBe('2026-01-16');
    // 2026-07-15 21:30 UTC → Famagusta 16 Temmuz 00:30 (UTC+3)
    expect(localDateKey('2026-07-15T21:30:00Z', TZ)).toBe('2026-07-16');
    // İstanbul kışın UTC+3: aynı an farklı gün olabilir
    expect(localDateKey('2026-01-15T21:30:00Z', 'Europe/Istanbul')).toBe('2026-01-16');
    expect(localDateKey('2026-01-15T21:30:00Z', TZ)).toBe('2026-01-15');
  });
});

describe('gecikme', () => {
  const now = new Date('2026-03-10T10:00:00Z');
  it('son tarihi geçmiş ve tamamlanmamış görev gecikmiştir', () => {
    expect(isOverdue(t({ due_at: '2026-03-09T21:59:59Z' }), now)).toBe(true);
    expect(isOverdue(t({ due_at: '2026-03-09T21:59:59Z', status: 'done', completed_at: '2026-03-10T09:00:00Z' }), now)).toBe(false);
    expect(isOverdue(t({ due_at: null }), now)).toBe(false);
    expect(isOverdue(t({ due_at: '2026-03-10T21:59:59Z' }), now)).toBe(false);
  });
  it('gecikme gün sayısı ve metni şirket saat dilimine göre', () => {
    const task = t({ due_at: '2026-03-07T21:59:59Z', due_all_day: true }); // 7 Mart gün sonu (Famagusta)
    expect(overdueDays(task, TZ, now)).toBe(3);
    expect(dueLabel(task, TZ, now)).toBe('3 gün gecikti');
    expect(dueState(task, TZ, now)).toBe('overdue');
  });
  it('bugün içinde saati geçen görev "Gecikti" olarak görünür', () => {
    const task = t({ due_at: '2026-03-10T07:00:00Z' });
    expect(dueLabel(task, TZ, now)).toBe('Gecikti (Bugün 09:00)');
  });
  it('gecikmeli tamamlanan görev ayrıca belirtilir', () => {
    const task = t({ status: 'done', due_at: '2026-03-08T21:59:59Z', due_all_day: true, completed_at: '2026-03-09T08:00:00Z' });
    expect(dueState(task, TZ, now)).toBe('done_late');
  });
  it('bugünkü işler: devam eden + bugün/öncesi tarihli açık görevler', () => {
    expect(isTodayTask(t({ status: 'in_progress' }), TZ, now)).toBe(true);
    expect(isTodayTask(t({ due_at: '2026-03-10T21:59:59Z' }), TZ, now)).toBe(true);
    expect(isTodayTask(t({ due_at: '2026-03-12T21:59:59Z' }), TZ, now)).toBe(false);
    expect(isTodayTask(t({ status: 'done', completed_at: 'x', due_at: '2026-03-09T21:59:59Z' }), TZ, now)).toBe(false);
  });
});

describe('modüller', () => {
  it('bağımlılık kuralları', () => {
    expect(checkModuleToggle('task_approval', true, ['messaging'])).toEqual({ ok: false, reason: 'missing_dependencies', modules: ['tasks'] });
    expect(checkModuleToggle('tasks', false, ['tasks', 'task_approval'])).toEqual({ ok: false, reason: 'has_dependents', modules: ['task_approval'] });
    expect(checkModuleToggle('tasks', false, ['tasks', 'messaging'])).toEqual({ ok: true });
    expect(checkModuleToggle('core', false, [])).toMatchObject({ ok: false, reason: 'core' });
  });
  it('kapalı modülün menüsü ve bileşenleri görünmez', () => {
    const menus = menuFor(['messaging']).map((m) => m.key);
    expect(menus).toContain('messages');
    expect(menus).not.toContain('tasks');
    expect(widgetsFor(['messaging']).map((w) => w.id)).toEqual(['mentions']);
    expect(widgetsFor(['tasks']).map((w) => w.id)).not.toContain('mentions');
  });
  it('menü iş akışı sırasında (modül sırasından bağımsız)', () => {
    expect(menuFor(['tasks', 'messaging']).map((m) => m.key)).toEqual([
      'home',
      'tasks',
      'messages',
      'team',
      'groups',
      'notifications',
      'settings',
    ]);
  });
  it('mesajdan göreve dönüştürme iki modül de açıkken çalışır', () => {
    expect(isFeatureEnabled('message_to_task', ['messaging'])).toBe(false);
    expect(isFeatureEnabled('message_to_task', ['messaging', 'tasks'])).toBe(true);
  });
});

describe('izinler (arayüz kararları, veritabanı ile aynı mantık)', () => {
  const base = { scopeGroupIds: [] as string[], managedGroupIds: [] as string[] };
  const mods = { enabledModules: ['tasks' as const] };
  it('sahip her şeye, çalışan yalnızca taban izinlere sahip', () => {
    expect(hasPermission({ role: 'owner', adminScope: 'company', ...base }, 'modules.manage', mods)).toBe(true);
    expect(hasPermission({ role: 'employee', adminScope: 'company', ...base }, 'tasks.create', mods)).toBe(true);
    expect(hasPermission({ role: 'employee', adminScope: 'company', ...base }, 'tasks.assign', mods)).toBe(false);
  });
  it('kapsamlı yönetici yalnızca kapsam grubunda ve grup izinlerinde', () => {
    const m = { role: 'admin' as const, adminScope: 'groups' as const, scopeGroupIds: ['g1'], managedGroupIds: [] };
    expect(hasPermission(m, 'tasks.assign', { ...mods, groupId: 'g1' })).toBe(true);
    expect(hasPermission(m, 'tasks.assign', { ...mods, groupId: 'g2' })).toBe(false);
    expect(hasPermission(m, 'tasks.assign', mods)).toBe(false);
    expect(hasPermission(m, 'members.invite', mods)).toBe(false);
    expect(hasPermission(m, 'tasks.create', mods)).toBe(true);
  });
  it('grup yöneticisi kendi grubunu yönetir', () => {
    const m = { role: 'employee' as const, adminScope: 'company' as const, scopeGroupIds: [], managedGroupIds: ['g1'] };
    expect(hasPermission(m, 'groups.manage', { ...mods, groupId: 'g1' })).toBe(true);
    expect(hasPermission(m, 'groups.manage', { ...mods, groupId: 'g2' })).toBe(false);
  });
  it('modül kapalıysa modül izni yok', () => {
    expect(hasPermission({ role: 'owner', adminScope: 'company', ...base }, 'tasks.assign', { enabledModules: [] })).toBe(false);
  });
});

describe('doğrulama şemaları', () => {
  const id = '6f1c2b8e-3a4d-4c5e-9f60-7a8b9c0d1e2f';
  it('beklemeye alırken neden zorunlu', () => {
    expect(statusChangeSchema.safeParse({ taskId: id, status: 'on_hold' }).success).toBe(false);
    expect(statusChangeSchema.safeParse({ taskId: id, status: 'on_hold', reason: 'Parça bekleniyor' }).success).toBe(true);
  });
  it('saat için tarih zorunlu, sorumlu katkıda bulunan olamaz', () => {
    const base = { companyId: id, title: 'X', assigneeId: id, clientRequestId: id };
    expect(taskCreateSchema.safeParse({ ...base, dueTime: '10:00' }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ ...base, contributorIds: [id] }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ ...base, dueDate: '2026-10-12', dueTime: '10:00' }).success).toBe(true);
  });
});

describe('hata eşleme', () => {
  it('veritabanı kodu ve ağ hataları Türkçe mesaja dönüşür', () => {
    expect(toAppError({ message: 'Bu işlem için yetkiniz yok.', hint: 'forbidden' }).code).toBe('forbidden');
    expect(toAppError({ code: '42501', message: 'permission denied' }).message).toBe('Bu işlem için yetkiniz yok.');
    expect(toAppError(new TypeError('Failed to fetch')).code).toBe('network');
    expect(toAppError({ message: 'garip' }).code).toBe('unknown');
    // Ağ geçidi ayakta, arkadaki servis kapalı (bakım/yeniden başlama)
    expect(toAppError({ message: 'An invalid response was received from the upstream server' }).message).toMatch(/ulaşılamıyor/);
    expect(toAppError({ message: 'x' }, 503).code).toBe('network');
    // Veritabanı iş kuralı hatası (400) sunucu kesintisi sayılmaz
    expect(toAppError({ message: 'Mesaj en fazla 4000 karakter olabilir.', hint: 'invalid' }, 400).code).toBe('invalid');
  });
});

describe('mesaj ekleri ve etiketler', () => {
  const uuid = '6f1c2b8e-3a4d-4c5e-9f60-7a8b9c0d1e2f';
  // Veritabanındaki private.attachment_path_conversation ile aynı biçim
  const DB_PATH = new RegExp('^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]{1,200}$');

  it('Storage dosya adı ASCII’ye çevrilir, uzantı korunur', () => {
    expect(safeStorageFileName('Servis Formu (İmzalı) Şubat.PDF')).toBe('Servis-Formu-Imzali-Subat.pdf');
    expect(safeStorageFileName('çğüöş.jpg')).toBe('cguos.jpg');
    expect(safeStorageFileName('../../etc/passwd')).not.toContain('/');
    expect(safeStorageFileName('')).toBe('dosya');
    expect(attachmentPath(uuid, uuid, uuid.toUpperCase(), 'Rapor ğ.xlsx')).toMatch(DB_PATH);
  });

  it('boyut ve tür sınırı', () => {
    expect(attachmentProblem({ size: 11 * 1024 * 1024, type: 'application/pdf' })).toMatch(/10 MB/);
    expect(attachmentProblem({ size: 100, type: 'application/x-msdownload' })).toMatch(/desteklenmiyor/);
    expect(attachmentProblem({ size: 100, type: 'image/jpeg' })).toBeNull();
  });

  it('yalnızca gerçekten etiketlenen kişiler vurgulanır', () => {
    const parts = splitMentions('@Ayşe Demo ve @Mehmet bakar mısınız? @Can', [
      { id: 'a', name: 'Ayşe Demo' },
      { id: 'm', name: 'Mehmet' },
    ]);
    expect(parts.filter((p) => p.userId).map((p) => p.userId)).toEqual(['a', 'm']);
    expect(parts.map((p) => p.text).join('')).toBe('@Ayşe Demo ve @Mehmet bakar mısınız? @Can');
  });
});

describe('ana sayfa düzeni', () => {
  const all = (): boolean => true;
  const noTeam = (w: { requires?: string }) => !w.requires;
  const mods = ['tasks', 'messaging', 'task_approval'] as const;

  it('kişisel düzen → rol varsayılanı → yerleşik sırasıyla çözülür', () => {
    expect(resolveDashboard({ personal: ['mentions', 'my_today'], roleDefault: ['overdue'], role: 'employee', platform: 'web', enabledModules: [...mods], canUse: all })).toMatchObject({
      widgets: ['mentions', 'my_today'],
      source: 'personal',
    });
    expect(resolveDashboard({ personal: null, roleDefault: ['overdue'], role: 'employee', platform: 'web', enabledModules: [...mods], canUse: all }).source).toBe('role_default');
    const b = resolveDashboard({ personal: null, roleDefault: null, role: 'employee', platform: 'mobile', enabledModules: [...mods], canUse: all });
    expect(b.source).toBe('builtin');
    expect(b.widgets[0]).toBe('my_today');
  });

  it('kapalı modülün bileşeni gizlenir ama kaydedilecek listede kalır; bilinmeyen ve tekrar eden kimlikler atılır', () => {
    const r = resolveDashboard({ personal: ['mentions', 'my_today', 'yok', 'my_today'], roleDefault: null, role: 'employee', platform: 'web', enabledModules: ['tasks'], canUse: all });
    expect(r.widgets).toEqual(['my_today']);
    expect(r.hidden).toEqual(['mentions']);
    expect(layoutToSave(['my_today'], r.hidden)).toEqual(['my_today', 'mentions']);
  });

  it('izin gerektiren bileşen izni olmayana gösterilmez ve eklenebilecekler arasında çıkmaz', () => {
    const r = resolveDashboard({ personal: ['team_summary', 'my_today'], roleDefault: null, role: 'employee', platform: 'web', enabledModules: [...mods], canUse: noTeam });
    expect(r.widgets).toEqual(['my_today']);
    expect(addableWidgets(r.widgets, [...mods], noTeam).map((w) => w.id)).not.toContain('team_summary');
    expect(addableWidgets(r.widgets, ['tasks'], all).map((w) => w.id)).not.toContain('mentions');
  });

  it('yukarı/aşağı ve sürükle-bırak taşıma', () => {
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveTo(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
  });
});
