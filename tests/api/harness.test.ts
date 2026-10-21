import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { callRoute } from './helpers/route';
import { createTestDatabase } from './helpers/db';
import { inject } from 'vitest';

async function query(url: string, sql: string): Promise<Record<string, unknown>[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(sql)).rows;
  } finally {
    await client.end();
  }
}

async function databaseExists(name: string): Promise<boolean> {
  const rows = await query(
    `${inject('pgAdminBase')}/postgres`,
    `select 1 from pg_database where datname = '${name}'`,
  );
  return rows.length > 0;
}

describe('test database harness', () => {
  it('gives each caller its own database cloned from the template', async () => {
    const a = await createTestDatabase();
    const b = await createTestDatabase();
    expect(a.name).not.toBe(b.name);
    expect(await query(a.adminUrl, 'select current_database() as db')).toEqual([{ db: a.name }]);
    await a.drop();
    await b.drop();
    expect(await databaseExists(a.name)).toBe(false);
  });

  it('clones four databases at the same moment without errors', async () => {
    const dbs = await Promise.all([1, 2, 3, 4].map(() => createTestDatabase()));
    expect(new Set(dbs.map((d) => d.name)).size).toBe(4);
    await Promise.all(dbs.map((d) => d.drop()));
  });

  it('lets the app role log in to a clone', async () => {
    const db = await createTestDatabase();
    try {
      expect(await query(db.appUrl, 'select current_user as u')).toEqual([{ u: 'bk_app' }]);
    } finally {
      await db.drop();
    }
  });
});

describe('route caller', () => {
  it('resolves dynamic route folders and passes params', async () => {
    const res = await callRoute('GET', '/echo/abc?x=1', { routesDir: 'tests/fixtures/routes' });
    expect(res).toMatchObject({ status: 200, body: { id: 'abc', x: '1' } });
  });

  it('returns 404 for unknown paths and 405 for missing methods', async () => {
    const opts = { routesDir: 'tests/fixtures/routes' };
    expect((await callRoute('GET', '/nope', opts)).status).toBe(404);
    expect((await callRoute('DELETE', '/echo/abc', opts)).status).toBe(405);
  });
});
