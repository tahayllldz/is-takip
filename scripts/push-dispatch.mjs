/**
 * Yerel geliştirme: push kuyruğunu birkaç saniyede bir işler (web sunucusundaki /api/push/dispatch'i çağırır).
 * Üretimde bu iş Supabase Database Webhook (push_outbox INSERT) veya zamanlanmış görevle yapılır.
 * Kullanım: pnpm push:dispatch   (web sunucusu http://localhost:3000'de çalışırken)
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../apps/web/.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const secret = process.env.PUSH_DISPATCH_SECRET ?? env.PUSH_DISPATCH_SECRET;
const url = process.env.PUSH_DISPATCH_URL ?? 'http://localhost:3000/api/push/dispatch';
const every = Number(process.env.PUSH_DISPATCH_INTERVAL_MS ?? 5000);
if (!secret) {
  console.error('PUSH_DISPATCH_SECRET tanımlı değil (apps/web/.env.local).');
  process.exit(1);
}

async function tick() {
  try {
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${secret}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) console.error(new Date().toLocaleTimeString('tr-TR'), 'HATA', res.status, body.error ?? '');
    else if (body.claimed) console.log(new Date().toLocaleTimeString('tr-TR'), 'gönderildi:', body.sent, 'başarısız:', body.failed, 'tekrar:', body.retry, 'atlandı:', body.skipped);
  } catch (e) {
    console.error(new Date().toLocaleTimeString('tr-TR'), 'web sunucusuna ulaşılamadı:', e.message);
  }
}

console.log(`Push gönderici çalışıyor (${url}, ${every} ms). Durdurmak için Ctrl+C.`);
await tick();
setInterval(tick, every);
