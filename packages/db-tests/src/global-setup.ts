/**
 * Veritabanı testleri için tek seferlik kurulum.
 *
 * 1) TEST_DATABASE_URL verilmişse o veritabanı kullanılır (örn. `supabase start`
 *    ile gelen yerel Supabase Postgres'i; migration'lar `supabase db reset` ile
 *    zaten uygulanmış olmalıdır).
 * 2) Verilmemişse Docker gerektirmeyen yerel bir Postgres 17 başlatılır,
 *    Supabase taklit katmanı (YALNIZCA TEST) ve migration'lar uygulanır.
 */
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { startLocalPostgres } from './local-postgres';
import { applyMigrations, applyShim } from './migrations';

declare module 'vitest' {
  export interface ProvidedContext {
    dbUrl: string;
    dbMode: 'external' | 'embedded';
  }
}

export default async function setup(project: TestProject) {
  const external = process.env.TEST_DATABASE_URL;
  if (external) {
    project.provide('dbUrl', external);
    project.provide('dbMode', 'external');
    return;
  }

  const server = await startLocalPostgres();
  const admin = new pg.Client({ connectionString: server.url() });
  await admin.connect();
  await admin.query('create database istakip_test');
  await admin.end();

  const url = server.url('istakip_test');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await applyShim(client);
    await applyMigrations(client);
  } catch (e) {
    await client.end();
    await server.stop();
    throw e;
  }
  await client.end();

  project.provide('dbUrl', url);
  project.provide('dbMode', 'embedded');

  return async () => {
    await server.stop();
  };
}
