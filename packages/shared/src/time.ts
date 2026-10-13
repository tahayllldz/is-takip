/**
 * Tarih/saat yardımcıları.
 *
 * Veritabanı tüm anları `timestamptz` (UTC) olarak saklar. Gösterim her zaman
 * şirketin saat diliminde yapılır (varsayılan Asia/Famagusta). Cihazın kendi saat
 * dilimi kullanılmaz: örneğin Türkiye (UTC+3 sabit) ile KKTC (kışın UTC+2) kış
 * aylarında bir saat farklıdır.
 *
 * Gün başlangıcı/bitişi gibi hesaplar veritabanında (şirket saat dilimiyle) yapılır;
 * burada yalnızca gösterim ve takvim günü karşılaştırması vardır.
 */

export const DEFAULT_TIMEZONE = 'Asia/Famagusta';
const LOCALE = 'tr-TR';

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = tz + JSON.stringify(opts);
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, { timeZone: tz, ...opts });
    formatters.set(key, f);
  }
  return f;
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Verilen anın şirket saat dilimindeki takvim günü: 'YYYY-MM-DD'. */
export function localDateKey(value: string | Date, tz: string = DEFAULT_TIMEZONE): string {
  const parts = formatter(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(toDate(value));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Verilen anın şirket saat dilimindeki saat:dakika değeri: 'HH:MM'. */
export function localTimeKey(value: string | Date, tz: string = DEFAULT_TIMEZONE): string {
  const parts = formatter(tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(toDate(value));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}

/** İki 'YYYY-MM-DD' günü arasındaki takvim günü farkı (b - a). */
export function dayDiff(a: string, b: string): number {
  const pa = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const pb = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((pb - pa) / 86_400_000);
}

export function formatDate(value: string | Date, tz: string = DEFAULT_TIMEZONE): string {
  return formatter(tz, { day: 'numeric', month: 'short', year: 'numeric' }).format(toDate(value));
}

export function formatDateTime(value: string | Date, tz: string = DEFAULT_TIMEZONE): string {
  return formatter(tz, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(toDate(value));
}

export function formatTime(value: string | Date, tz: string = DEFAULT_TIMEZONE): string {
  return localTimeKey(value, tz);
}

/** 'Bugün', 'Yarın', 'Dün' veya kısa tarih. */
export function formatDayRelative(value: string | Date, tz: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  const diff = dayDiff(localDateKey(now, tz), localDateKey(value, tz));
  if (diff === 0) return 'Bugün';
  if (diff === 1) return 'Yarın';
  if (diff === -1) return 'Dün';
  return formatter(tz, { day: 'numeric', month: 'short' }).format(toDate(value));
}

/** "5 dk önce", "3 sa önce", "2 gün önce" gibi kısa göreli zaman. */
export function formatAgo(value: string | Date, now: Date = new Date()): string {
  const sec = Math.max(0, Math.round((now.getTime() - toDate(value).getTime()) / 1000));
  if (sec < 60) return 'az önce';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} dk önce`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} sa önce`;
  const day = Math.round(hr / 24);
  return `${day} gün önce`;
}
