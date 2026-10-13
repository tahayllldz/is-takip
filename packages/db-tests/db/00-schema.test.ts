/**
 * Şema güvenlik hijyeni: tüm tablolarda RLS açık mı, anonim erişim kapalı mı,
 * istemci rolünün yazma yetkisi var mı, yetki tablosu ortak paketle aynı mı.
 */
import { GROUP_MANAGER_PERMISSIONS, PERMISSIONS, ROLE_PERMISSIONS, ROLES } from '@istakip/shared';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { TestDb } from '../src/db';

let db: TestDb;
beforeAll(() => {
  db = new TestDb(inject('dbUrl'));
});
afterAll(() => db.close());

describe('şema hijyeni', () => {
  it('public şemasındaki tüm tablolarda RLS açık', async () => {
    const rows = await db.admin<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('anon rolünün hiçbir tabloda yetkisi yok', async () => {
    const rows = await db.admin(
      `select table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'anon'`,
    );
    expect(rows).toEqual([]);
  });

  it('authenticated rolü tablolara yazamaz (yalnızca SELECT)', async () => {
    const rows = await db.admin<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'authenticated' and privilege_type <> 'SELECT'`,
    );
    expect(rows).toEqual([]);
  });

  it('anon yalnızca davet sorgulama fonksiyonunu çağırabilir', async () => {
    const rows = await db.admin<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(rows.map((r) => r.proname)).toEqual(['get_invitation']);
  });

  it('SECURITY DEFINER fonksiyonların search_path değeri sabitlenmiş', async () => {
    const rows = await db.admin<{ name: string }>(
      `select n.nspname || '.' || p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.prosecdef
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    );
    expect(rows.map((r) => r.name)).toEqual([]);
  });

  it('yetki tablosu ortak paketteki tanımla birebir aynı', async () => {
    const perms = await db.admin<{ key: string; module_id: string; scope: string }>(
      'select key, module_id, scope from public.permissions order by key',
    );
    const shared = [...PERMISSIONS].map((p) => ({ key: p.key, module_id: p.module, scope: p.scope })).sort((a, b) => a.key.localeCompare(b.key));
    expect(perms).toEqual(shared);

    for (const role of ROLES) {
      const rows = await db.admin<{ permission: string }>(
        'select permission from public.role_permissions where role = $1 order by permission',
        [role],
      );
      expect(rows.map((r) => r.permission), `rol: ${role}`).toEqual([...ROLE_PERMISSIONS[role]].sort());
    }
    const gm = await db.admin<{ permission: string }>(
      `select permission from public.group_role_permissions where role = 'manager' order by permission`,
    );
    expect(gm.map((r) => r.permission)).toEqual([...GROUP_MANAGER_PERMISSIONS].sort());
  });
});
