import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '../../..');
export const migrationsDir = join(repoRoot, 'supabase', 'migrations');

export function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** Supabase taklit katmanını (yalnızca gömülü test Postgres'i için) yükler. */
export async function applyShim(client: pg.Client): Promise<void> {
  await client.query(readFileSync(join(here, 'supabase-shim.sql'), 'utf8'));
}

/** supabase/migrations içindeki dosyaları sırayla uygular (supabase CLI ile aynı sıra). */
export async function applyMigrations(client: pg.Client): Promise<string[]> {
  const applied: string[] = [];
  for (const file of migrationFiles()) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    try {
      await client.query(sql);
    } catch (e) {
      const err = e as Error & { position?: string };
      throw new Error(`Migration başarısız: ${file}\n${err.message}${err.position ? ` (konum ${err.position})` : ''}`);
    }
    applied.push(file);
  }
  return applied;
}
