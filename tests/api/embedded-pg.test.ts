import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { ensureDatabase, isPortListening, startCluster } from '../../scripts/lib/embedded-pg';

const dirs: string[] = [];
function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'bk-pg-'));
  dirs.push(d);
  return d;
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

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe('embedded postgres', () => {
  it('initialises a new cluster and accepts connections', async () => {
    const c = await startCluster({ dir: tmpDir(), port: 54390, password: 'postgres' });
    try {
      expect(await query(c.adminUrl('postgres'), 'select 1 as one')).toEqual([{ one: 1 }]);
    } finally {
      await c.stop();
    }
  }, 120_000);

  it('restarts after a crash left a stale postmaster.pid', async () => {
    const dir = tmpDir();
    const c1 = await startCluster({ dir, port: 54391, password: 'postgres' });
    await c1.stop();
    writeFileSync(join(dir, 'postmaster.pid'), '99999\n'); // what a crash leaves behind
    const c2 = await startCluster({ dir, port: 54391, password: 'postgres' });
    try {
      expect(await isPortListening(54391)).toBe(true);
    } finally {
      await c2.stop();
    }
  }, 120_000);

  it('ensureDatabase creates a database once and is idempotent', async () => {
    const c = await startCluster({ dir: tmpDir(), port: 54392, password: 'postgres' });
    try {
      await ensureDatabase(c.adminUrl(), 'belikongsi');
      await ensureDatabase(c.adminUrl(), 'belikongsi');
      const rows = await query(
        c.adminUrl(),
        "select count(*)::int as n from pg_database where datname = 'belikongsi'",
      );
      expect(rows).toEqual([{ n: 1 }]);
    } finally {
      await c.stop();
    }
  }, 120_000);

  it('sees an IPv6-only listener', async () => {
    const server = createServer();
    try {
      await new Promise<void>((res, rej) => {
        server.once('error', rej);
        server.listen(0, '::1', res);
      });
    } catch {
      return; // IPv6 loopback unavailable on this machine
    }
    try {
      const { port } = server.address() as { port: number };
      expect(await isPortListening(port)).toBe(true);
    } finally {
      server.close();
    }
  });
});
