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

async function withDb(
  fn: (db: { adminUrl: string; appUrl: string }) => Promise<void>,
): Promise<void> {
  const db = await createTestDatabase();
  try {
    await fn(db);
  } finally {
    await db.drop();
  }
}

const insertRound = (id: string, status: string) =>
  `insert into rounds (id, product_id, supplier_id, hub_id, cycle_label, opens_at, cutoff_at, expected_ready_at, tiers_snapshot, fee_bps, buy_alone_price_sen, unit_weight_grams, unit_name, pack_description, status)
   values ('${id}', 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'w1', now(), now(), now(), '[]', 300, 1000, 500, 'carton', 'd', '${status}')`;

describe('database schema security', () => {
  it('enables row-level security with the app policy on every table', async () => {
    await withDb(async ({ adminUrl }) => {
      const rows = await query(
        adminUrl,
        `select c.relname, c.relrowsecurity, exists(select 1 from pg_policies p where p.tablename = c.relname and p.policyname = 'bk_app_all') as has_policy
         from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname <> '_prisma_migrations'`,
      );
      expect(rows.length).toBeGreaterThan(35);
      expect(rows.filter((r) => !r.relrowsecurity || !r.has_policy)).toEqual([]);
    });
  });

  it('lets anon and authenticated read nothing', async () => {
    await withDb(async ({ adminUrl }) => {
      const tables = (
        await query(
          adminUrl,
          "select tablename from pg_tables where schemaname = 'public' and tablename <> '_prisma_migrations'",
        )
      ).map((r) => r.tablename as string);
      expect(tables.length).toBeGreaterThan(35);
      for (const role of ['anon', 'authenticated']) {
        for (const table of tables) {
          await expect(exec(adminUrl, `set role ${role}; select * from ${table}`)).rejects.toThrow(
            /permission denied/,
          );
        }
      }
    });
  });

  it('keeps log entries and postings append-only for the app role', async () => {
    await withDb(async ({ appUrl }) => {
      const cases = [
        { table: 'activity_log_entries', column: 'seq' },
        { table: 'ledger_postings', column: 'id' },
      ];
      for (const { table, column } of cases) {
        await expect(exec(appUrl, `update ${table} set ${column} = ${column}`)).rejects.toThrow(
          /permission denied/,
        );
        await expect(exec(appUrl, `delete from ${table}`)).rejects.toThrow(/permission denied/);
      }
    });
  });

  it('stops even the owner changing log entries', async () => {
    await withDb(async ({ adminUrl }) => {
      await exec(
        adminUrl,
        `insert into activity_log_entries (seq, occurred_at, actor_type, operator_scope, action, subject_type, subject_id, prev_hash, hash) values (1, now(), 'system', true, 'x', 'x', 'x', repeat('0',64), repeat('a',64))`,
      );
      await expect(
        exec(adminUrl, 'update activity_log_entries set action = $$y$$ where seq = 1'),
      ).rejects.toThrow(/append-only/);
      await expect(
        exec(adminUrl, 'delete from activity_log_entries where seq = 1'),
      ).rejects.toThrow(/append-only/);
    });
  });

  it('allows only one open round per product', async () => {
    await withDb(async ({ adminUrl }) => {
      await exec(
        adminUrl,
        `insert into hubs (id, name, region, address, lat, lng) values ('a0000000-0000-0000-0000-000000000001', 'h', 'r', 'a', 0, 0);
         insert into suppliers (id, name, categories, region, hub_id, contact_name, contact_phone, status) values ('b0000000-0000-0000-0000-000000000001', 's', '{dairy}', 'r', 'a0000000-0000-0000-0000-000000000001', 'c', 'p', 'active');
         insert into products (id, supplier_id, name, short_name, category, pack_description, unit_name, unit_weight_grams, buy_alone_price_sen, aliases, pack_conversions, image_ai_generated, cadence, schedule_anchor_week, active)
           values ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'p', 'p', 'dairy', 'd', 'carton', 500, 1000, '{}', '{}', false, 'weekly', '2026-W44', true);
         ${insertRound('d0000000-0000-0000-0000-000000000001', 'open')};
         ${insertRound('d0000000-0000-0000-0000-000000000002', 'scheduled')};`,
      );
      await expect(
        exec(adminUrl, insertRound('d0000000-0000-0000-0000-000000000003', 'open')),
      ).rejects.toThrow(/unique/);
    });
  });

  it('refuses a negative shop balance', async () => {
    await withDb(async ({ appUrl }) => {
      await expect(
        exec(
          appUrl,
          `insert into ledger_accounts (id, key, kind, balance_sen) values (gen_random_uuid(), 'shop_balance:x', 'shop_balance', -1)`,
        ),
      ).rejects.toThrow(/check constraint/);
    });
  });

  it('lets the app role move the demo clock but not switch demo mode off', async () => {
    await withDb(async ({ appUrl }) => {
      await exec(appUrl, 'update demo_settings set clock_offset_ms = 5 where id = 1');
      await expect(
        exec(appUrl, 'update demo_settings set demo_mode = false where id = 1'),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it('resets demo data only while demo mode is on', async () => {
    await withDb(async ({ adminUrl, appUrl }) => {
      await exec(appUrl, 'select bk_demo_reset()');
      await exec(adminUrl, 'update demo_settings set demo_mode = false');
      await expect(exec(appUrl, 'select bk_demo_reset()')).rejects.toThrow(/demo mode is off/);
    });
  });
  it('stops the app role deleting or re-inserting the demo settings row', async () => {
    await withDb(async ({ appUrl }) => {
      await expect(exec(appUrl, 'delete from demo_settings')).rejects.toThrow(/permission denied/);
      await expect(
        exec(
          appUrl,
          "insert into demo_settings (id, demo_mode, clock_offset_ms, seed_version) values (2, false, 0, 'x')",
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it('keeps one row in each single-row table', async () => {
    await withDb(async ({ adminUrl }) => {
      await expect(
        exec(
          adminUrl,
          "insert into demo_settings (id, demo_mode, clock_offset_ms, seed_version) values (2, true, 0, 'x')",
        ),
      ).rejects.toThrow(/check constraint/);
      await expect(
        exec(
          adminUrl,
          "insert into activity_chain_head (id, last_seq, last_hash) values (2, 0, 'x')",
        ),
      ).rejects.toThrow(/check constraint/);
    });
  });

  it('wipes business data, restarts sequences and the chain, and keeps demo settings on reset', async () => {
    await withDb(async ({ adminUrl, appUrl }) => {
      const a = 'e0000000-0000-0000-0000-000000000001';
      const b = 'e0000000-0000-0000-0000-000000000002';
      const posting = `insert into ledger_postings (id, occurred_at, from_account_id, to_account_id, amount_sen, kind) values (gen_random_uuid(), now(), '${a}', '${b}', 100, 'payment_in')`;
      await exec(
        adminUrl,
        `insert into operators (id, name) values (gen_random_uuid(), 'op');
         insert into ledger_accounts (id, key, kind) values ('${a}', 'a', 'partner_cash'), ('${b}', 'b', 'fee_revenue');
         ${posting};
         insert into activity_log_entries (seq, occurred_at, actor_type, operator_scope, action, subject_type, subject_id, prev_hash, hash) values (1, now(), 'system', true, 'x', 'x', 'x', repeat('0',64), repeat('a',64));
         update activity_chain_head set last_seq = 5, last_hash = repeat('f', 64);
         update demo_settings set clock_offset_ms = 777;`,
      );
      expect(await query(adminUrl, 'select seq::int as seq from ledger_postings')).toEqual([
        { seq: 1 },
      ]);

      await exec(appUrl, 'select bk_demo_reset()');

      for (const table of [
        'operators',
        'ledger_accounts',
        'ledger_postings',
        'activity_log_entries',
      ]) {
        expect(await query(adminUrl, `select 1 from ${table}`)).toEqual([]);
      }
      expect(
        await query(adminUrl, 'select last_seq::int as s, last_hash from activity_chain_head'),
      ).toEqual([{ s: 0, last_hash: '0'.repeat(64) }]);
      expect(
        await query(adminUrl, 'select demo_mode, clock_offset_ms::int as c from demo_settings'),
      ).toEqual([{ demo_mode: true, c: 777 }]);

      await exec(
        adminUrl,
        `insert into ledger_accounts (id, key, kind) values ('${a}', 'a', 'partner_cash'), ('${b}', 'b', 'fee_revenue'); ${posting};`,
      );
      expect(await query(adminUrl, 'select seq::int as seq from ledger_postings')).toEqual([
        { seq: 1 },
      ]);
    });
  });
});
