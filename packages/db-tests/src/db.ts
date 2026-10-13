/**
 * Test yardımcıları: kullanıcı oturumunu PostgREST'in yaptığı gibi taklit eder
 * (authenticated rolü + request.jwt.claims) ve RPC fonksiyonlarını çağırır.
 * Böylece RLS politikaları ve RPC yetki kontrolleri gerçek Postgres'te sınanır.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { expect } from 'vitest';

export interface TestUser {
  id: string;
  email: string;
  name: string;
}

function serialize(v: unknown): unknown {
  if (v === undefined) return null;
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}

export class TestDb {
  readonly pool: pg.Pool;

  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 4 });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Süper kullanıcı sorgusu — yalnızca test kurulumu/doğrulaması için. */
  async admin<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pool.query<T>(sql, params)).rows;
  }

  /** auth.users'a kullanıcı ekler (gerçekte Supabase Auth yapar). Profil tetikleyiciyle oluşur. */
  async createUser(name: string): Promise<TestUser> {
    const id = randomUUID();
    const local = name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'kullanici';
    const email = `${local}.${id.slice(0, 8)}@example.com`;
    await this.admin(
      'insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values ($1, $2, $3, now())',
      [id, email, JSON.stringify({ full_name: name })],
    );
    return { id, email, name };
  }

  /** Kullanıcı (veya null = anon) adına tek bir işlem (transaction) çalıştırır. */
  async as<T>(user: TestUser | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const claims = user ? { sub: user.id, role: 'authenticated', email: user.email } : { role: 'anon' };
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await client.query(user ? 'set local role authenticated' : 'set local role anon');
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** Kullanıcı adına SQL (ör. RLS'in neyi gösterdiğini görmek için SELECT). */
  async query<T extends pg.QueryResultRow = any>(user: TestUser | null, sql: string, params: unknown[] = []): Promise<T[]> {
    return this.as(user, async (c) => (await c.query<T>(sql, params)).rows);
  }

  /** RPC çağrısı (PostgREST /rpc/<fn> ile aynı: adlandırılmış argümanlar). Tüm satırları döner. */
  async rpc<T extends pg.QueryResultRow = any>(user: TestUser | null, fn: string, args: Record<string, unknown> = {}): Promise<T[]> {
    const keys = Object.keys(args);
    const sql = `select * from public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
    return this.query<T>(user, sql, keys.map((k) => serialize(args[k])));
  }

  async rpcOne<T extends pg.QueryResultRow = any>(user: TestUser | null, fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const rows = await this.rpc<T>(user, fn, args);
    return rows[0] as T;
  }

  /** Skaler dönen RPC (uuid, integer…) */
  async rpcValue<T = unknown>(user: TestUser | null, fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const row = await this.rpcOne(user, fn, args);
    return (row ? Object.values(row)[0] : undefined) as T;
  }

  // ---------------------------------------------------------------------
  // Senaryo kurucular (gerçek akışları kullanır: şirket oluştur, davet, kabul)
  // ---------------------------------------------------------------------

  async createCompany(owner: TestUser, name = 'Test Şirketi'): Promise<string> {
    return this.rpcValue<string>(owner, 'create_company', { p_name: `${name} ${randomUUID().slice(0, 6)}` });
  }

  /** Davet oluşturup kabul ettirerek üye ekler. */
  async invite(
    inviter: TestUser,
    companyId: string,
    user: TestUser,
    opts: { role?: 'admin' | 'employee'; adminScope?: 'company' | 'groups'; groupIds?: string[]; scopeGroupIds?: string[] } = {},
  ): Promise<void> {
    const inv = await this.rpcOne<{ invitation_id: string; token: string }>(inviter, 'create_invitation', {
      p_company: companyId,
      p_email: user.email,
      p_role: opts.role ?? 'employee',
      p_admin_scope: opts.adminScope ?? 'company',
      p_group_ids: opts.groupIds ?? [],
      p_scope_group_ids: opts.scopeGroupIds ?? [],
    });
    await this.rpcValue(user, 'accept_invitation', { p_token: inv.token });
  }

  async createGroup(actor: TestUser, companyId: string, name: string, members: TestUser[] = [], managers: TestUser[] = []): Promise<string> {
    return this.rpcValue<string>(actor, 'create_group', {
      p_company: companyId,
      p_name: name,
      p_member_ids: members.map((m) => m.id),
      p_manager_ids: managers.map((m) => m.id),
    });
  }

  async createTask(
    actor: TestUser,
    companyId: string,
    assignee: TestUser,
    extra: Record<string, unknown> = {},
  ): Promise<{ id: string; [k: string]: any }> {
    return this.rpcOne(actor, 'create_task', {
      p_company: companyId,
      p_title: (extra.p_title as string) ?? 'Test görevi',
      p_assignee: assignee.id,
      p_client_request_id: randomUUID(),
      ...extra,
    });
  }
}

/** Postgres hatasının makine kodunu (hint) veya SQLSTATE'ini doğrular. */
export async function expectDenied(promise: Promise<unknown>, expected: { hint?: string; code?: string; message?: RegExp }): Promise<void> {
  let err: (Error & { hint?: string; code?: string }) | undefined;
  try {
    await promise;
  } catch (e) {
    err = e as Error & { hint?: string; code?: string };
  }
  expect(err, 'işlem reddedilmeliydi ama başarılı oldu').toBeDefined();
  if (expected.hint) expect(err?.hint, `beklenen hata kodu ${expected.hint}, gelen: ${err?.message}`).toBe(expected.hint);
  if (expected.code) expect(err?.code, `beklenen SQLSTATE ${expected.code}, gelen: ${err?.message}`).toBe(expected.code);
  if (expected.message) expect(err?.message).toMatch(expected.message);
}

export const newId = () => randomUUID();
