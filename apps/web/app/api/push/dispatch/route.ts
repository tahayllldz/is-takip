/**
 * Push gönderici uç noktası (sunucudan sunucuya). Kuyruktaki doğrulanmış bildirimleri alır,
 * Expo push servisine GENEL metinle gönderir ve sonucu kaydeder.
 *
 * Çağıran: Supabase Database Webhook (push_outbox INSERT), zamanlanmış görev veya yerelde
 * `pnpm push:dispatch`. `Authorization: Bearer <PUSH_DISPATCH_SECRET>` zorunlu.
 * Yönetim anahtarı yalnızca bu sunucu kodunda kullanılır (createAdminClient, server-only).
 */
import { timingSafeEqual } from 'node:crypto';
import { dispatchPush, expoSender, type PushJob } from '@istakip/shared';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

function authorized(header: string | null): boolean {
  const secret = process.env.PUSH_DISPATCH_SECRET ?? '';
  if (secret.length < 24 || !header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request.headers.get('authorization'))) {
    return Response.json({ error: 'Yetkisiz' }, { status: 401 });
  }
  const admin = createAdminClient();
  try {
    const summary = await dispatchPush(
      {
        claim: async (limit) => {
          const { data, error } = await admin.rpc('push_claim_batch', { p_limit: limit });
          if (error) throw new Error(error.message);
          return (data ?? []) as PushJob[];
        },
        complete: async ({ outboxId, status, error, tickets, invalidTokens }) => {
          const res = await admin.rpc('push_complete', {
            p_outbox_id: outboxId,
            p_status: status,
            p_error: error ?? null,
            p_tickets: tickets ?? null,
            p_invalid_tokens: invalidTokens ?? [],
          });
          if (res.error) throw new Error(res.error.message);
        },
        send: expoSender(fetch, process.env.EXPO_ACCESS_TOKEN || undefined),
      },
      100,
    );
    return Response.json(summary);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Gönderim hatası' }, { status: 500 });
  }
}
