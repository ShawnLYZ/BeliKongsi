import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { createTestDatabase } from './helpers/db';

async function exec(url: string, sql: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function query(url: string, sql: string): Promise<Record<string, unknown>[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(sql)).rows;
  } finally {
    await client.end();
  }
}

async function withDb(fn: (db: { adminUrl: string; appUrl: string }) => Promise<void>) {
  const db = await createTestDatabase();
  try {
    await fn(db);
  } finally {
    await db.drop();
  }
}

describe('security baseline', () => {
  it('creates the roles it needs', async () => {
    await withDb(async ({ adminUrl }) => {
      expect(
        await query(
          adminUrl,
          "select rolname from pg_roles where rolname in ('bk_app', 'anon', 'authenticated') order by rolname",
        ),
      ).toEqual([{ rolname: 'anon' }, { rolname: 'authenticated' }, { rolname: 'bk_app' }]);
    });
  });

  it('secures tables created by later migrations', async () => {
    await withDb(async ({ adminUrl }) => {
      await exec(
        adminUrl,
        'create table widgets (id int primary key); grant all on widgets to anon, authenticated; select bk_secure_all_tables();',
      );
      expect(
        await query(adminUrl, "select relrowsecurity from pg_class where relname = 'widgets'"),
      ).toEqual([{ relrowsecurity: true }]);
      await expect(exec(adminUrl, 'set role anon; select * from widgets')).rejects.toThrow(
        /permission denied/,
      );
      await expect(exec(adminUrl, 'set role authenticated; select * from widgets')).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it('lets the app role read, insert, update and delete ordinary tables', async () => {
    await withDb(async ({ adminUrl }) => {
      await exec(
        adminUrl,
        'create table widgets (id int primary key, name text); select bk_secure_all_tables();',
      );
      await exec(
        adminUrl,
        `set role bk_app;
         insert into widgets values (1, 'a');
         update widgets set name = 'b' where id = 1;
         select * from widgets;
         delete from widgets where id = 1;`,
      );
    });
  });

  it('makes the log and ledger tables append-only for the app role', async () => {
    await withDb(async ({ adminUrl }) => {
      await exec(
        adminUrl,
        `create table activity_log_entries (seq bigint primary key);
         create table ledger_postings (id int primary key);
         select bk_secure_all_tables();`,
      );
      const cases = [
        { table: 'activity_log_entries', column: 'seq' },
        { table: 'ledger_postings', column: 'id' },
      ];
      for (const { table, column } of cases) {
        await exec(adminUrl, `set role bk_app; insert into ${table} values (1)`);
        await expect(
          exec(adminUrl, `set role bk_app; update ${table} set ${column} = 2`),
        ).rejects.toThrow(/permission denied/);
        await expect(exec(adminUrl, `set role bk_app; delete from ${table}`)).rejects.toThrow(
          /permission denied/,
        );
        await expect(exec(adminUrl, `set role bk_app; truncate ${table}`)).rejects.toThrow(
          /permission denied/,
        );
      }
    });
  });

  it('never grants TRUNCATE to the app role', async () => {
    await withDb(async ({ adminUrl }) => {
      await exec(
        adminUrl,
        'create table widgets (id int primary key); select bk_secure_all_tables();',
      );
      expect(
        await query(
          adminUrl,
          "select count(*)::int as n from information_schema.table_privileges where grantee = 'bk_app' and privilege_type = 'SELECT'",
        ),
      ).not.toEqual([{ n: 0 }]);
      expect(
        await query(
          adminUrl,
          "select count(*)::int as n from information_schema.table_privileges where grantee = 'bk_app' and privilege_type = 'TRUNCATE'",
        ),
      ).toEqual([{ n: 0 }]);
    });
  });

  it('keeps functions out of reach of anon and authenticated', async () => {
    await withDb(async ({ adminUrl }) => {
      await exec(
        adminUrl,
        'create function later_fn() returns int language sql as $$ select 1 $$;',
      );
      for (const fn of ['bk_secure_all_tables()', 'later_fn()']) {
        for (const role of ['anon', 'authenticated']) {
          expect(
            await query(
              adminUrl,
              `select has_function_privilege('${role}', '${fn}', 'EXECUTE') as ok`,
            ),
          ).toEqual([{ ok: false }]);
        }
      }
    });
  });
});
