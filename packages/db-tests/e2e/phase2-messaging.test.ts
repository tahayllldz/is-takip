/**
 * Aşama 2 uçtan uca — GERÇEK Supabase (Auth + PostgREST + Realtime + Storage API).
 * `pnpm db:start` çalışmıyorsa testler ATLANIR (başarılı sayılmaz).
 *
 * Kişiler: sahip (web), Ayşe ve Mehmet (Teknik grubu), Can (aynı şirket, grup dışı), Yabancı (başka şirket).
 */
import { randomUUID } from 'node:crypto';
import {
  acceptInvitation,
  createCompany,
  createGroup,
  createInvitation,
  createTaskFromMessage,
  fetchConversationList,
  fetchMessages,
  fetchMessageTasks,
  fetchNotifications,
  getOrCreateDirectConversation,
  removeGroupMember,
  removePendingAttachment,
  sendMessage,
  signAttachmentUrls,
  subscribeCompanyChanges,
  uploadAttachment,
  ATTACHMENT_BUCKET,
  type Client,
} from '@istakip/shared';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveSupabaseEnv } from '../src/supabase-env';

const env = resolveSupabaseEnv();
const password = `Test-${randomUUID()}`;
const tag = randomUUID().slice(0, 8);
const PDF = new TextEncoder().encode('%PDF-1.4\n% İş Takip e2e deneme dosyası\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

describe.skipIf(!env)('Aşama 2: mesajlaşma, @etiket, dosyalar, mesajdan görev (gerçek Supabase)', () => {
  const e = env ?? { url: '', publishableKey: '', secretKey: '' };
  let admin: Client;
  let owner: Client, ayse: Client, mehmet: Client, can: Client, yabanci: Client;
  const ids: Record<string, string> = {};
  let companyId: string, otherCompanyId: string, groupId: string, groupConv: string;
  const users: string[] = [];

  const newClient = () => createClient(e.url, e.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });

  async function signUp(key: string, name: string): Promise<Client> {
    const email = `e2e2-${key}-${tag}@example.com`;
    const r = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
    if (r.error) throw r.error;
    ids[key] = r.data.user.id;
    users.push(r.data.user.id);
    const c = newClient();
    const login = await c.auth.signInWithPassword({ email, password });
    if (login.error) throw login.error;
    return c;
  }

  async function join(c: Client, key: string, company: string, inviter: Client) {
    const { data } = await admin.auth.admin.getUserById(ids[key]!);
    const { token } = await createInvitation(inviter, { companyId: company, email: data.user!.email!, role: 'employee' });
    await acceptInvitation(c, token);
  }

  beforeAll(async () => {
    admin = createClient(e.url, e.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    owner = await signUp('sahip', 'E2E Sahip');
    ayse = await signUp('ayse', 'E2E Ayşe');
    mehmet = await signUp('mehmet', 'E2E Mehmet');
    can = await signUp('can', 'E2E Can');
    yabanci = await signUp('yabanci', 'E2E Yabancı');
    companyId = await createCompany(owner, `E2E Mesaj ${tag}`);
    for (const [c, k] of [[ayse, 'ayse'], [mehmet, 'mehmet'], [can, 'can']] as const) await join(c, k, companyId, owner);
    otherCompanyId = await createCompany(yabanci, `E2E Başka ${tag}`);
    groupId = await createGroup(owner, { companyId, name: `Teknik ${tag}`, memberIds: [ids.ayse!, ids.mehmet!] });
    const list = await fetchConversationList(ayse, companyId);
    groupConv = list.find((x) => x.group_id === groupId)!.id;
  });

  afterAll(async () => {
    // Önce şirketler (mesaj/görev kayıtları kullanıcılara bağlı), sonra kullanıcılar
    for (const id of [companyId, otherCompanyId]) if (id) await admin.from('companies').delete().eq('id', id);
    for (const id of users) await admin.auth.admin.deleteUser(id).catch(() => undefined);
  });

  it('grup mesajı ve @etiket diğer üyeye canlı (Realtime) ulaşır; bildirim yalnızca etiketlenene gider', async () => {
    let messageId = '';
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Mesaj olayı 15 sn içinde gelmedi')), 15_000);
      let unsubscribe = () => {};
      unsubscribe = subscribeCompanyChanges(mehmet, companyId, ids.mehmet!, {
        onMessages: (conv) => {
          if (conv !== groupConv) return;
          clearTimeout(timer);
          unsubscribe();
          resolve();
        },
        onLive: async (s) => {
          if (s !== 'live') return;
          const m = await sendMessage(ayse, {
            conversationId: groupConv,
            body: '@E2E Mehmet kalibrasyon raporunu bugün yükler misin?',
            clientRequestId: randomUUID(),
            mentionIds: [ids.mehmet!],
          });
          messageId = m.id;
        },
      });
    });
    const msgs = await fetchMessages(mehmet, groupConv);
    expect(msgs.find((m) => m.id === messageId)?.mentions).toEqual([{ user_id: ids.mehmet }]);
    const mn = await fetchNotifications(mehmet, companyId);
    expect(mn.filter((n) => n.type === 'message_mention' && n.entity_id === messageId)).toHaveLength(1);
    const cn = await fetchNotifications(can, companyId);
    expect(cn.some((n) => n.entity_id === messageId)).toBe(false);
  });

  it('yeniden bağlanınca aynı mesaj tekrar gönderilse de tek kayıt oluşur', async () => {
    const clientRequestId = randomUUID();
    const input = { conversationId: groupConv, body: 'Bağlantı koptu, tekrar gönderiliyor', clientRequestId };
    const first = await sendMessage(ayse, input);
    // "Uygulama yeniden bağlandı": yeni istemci + aynı bekleyen mesajın tekrar gönderimi (eşzamanlı)
    const reconnected = newClient();
    await reconnected.auth.signInWithPassword({ email: `e2e2-ayse-${tag}@example.com`, password });
    const retries = await Promise.all([sendMessage(reconnected, input), sendMessage(reconnected, input), sendMessage(ayse, input)]);
    expect(new Set([first.id, ...retries.map((r) => r.id)]).size).toBe(1);
    const all = await fetchMessages(mehmet, groupConv);
    expect(all.filter((m) => m.client_request_id === clientRequestId)).toHaveLength(1);
  });

  it('dosya özel kovaya yüklenir; grup üyesi indirir, grup dışı ve başka şirket indiremez', async () => {
    const path = await uploadAttachment(ayse, {
      companyId,
      conversationId: groupConv,
      uploadId: randomUUID(),
      fileName: 'Servis Formu (İmzalı).pdf',
      body: PDF,
      contentType: 'application/pdf',
    });
    const m = await sendMessage(ayse, {
      conversationId: groupConv,
      body: 'Form ekte',
      clientRequestId: randomUUID(),
      attachments: [{ path, name: 'Servis Formu (İmzalı).pdf' }],
    });
    const att = (await fetchMessages(mehmet, groupConv)).find((x) => x.id === m.id)?.attachments[0];
    expect(att).toMatchObject({ file_name: 'Servis Formu (İmzalı).pdf', mime_type: 'application/pdf', size_bytes: PDF.byteLength });

    const urls = await signAttachmentUrls(mehmet, [path]);
    const res = await fetch(urls[path]!);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);

    for (const [who, c] of [['can', can], ['yabanci', yabanci]] as const) {
      expect(await signAttachmentUrls(c, [path]).catch(() => ({})), who).toEqual({});
      const dl = await c.storage.from(ATTACHMENT_BUCKET).download(path);
      expect(dl.error, who).not.toBeNull();
    }
    // Kova herkese açık değil: imzasız genel bağlantı çalışmaz
    const pub = await fetch(`${e.url}/storage/v1/object/public/${ATTACHMENT_BUCKET}/${path}`);
    expect(pub.status).toBeGreaterThanOrEqual(400);
  });

  it('grup dışı kişi grup sohbetine dosya yükleyemez; mesaja bağlı dosya silinemez, bekleyen yükleme silinebilir', async () => {
    await expect(
      uploadAttachment(can, { companyId, conversationId: groupConv, uploadId: randomUUID(), fileName: 'x.pdf', body: PDF, contentType: 'application/pdf' }),
    ).rejects.toBeTruthy();
    await expect(
      uploadAttachment(yabanci, { companyId, conversationId: groupConv, uploadId: randomUUID(), fileName: 'x.pdf', body: PDF, contentType: 'application/pdf' }),
    ).rejects.toBeTruthy();

    const linked = await uploadAttachment(ayse, { companyId, conversationId: groupConv, uploadId: randomUUID(), fileName: 'bagli.pdf', body: PDF, contentType: 'application/pdf' });
    await sendMessage(ayse, { conversationId: groupConv, body: '', clientRequestId: randomUUID(), attachments: [{ path: linked, name: 'bagli.pdf' }] });
    await removePendingAttachment(ayse, linked);
    expect((await mehmet.storage.from(ATTACHMENT_BUCKET).download(linked)).error).toBeNull();

    const pending = await uploadAttachment(ayse, { companyId, conversationId: groupConv, uploadId: randomUUID(), fileName: 'vazgecildi.pdf', body: PDF, contentType: 'application/pdf' });
    await removePendingAttachment(mehmet, pending); // başkasının bekleyen yüklemesi silinemez
    expect((await ayse.storage.from(ATTACHMENT_BUCKET).download(pending)).error).toBeNull();
    await removePendingAttachment(ayse, pending);
    expect((await ayse.storage.from(ATTACHMENT_BUCKET).download(pending)).error).not.toBeNull();
  });

  it('desteklenmeyen dosya türü kova tarafından reddedilir', async () => {
    await expect(
      uploadAttachment(ayse, {
        companyId,
        conversationId: groupConv,
        uploadId: randomUUID(),
        fileName: 'program.exe',
        body: new Uint8Array([77, 90]),
        contentType: 'application/x-msdownload',
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });

  it('mesaj göreve dönüştürülür; kaynak mesaja bağlanır, tekrar dönüştürme çoğaltmaz, mesaj sahibine bildirim gider', async () => {
    const m = await sendMessage(ayse, { conversationId: groupConv, body: 'Kuvöz 3 alarm veriyor', clientRequestId: randomUUID() });
    const input = { messageId: m.id, title: 'Kuvöz 3 alarm kontrolü', assigneeId: ids.mehmet!, clientRequestId: randomUUID() };
    const t1 = await createTaskFromMessage(mehmet, input);
    const t2 = await createTaskFromMessage(mehmet, { ...input, clientRequestId: randomUUID() });
    const t3 = await createTaskFromMessage(ayse, { ...input, assigneeId: ids.ayse!, clientRequestId: randomUUID() });
    expect(new Set([t1.id, t2.id, t3.id]).size).toBe(1);
    expect(t1).toMatchObject({ source_message_id: m.id, group_id: groupId, assignee_id: ids.mehmet });
    expect((await fetchMessageTasks(ayse, [m.id])).map((t) => t.id)).toEqual([t1.id]);
    const an = await fetchNotifications(ayse, companyId);
    expect(an.filter((n) => n.type === 'message_converted' && n.entity_id === t1.id)).toHaveLength(1);
  });

  it('birebir sohbet yalnızca iki kişiye görünür; başka şirket kullanıcısıyla açılamaz', async () => {
    const dm = await getOrCreateDirectConversation(ayse, companyId, ids.can!);
    expect(await getOrCreateDirectConversation(can, companyId, ids.ayse!)).toBe(dm);
    const m = await sendMessage(can, { conversationId: dm, body: 'Depo anahtarı bende', clientRequestId: randomUUID() });
    expect((await fetchMessages(ayse, dm)).map((x) => x.id)).toContain(m.id);
    expect(await fetchMessages(mehmet, dm)).toEqual([]);
    await expect(getOrCreateDirectConversation(ayse, companyId, ids.yabanci!)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('gruptan çıkarılan kişinin açık oturumu olsa da mesajlara ve dosyalara erişimi anında kesilir', async () => {
    const path = await uploadAttachment(ayse, { companyId, conversationId: groupConv, uploadId: randomUUID(), fileName: 'son.pdf', body: PDF, contentType: 'application/pdf' });
    await sendMessage(ayse, { conversationId: groupConv, body: 'Son dosya', clientRequestId: randomUUID(), attachments: [{ path, name: 'son.pdf' }] });
    expect((await fetchMessages(mehmet, groupConv)).length).toBeGreaterThan(0);

    await removeGroupMember(owner, groupId, ids.mehmet!);

    expect(await fetchMessages(mehmet, groupConv)).toEqual([]);
    expect((await mehmet.storage.from(ATTACHMENT_BUCKET).download(path)).error).not.toBeNull();
    await expect(sendMessage(mehmet, { conversationId: groupConv, body: 'hâlâ buradayım', clientRequestId: randomUUID() })).rejects.toMatchObject({
      code: 'not_found',
    });
    expect((await fetchConversationList(mehmet, companyId)).some((c) => c.id === groupConv)).toBe(false);
  });
});
