/**
 * Push bildirimi gönderici mantığı (sunucuda çalışır; istemciye yönetim anahtarı verilmez).
 *
 * Kilit ekranı gizliliği: push yalnızca GENEL bir metin taşır ("Size yeni bir görev verildi").
 * Görev başlığı, mesaj metni, kişi veya şirket adı gönderilmez. Bildirime dokununca uygulama
 * kaydı kimliğiyle açar ve ayrıntıyı RLS'li sorguyla çeker.
 */

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const PUSH_TITLE = 'İş Takip';
const EXPO_CHUNK = 100;

const GENERIC_BODY: Record<string, string> = {
  task_assigned: 'Size yeni bir görev verildi',
  task_contributor_added: 'Bir göreve eklendiniz',
  task_updated: 'Görevinizde değişiklik var',
  task_status_changed: 'Bir görevin durumu değişti',
  task_completed: 'Bir görev tamamlandı',
  task_accepted: 'Bir görev üstlenildi',
  task_comment: 'Bir göreve yorum yazıldı',
  task_mention: 'Bir görevde etiketlendiniz',
  task_approval_requested: 'Onayınızı bekleyen bir görev var',
  task_approved: 'Göreviniz onaylandı',
  task_changes_requested: 'Görevinizde düzeltme istendi',
  message_mention: 'Bir mesajda etiketlendiniz',
  message_converted: 'Mesajınız göreve dönüştürüldü',
  group_added: 'Bir gruba eklendiniz',
};

export function genericPushBody(type: string): string {
  return GENERIC_BODY[type] ?? 'Yeni bir bildiriminiz var';
}

/** push_claim_batch satırı */
export interface PushJob {
  outbox_id: number;
  notification_id: string;
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  data: Record<string, unknown> | null;
  tokens: string[];
}

/** Uygulamanın bildirime dokununca kullandığı veri (yalnızca kimlikler; içerik yok) */
export interface PushData {
  notificationId: string;
  entityType: string | null;
  entityId: string | null;
  conversationId?: string;
}

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  priority: 'high';
  channelId: string;
  data: PushData;
}

export function buildPushMessage(token: string, job: PushJob): ExpoPushMessage {
  const conversationId = typeof job.data?.conversation_id === 'string' ? job.data.conversation_id : undefined;
  return {
    to: token,
    title: PUSH_TITLE,
    body: genericPushBody(job.type),
    sound: 'default',
    priority: 'high',
    channelId: 'default',
    data: {
      notificationId: job.notification_id,
      entityType: job.entity_type,
      entityId: job.entity_id,
      ...(conversationId ? { conversationId } : {}),
    },
  };
}

export type ExpoTicket = { status: 'ok'; id: string } | { status: 'error'; message?: string; details?: { error?: string } };

export interface DispatchDeps {
  claim: (limit: number) => Promise<PushJob[]>;
  complete: (input: { outboxId: number; status: 'sent' | 'failed' | 'pending' | 'skipped'; error?: string | null; tickets?: unknown; invalidTokens?: string[] }) => Promise<void>;
  /** Expo'ya en fazla 100 mesaj gönderir; HTTP/ağ hatasında hata fırlatır. */
  send: (messages: ExpoPushMessage[]) => Promise<ExpoTicket[]>;
}

export interface DispatchSummary {
  claimed: number;
  sent: number;
  failed: number;
  retry: number;
  skipped: number;
}

export async function dispatchPush(deps: DispatchDeps, limit = 100): Promise<DispatchSummary> {
  const jobs = await deps.claim(limit);
  const summary: DispatchSummary = { claimed: jobs.length, sent: 0, failed: 0, retry: 0, skipped: 0 };
  if (jobs.length === 0) return summary;

  const items = jobs.flatMap((job) => job.tokens.map((token) => ({ job, message: buildPushMessage(token, job) })));
  const results = new Map<number, { tickets: ExpoTicket[]; transportError?: string }>();
  for (const job of jobs) results.set(job.outbox_id, { tickets: [] });

  for (let i = 0; i < items.length; i += EXPO_CHUNK) {
    const chunk = items.slice(i, i + EXPO_CHUNK);
    try {
      const tickets = await deps.send(chunk.map((c) => c.message));
      chunk.forEach((c, j) => results.get(c.job.outbox_id)!.tickets.push(tickets[j] ?? { status: 'error', message: 'Yanıt eksik' }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      for (const c of chunk) results.get(c.job.outbox_id)!.transportError = msg;
    }
  }

  for (const job of jobs) {
    const r = results.get(job.outbox_id)!;
    if (job.tokens.length === 0) {
      summary.skipped++;
      await deps.complete({ outboxId: job.outbox_id, status: 'skipped', error: 'etkin cihaz yok' });
      continue;
    }
    const ok = r.tickets.some((t) => t.status === 'ok');
    if (r.transportError && !ok) {
      // Hiçbir cihaza ulaşılamadı (ağ/servis hatası): sonra yeniden denenir (en fazla 5 deneme, veritabanında sınırlı).
      // En az bir cihaza ulaştıysa yeniden denenmez — aynı push'un ikinci kez gitmesindense bir cihazın kaçırması tercih edilir.
      summary.retry++;
      await deps.complete({ outboxId: job.outbox_id, status: 'pending', error: r.transportError });
      continue;
    }
    const tokensOfJob = job.tokens;
    const invalidTokens = r.tickets
      .map((t, k) => (t.status === 'error' && t.details?.error === 'DeviceNotRegistered' ? tokensOfJob[k] : null))
      .filter((t): t is string => Boolean(t));
    const firstError = r.tickets.find((t) => t.status === 'error') as { message?: string } | undefined;
    if (ok) summary.sent++;
    else summary.failed++;
    await deps.complete({
      outboxId: job.outbox_id,
      status: ok ? 'sent' : 'failed',
      error: ok ? null : (firstError?.message ?? 'Expo hatası'),
      tickets: r.tickets,
      invalidTokens,
    });
  }
  return summary;
}

/** Expo push servisine gerçek gönderim (sunucu tarafı). accessToken: Expo hesabında "enhanced push security" açıksa gerekir. */
export function expoSender(fetchImpl: typeof fetch, accessToken?: string) {
  return async (messages: ExpoPushMessage[]): Promise<ExpoTicket[]> => {
    const res = await fetchImpl(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) throw new Error(`Expo push HTTP ${res.status}`);
    const json = (await res.json()) as { data?: ExpoTicket[]; errors?: { message?: string }[] };
    if (!Array.isArray(json.data)) throw new Error(json.errors?.[0]?.message ?? 'Expo yanıtı beklenmedik');
    return json.data;
  };
}
