/**
 * Aşama 1 uçtan uca akış — GERÇEK Supabase (Auth + PostgREST + Realtime) gerektirir.
 * `pnpm db:start` çalışmıyorsa testler ATLANIR (başarılı sayılmaz).
 *
 * İki ayrı istemci kullanılır:
 *  - ownerWeb      : web panelindeki yönetici oturumu (oturum saklamaz, sunucu gibi)
 *  - employeeApp   : mobil uygulamadaki çalışan oturumu (kalıcı depolama taklidiyle;
 *                    "uygulama yeniden açıldı" senaryosu için aynı depoyla yeni istemci kurulur)
 */
import { randomUUID } from 'node:crypto';
import {
  acceptInvitation,
  createCompany,
  createGroup,
  createInvitation,
  createTask,
  fetchMyMemberships,
  fetchNotifications,
  fetchTask,
  fetchTasks,
  markTaskSeen,
  removeMember,
  setTaskStatus,
  subscribeCompanyChanges,
  type Client,
} from '@istakip/shared';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveSupabaseEnv } from '../src/supabase-env';

const env = resolveSupabaseEnv();
if (!env) {
  console.warn('\n[e2e] Çalışan Supabase bulunamadı (Docker + `pnpm db:start` gerekli). Uçtan uca testler ATLANDI.\n');
}

class MemoryStorage {
  private m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, v);
  removeItem = (k: string) => void this.m.delete(k);
}

const password = `Test-${randomUUID()}`;
const tag = randomUUID().slice(0, 8);

describe.skipIf(!env)('Aşama 1: webden atanan görev mobilde tamamlanır, webde güncellenir', () => {
  // describe gövdesi atlansa da toplanır; istemciler yalnızca beforeAll içinde kurulur.
  const e = env ?? { url: '', publishableKey: '', secretKey: '' };
  let admin: Client;
  const deviceStorage = new MemoryStorage();
  let ownerWeb: Client;
  let employeeApp: Client;
  let outsider: Client;
  let companyId: string;
  let employeeId: string;
  let ownerId: string;
  let taskId: string;
  const created: string[] = [];

  const newClient = (storage?: MemoryStorage) =>
    createClient(e.url, e.publishableKey, {
      auth: storage ? { storage, persistSession: true, autoRefreshToken: false } : { persistSession: false, autoRefreshToken: false },
    });

  async function makeUser(name: string, email: string) {
    const r = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
    if (r.error) throw r.error;
    created.push(r.data.user.id);
    return r.data.user.id;
  }

  beforeAll(async () => {
    admin = createClient(e.url, e.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    // Şirket sahibi web'den kayıt olur (gerçek Auth signUp; yerelde e-posta onayı kapalı)
    ownerWeb = newClient();
    const signUp = await ownerWeb.auth.signUp({ email: `e2e-sahip-${tag}@example.com`, password, options: { data: { full_name: 'E2E Sahip' } } });
    if (signUp.error) throw signUp.error;
    ownerId = signUp.data.user!.id;
    created.push(ownerId);
    companyId = await createCompany(ownerWeb, `E2E Şirket ${tag}`);
  });

  afterAll(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => undefined);
    await admin.from('companies').delete().eq('id', companyId);
  });

  it('yönetici davet oluşturur; çalışan davetle hesap açıp mobilde giriş yapar', async () => {
    const email = `e2e-calisan-${tag}@example.com`;
    const { token } = await createInvitation(ownerWeb, { companyId, email, role: 'employee' });
    // Web sunucusundaki davet akışı: Auth Admin API ile hesap açılır (yönetim anahtarı yalnızca sunucuda)
    employeeId = await makeUser('E2E Çalışan', email);
    employeeApp = newClient(deviceStorage);
    const login = await employeeApp.auth.signInWithPassword({ email, password });
    expect(login.error).toBeNull();
    expect(await acceptInvitation(employeeApp, token)).toBe(companyId);
    const memberships = await fetchMyMemberships(employeeApp, employeeId);
    expect(memberships.map((m) => m.company_id)).toContain(companyId);
  });

  it('webden grup kurulur ve görev atanır; mobilde görünür ve bildirim gelir', async () => {
    const groupId = await createGroup(ownerWeb, { companyId, name: `Saha ${tag}`, memberIds: [employeeId] });
    const task = await createTask(ownerWeb, {
      companyId,
      title: 'E2E: cihaz teslim formunu doldur',
      description: '',
      assigneeId: employeeId,
      contributorIds: [],
      dueDate: '2099-12-31',
      dueTime: null,
      priority: 'high',
      groupId,
      clientRequestId: randomUUID(),
      sourceMessageId: null,
    });
    taskId = task.id;
    const mine = await fetchTasks(employeeApp, companyId, { scope: 'mine', userId: employeeId });
    expect(mine.map((t) => t.id)).toContain(taskId);
    const notifs = await fetchNotifications(employeeApp, companyId);
    expect(notifs.some((n) => n.type === 'task_assigned' && n.entity_id === taskId)).toBe(true);
  });

  it('mobil uygulama kapatılıp açılınca oturum ve veri korunur', async () => {
    const reopened = newClient(deviceStorage); // aynı cihaz deposu, yeni süreç
    const { data } = await reopened.auth.getSession();
    expect(data.session?.user.id).toBe(employeeId);
    const mine = await fetchTasks(reopened, companyId, { scope: 'mine', userId: employeeId });
    expect(mine.map((t) => t.id)).toContain(taskId);
    employeeApp = reopened;
  });

  it('mobilde tamamlanan görev webde canlı (Realtime) ve sorguyla güncel görünür', async () => {
    const gotEvent = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Realtime olayı 15 sn içinde gelmedi')), 15_000);
      let unsubscribe = () => {};
      unsubscribe = subscribeCompanyChanges(ownerWeb, companyId, ownerId, {
        onTasks: () => {
          clearTimeout(timer);
          unsubscribe();
          resolve();
        },
        onLive: async (s) => {
          if (s !== 'live') return;
          // Değişiklik akışı hazır → çalışan mobilde görevi açar ve tamamlar
          await markTaskSeen(employeeApp, taskId);
          await setTaskStatus(employeeApp, { taskId, status: 'done' });
        },
      });
    });
    await gotEvent;
    const detail = await fetchTask(ownerWeb, taskId);
    expect(detail?.task.status).toBe('done');
    expect(detail?.task.seen_at).not.toBeNull();
    expect(detail?.task.completed_at).not.toBeNull();
    const ownerNotifs = await fetchNotifications(ownerWeb, companyId);
    expect(ownerNotifs.some((n) => n.type === 'task_completed' && n.entity_id === taskId)).toBe(true);
  });

  it('başka şirketin kullanıcısı REST/RPC ile görevi göremez ve değiştiremez', async () => {
    const email = `e2e-yabanci-${tag}@example.com`;
    await makeUser('E2E Yabancı', email);
    outsider = newClient();
    await outsider.auth.signInWithPassword({ email, password });
    const { data } = await outsider.from('tasks').select('id').eq('id', taskId);
    expect(data).toEqual([]);
    await expect(setTaskStatus(outsider, { taskId, status: 'in_progress' })).rejects.toMatchObject({ code: 'not_found' });
    // İstemci rolünün tablolarda yazma yetkisi yok: doğrudan UPDATE PostgREST'te reddedilir
    const direct = await outsider.from('tasks').update({ status: 'new' }).eq('id', taskId).select();
    expect(direct.error?.code).toBe('42501');
    const after = await fetchTask(ownerWeb, taskId);
    expect(after?.task.status).toBe('done');
  });

  it('şirketten çıkarılan çalışanın mobil oturumu açık olsa da erişimi kesilir', async () => {
    await removeMember(ownerWeb, companyId, employeeId);
    const tasks = await employeeApp.from('tasks').select('id').eq('company_id', companyId);
    expect(tasks.data).toEqual([]);
    await expect(setTaskStatus(employeeApp, { taskId, status: 'in_progress' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('istemciye açık anahtarla yönetim işlemleri yapılamaz', async () => {
    const r = await employeeApp.auth.admin.listUsers();
    expect(r.error).not.toBeNull();
  });
});
