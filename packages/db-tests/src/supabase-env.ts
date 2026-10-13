/**
 * Çalışan bir Supabase'in bağlantı bilgilerini bulur:
 * önce ortam değişkenleri (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY),
 * yoksa `supabase status -o env` (yerel yığın çalışıyorsa).
 */
import { execSync } from 'node:child_process';
import { repoRoot } from './migrations';

export interface SupabaseEnv {
  url: string;
  publishableKey: string;
  secretKey: string;
}

export function resolveSupabaseEnv(): SupabaseEnv | null {
  const fromEnv = {
    url: process.env.SUPABASE_URL ?? '',
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
    secretKey: process.env.SUPABASE_SECRET_KEY ?? '',
  };
  if (fromEnv.url && fromEnv.publishableKey && fromEnv.secretKey) return fromEnv;
  try {
    const out = execSync('pnpm exec supabase status -o env', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 }).toString();
    const vars = Object.fromEntries(
      out
        .split(/\r?\n/)
        .map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/))
        .filter((m): m is RegExpMatchArray => Boolean(m))
        .map((m) => [m[1], m[2]]),
    ) as Record<string, string>;
    const url = vars.API_URL ?? '';
    const publishableKey = vars.PUBLISHABLE_KEY ?? vars.ANON_KEY ?? '';
    const secretKey = vars.SECRET_KEY ?? vars.SERVICE_ROLE_KEY ?? '';
    return url && publishableKey && secretKey ? { url, publishableKey, secretKey } : null;
  } catch {
    return null;
  }
}
