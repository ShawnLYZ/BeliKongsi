import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { systemCaller } from '@/server/platform/caller';
import { withIdempotency } from '@/server/platform/idempotency';
import { parsePage, toPage } from '@/server/platform/pagination';
import { enforceRateLimit } from '@/server/platform/rate-limit';
import { withTransaction } from '@/server/platform/tx';
import { createTestDeps } from './helpers/app';

async function exec(url: string, sql: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

let t: Awaited<ReturnType<typeof createTestDeps>>;
const sys = systemCaller('test');

beforeEach(async () => {
  t = await createTestDeps();
});
afterEach(async () => {
  await t.close();
});

describe('platform', () => {
  it('reads the demo clock once per transaction', async () => {
    await exec(t.db.adminUrl, 'update demo_settings set clock_offset_ms = 3600000');
    const now = await withTransaction(t.deps, systemCaller('test'), async (ctx) =>
      ctx.now.toISOString(),
    );
    expect(now).toBe('2026-11-01T23:05:00.000Z');
  });

  it('joins an outer transaction and rolls back together', async () => {
    await expect(
      withTransaction(t.deps, sys, async (outer) => {
        await outer.tx.rateLimitHit.create({ data: { bucket: 'a', at: outer.now } });
        await withTransaction(t.deps, sys, async (inner) => {
          await inner.tx.rateLimitHit.create({ data: { bucket: 'b', at: inner.now } });
          throw new Error('boom');
        });
      }),
    ).rejects.toThrow('boom');
    expect(await t.deps.prisma.rateLimitHit.count()).toBe(0);
  });

  it('starts its own transaction when detached work runs after the outer one committed', async () => {
    let release!: () => void;
    const committed = new Promise<void>((res) => (release = res));
    let detached!: Promise<number>;
    await withTransaction(t.deps, sys, async (outer) => {
      await outer.tx.rateLimitHit.create({ data: { bucket: 'outer', at: outer.now } });
      detached = committed.then(() =>
        withTransaction(t.deps, sys, async (late) => {
          await late.tx.rateLimitHit.create({ data: { bucket: 'late', at: late.now } });
          return late.tx.rateLimitHit.count();
        }),
      );
    });
    release();
    expect(await detached).toBe(2);
    expect(await t.deps.prisma.rateLimitHit.count()).toBe(2);
  });

  it('retries a serialization failure once and succeeds', async () => {
    let calls = 0;
    const result = await withTransaction(t.deps, sys, async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('serialization'), { code: '40001' });
      return 'done';
    });
    expect(result).toBe('done');
    expect(calls).toBe(2);
  });

  it('replays the first response for a repeated idempotency key', async () => {
    let n = 0;
    const run = () =>
      withIdempotency(t.deps, 'u1:POST:/x', 'k1', async () => ({
        status: 200,
        body: { n: ++n },
      }));
    expect((await run()).body).toEqual({ n: 1 });
    expect((await run()).body).toEqual({ n: 1 });
  });

  it('runs a slow request once when the same key arrives concurrently', async () => {
    let runs = 0;
    const slow = () =>
      withIdempotency(t.deps, 'u1:POST:/slow', 'k2', async () => {
        runs++;
        await new Promise((r) => setTimeout(r, 300));
        return { status: 201, body: { ok: true } };
      });
    const results = await Promise.allSettled([slow(), slow()]);
    expect(runs).toBe(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { status: 409, code: 'REQUEST_IN_PROGRESS' },
    });
    expect((await slow()).body).toEqual({ ok: true });
    expect(runs).toBe(1);
  });

  it('lets a key be reused after its request failed', async () => {
    await expect(
      withIdempotency(t.deps, 'u1:POST:/y', 'k3', async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    const again = await withIdempotency(t.deps, 'u1:POST:/y', 'k3', async () => ({
      status: 200,
      body: { ok: 1 },
    }));
    expect(again.body).toEqual({ ok: 1 });
  });

  it('rate-limits after the limit', async () => {
    for (let i = 0; i < 3; i++) await enforceRateLimit(t.deps, 'ai:shop1', 3, 3600_000);
    await expect(enforceRateLimit(t.deps, 'ai:shop1', 3, 3600_000)).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    });
  });

  it('clamps page size and returns a next cursor', () => {
    expect(parsePage(new URLSearchParams('limit=500'))).toEqual({ cursor: null, limit: 100 });
    expect(toPage([1, 2, 3], 2, String)).toEqual({ items: [1, 2], nextCursor: '2' });
  });
});
