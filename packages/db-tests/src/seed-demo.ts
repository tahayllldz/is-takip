/**
 * DEMO VERİSİ — yalnızca yerel geliştirme/sunum içindir.
 *
 * Tamamen sentetik kişiler ve görevlerle "is_demo" işaretli bir şirket kurar.
 * Gerçek şirket süreçlerini temsil etmez. Tüm kayıtlar gerçek Auth API'si ve
 * uygulamanın kendi RPC fonksiyonlarıyla oluşturulur (veritabanına doğrudan yazılmaz).
 *
 * Kullanım:  pnpm db:seed-demo        (yerel Supabase çalışırken)
 * Giriş:     demo.sahip@example.com / DEMO_PASSWORD (aşağıda; yalnızca yerel demo)
 */
import { randomUUID } from 'node:crypto';
import { addDays, format } from './seed-dates';
import { createClient } from '@supabase/supabase-js';
import {
  acceptInvitation,
  addTaskComment,
  createGroup,
  createInvitation,
  createTask,
  setTaskStatus,
  type Client,
} from '@istakip/shared';
import { resolveSupabaseEnv } from './supabase-env';

/** Yerel demo şifresi — üretimde kullanılmaz. */
export const DEMO_PASSWORD = 'Demo-Yerel-2026!';

const PEOPLE = [
  { key: 'sahip', name: 'Deniz Demo (Sahip)', email: 'demo.sahip@example.com' },
  { key: 'yonetici', name: 'Selin Demo (Yönetici)', email: 'demo.yonetici@example.com' },
  { key: 'ayse', name: 'Ayşe Demo', email: 'demo.ayse@example.com' },
  { key: 'mehmet', name: 'Mehmet Demo', email: 'demo.mehmet@example.com' },
  { key: 'elif', name: 'Elif Demo', email: 'demo.elif@example.com' },
  { key: 'can', name: 'Can Demo', email: 'demo.can@example.com' },
] as const;

type Key = (typeof PEOPLE)[number]['key'];

async function main() {
  const env = resolveSupabaseEnv();
  if (!env) {
    console.error('Çalışan Supabase bulunamadı. Önce `pnpm db:start` çalıştırın.');
    process.exit(1);
  }
  const admin = createClient(env.url, env.secretKey, { auth: { persistSession: false } });
  const clients = {} as Record<Key, Client>;
  const ids = {} as Record<Key, string>;

  for (const p of PEOPLE) {
    const created = await admin.auth.admin.createUser({
      email: p.email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: p.name },
    });
    if (created.error && !/already|exists/i.test(created.error.message)) throw created.error;
    const c = createClient(env.url, env.publishableKey, { auth: { persistSession: false } });
    const login = await c.auth.signInWithPassword({ email: p.email, password: DEMO_PASSWORD });
    if (login.error) throw new Error(`${p.email} giriş yapamadı: ${login.error.message}`);
    clients[p.key] = c;
    ids[p.key] = login.data.user.id;
  }

  const existing = await clients.sahip.from('companies').select('id').eq('is_demo', true).limit(1);
  if (existing.data?.length) {
    console.log('Demo şirketi zaten var; yeniden oluşturulmadı.');
    return;
  }

  const companyRes = await clients.sahip.rpc('create_company', { p_name: 'Örnek Medikal Ltd. (DEMO)', p_is_demo: true });
  if (companyRes.error) throw companyRes.error;
  const companyId = companyRes.data as string;

  const invite = async (k: Key, role: 'admin' | 'employee') => {
    const { token } = await createInvitation(clients.sahip, { companyId, email: PEOPLE.find((p) => p.key === k)!.email, role });
    await acceptInvitation(clients[k], token);
  };
  await invite('yonetici', 'admin');
  for (const k of ['ayse', 'mehmet', 'elif', 'can'] as const) await invite(k, 'employee');

  const servis = await createGroup(clients.sahip, { companyId, name: 'Teknik Servis', description: 'Kurulum ve bakım ekibi', memberIds: [ids.ayse, ids.mehmet, ids.yonetici], managerIds: [ids.mehmet] });
  const depo = await createGroup(clients.sahip, { companyId, name: 'Depo', description: 'Sevkiyat ve stok', memberIds: [ids.elif, ids.ayse] });
  await createGroup(clients.sahip, { companyId, name: 'Satış', memberIds: [ids.can, ids.elif] });

  const today = new Date();
  const d = (n: number) => format(addDays(today, n));
  const task = (by: Key, to: Key, title: string, extra: Partial<Parameters<typeof createTask>[1]> = {}) =>
    createTask(clients[by], {
      companyId,
      title,
      description: '',
      assigneeId: ids[to],
      contributorIds: [],
      dueDate: null,
      dueTime: null,
      priority: 'normal',
      groupId: null,
      clientRequestId: randomUUID(),
      sourceMessageId: null,
      ...extra,
    });

  const t1 = await task('sahip', 'ayse', 'Örnek cihaz kurulum formunu tamamla', { groupId: servis, dueDate: d(0), dueTime: '17:00', priority: 'high' });
  await task('sahip', 'mehmet', 'Haftalık bakım planını paylaş', { groupId: servis, dueDate: d(-2) });
  await task('yonetici', 'elif', 'Gelen sevkiyatı kontrol et', { groupId: depo, dueDate: d(1) });
  const t4 = await task('sahip', 'can', 'Örnek müşteri ziyaret notlarını yükle', { dueDate: d(-1), priority: 'urgent' });
  await task('sahip', 'elif', 'Depo raf etiketlerini yenile', { groupId: depo, dueDate: d(5), priority: 'low' });
  const t6 = await task('yonetici', 'ayse', 'Servis aracı kontrol listesi', { groupId: servis, dueDate: d(3) });

  await setTaskStatus(clients.ayse, { taskId: t1.id, status: 'in_progress' });
  await setTaskStatus(clients.can, { taskId: t4.id, status: 'on_hold', reason: 'Örnek: müşteriden onay bekleniyor' });
  await setTaskStatus(clients.ayse, { taskId: t6.id, status: 'done' });
  await addTaskComment(clients.sahip, { taskId: t1.id, body: 'Fotoğrafları da eklemeyi unutma.', mentionIds: [ids.ayse], clientRequestId: randomUUID() });

  console.log('Demo şirketi oluşturuldu: Örnek Medikal Ltd. (DEMO)');
  console.log('Giriş e-postaları: ' + PEOPLE.map((p) => p.email).join(', '));
  console.log('Demo şifresi için bkz. packages/db-tests/src/seed-demo.ts (DEMO_PASSWORD) — yalnızca yerel.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
