import { DEFAULT_TIMEZONE, localDateKey } from '@istakip/shared';

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** Şirket saat dilimine göre 'YYYY-MM-DD'. */
export function format(d: Date): string {
  return localDateKey(d, DEFAULT_TIMEZONE);
}
