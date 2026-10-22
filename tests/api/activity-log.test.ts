import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedReferenceData } from '../../prisma/seed';
import { seedId } from '../../prisma/seed/ids';
import type { ActionCode } from '@/server/modules/activity/actions';
import { canonicalJson } from '@/server/modules/activity/canonical';
import { appendLog, verifyLogChain, type LogEntryInput } from '@/server/modules/activity/log';
import { queryLog, subjectTimeline } from '@/server/modules/activity/query';
import { personCaller, systemCaller } from '@/server/platform/caller';
import type { Session } from '@/server/platform/session';
import { withTransaction } from '@/server/platform/tx';
import { createTestDeps } from './helpers/app';
import { session } from './helpers/sessions';

const sys = systemCaller('test');
const KOPI = seedId('shop', 'KEDAI_KOPI');
const GERAI = seedId('shop', 'GERAI');
const SUP_DRY = seedId('supplier', 'SUP_DRY');

const ahSengSession = session('ahSeng', 'owner', { shopId: KOPI }, 'shop');
const rahimSession = session('rahim', 'staff', { shopId: KOPI }, 'shop');
const sitiSession = session('siti', 'owner', { shopId: GERAI }, 'shop');
const faridSession = session('farid', 'supplier', { supplierId: SUP_DRY }, 'supplier');
const nadiaSession = session('nadia', 'ops', { operatorId: seedId('operator', 'OPS') }, 'operator');

const e = (action: ActionCode, extra: Partial<LogEntryInput> = {}): LogEntryInput => ({
  action,
  subjectType: 'round',
  subjectId: 'r1',
  scope: {},
  ...extra,
});

async function adminExec(url: string, sql: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

let t: Awaited<ReturnType<typeof createTestDeps>>;
beforeEach(async () => {
  t = await createTestDeps();
});
afterEach(async () => {
  await t.close();
});

async function seed() {
  await withTransaction(t.deps, systemCaller('seed'), (ctx) =>
    seedReferenceData(ctx, { anchorMonday: new Date('2026-11-01T22:05:00Z') }),
  );
}
const as = (s: Session, entry: LogEntryInput) =>
  withTransaction(t.deps, personCaller(s), (ctx) => appendLog(ctx, entry));

describe('activity log', () => {
  it('chains each entry to the one before', async () => {
    await withTransaction(t.deps, sys, async (ctx) => {
      await appendLog(ctx, e('demo.reset'));
      await appendLog(ctx, e('round.opened'));
    });
    const [a, b] = await t.deps.prisma.activityLogEntry.findMany({ orderBy: { seq: 'asc' } });
    expect(a!.prevHash).toBe('0'.repeat(64));
    expect(b!.prevHash).toBe(a!.hash);
    expect(await verifyLogChain(t.deps.prisma)).toEqual({ valid: true, count: 2 });
  });

  it('keeps sequence numbers consecutive when eight transactions append at once', async () => {
    await Promise.all(
      Array.from({ length: 8 }, () =>
        withTransaction(t.deps, sys, async (ctx) => {
          const r = await appendLog(ctx, e('round.opened'));
          // Hold the head lock a moment so the others really queue behind it.
          await new Promise((res) => setTimeout(res, 30));
          return r;
        }),
      ),
    );
    const seqs = (await t.deps.prisma.activityLogEntry.findMany({ orderBy: { seq: 'asc' } })).map(
      (r) => Number(r.seq),
    );
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(await verifyLogChain(t.deps.prisma)).toEqual({ valid: true, count: 8 });
  });

  it('reports the first broken entry after tampering', async () => {
    await withTransaction(t.deps, sys, async (ctx) => {
      await appendLog(ctx, e('demo.reset'));
      await appendLog(ctx, e('round.opened', { reason: 'original' }));
      await appendLog(ctx, e('round.closed'));
    });
    await adminExec(
      t.db.adminUrl,
      `alter table activity_log_entries disable trigger user;
       update activity_log_entries set reason = 'x' where seq = 2;
       alter table activity_log_entries enable trigger user;`,
    );
    expect(await verifyLogChain(t.deps.prisma)).toEqual({ valid: false, firstBrokenSeq: '2' });
  });

  it('reports a deleted last entry', async () => {
    await withTransaction(t.deps, sys, async (ctx) => {
      await appendLog(ctx, e('demo.reset'));
      await appendLog(ctx, e('round.opened'));
      await appendLog(ctx, e('round.closed'));
    });
    await adminExec(
      t.db.adminUrl,
      `alter table activity_log_entries disable trigger user;
       delete from activity_log_entries where seq = 3;
       alter table activity_log_entries enable trigger user;`,
    );
    expect(await verifyLogChain(t.deps.prisma)).toEqual({ valid: false, firstBrokenSeq: '3' });
  });

  it('lists the newest entries about one subject, newest first, with a next page', async () => {
    await seed();
    await withTransaction(t.deps, sys, async (ctx) => {
      await appendLog(ctx, e('round.opened', { subjectId: 'a' }));
      await appendLog(ctx, e('round.closed', { subjectId: 'b' }));
      await appendLog(ctx, e('round.closed', { subjectId: 'a' }));
    });
    const caller = personCaller(nadiaSession);
    const first = await subjectTimeline(t.deps, caller, 'round', 'a', { limit: 1 });
    expect(first.items.map((i) => i.action)).toEqual(['round.closed']);
    const rest = await subjectTimeline(t.deps, caller, 'round', 'a', { cursor: first.nextCursor });
    expect(rest.items.map((i) => i.action)).toEqual(['round.opened']);
    expect(rest.nextCursor).toBeNull();
  });

  it('verifies entries that carry json, a scope and AI metadata', async () => {
    await withTransaction(t.deps, systemCaller('ai'), async (ctx) => {
      await appendLog(
        ctx,
        e('usual_list.ai_suggested', {
          scope: { shopId: KOPI },
          after: { zeta: 1, alpha: [{ b: 2, a: 1 }], nested: { amountSen: 5 } },
          aiMetadata: { model: 'm', lineCount: 3, averageConfidence: 0.8, suggestionRunId: 'run' },
        }),
      );
    });
    expect(await verifyLogChain(t.deps.prisma)).toEqual({ valid: true, count: 1 });
  });

  it('gives the same canonical form regardless of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2n, c: [1, { z: 1, y: 2 }] } })).toBe(
      '{"a":{"c":[1,{"y":2,"z":1}],"d":"2"},"b":1}',
    );
    expect(canonicalJson({ a: undefined, b: new Date('2026-01-01T00:00:00Z') })).toBe(
      '{"b":"2026-01-01T00:00:00.000Z"}',
    );
  });

  it('shows staff only their own entries, with amounts hidden', async () => {
    await seed();
    await as(
      rahimSession,
      e('refund.issued', {
        scope: { shopId: KOPI },
        reason: 'Full refund: RM 123.30',
        after: { amountSen: 12330, quantity: 1, detail: { totalSen: 5, note: 'ok' } },
      }),
    );
    await as(ahSengSession, e('basket.approved', { scope: { shopId: KOPI } }));
    const page = await queryLog(t.deps, personCaller(rahimSession), { cursor: null, limit: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      reason: 'Full refund: RM •••',
      after: { quantity: 1, detail: { note: 'ok' } },
      actorName: 'Rahim',
      actorRole: 'staff',
      actorType: 'person',
    });
    expect(page.items[0]!.after).not.toHaveProperty('amountSen');
    expect(page.items[0]!.after).not.toHaveProperty('detail.totalSen');
  });

  it("shows owners only their shop's entries and suppliers only their orders", async () => {
    await seed();
    await as(ahSengSession, e('basket.approved', { scope: { shopId: KOPI } }));
    await as(sitiSession, e('basket.approved', { scope: { shopId: GERAI } }));
    await as(faridSession, e('supplier_order.confirmed', { scope: { supplierId: SUP_DRY } }));
    await as(nadiaSession, e('supplier_order.approved', { scope: { operator: true } }));

    const q = (s: Session) => queryLog(t.deps, personCaller(s), { cursor: null, limit: 20 });
    expect((await q(ahSengSession)).items.map((i) => i.action)).toEqual(['basket.approved']);
    expect((await q(sitiSession)).items).toHaveLength(1);
    expect((await q(faridSession)).items.map((i) => i.action)).toEqual([
      'supplier_order.confirmed',
    ]);
    expect((await q(nadiaSession)).items).toHaveLength(4);
    const all = await queryLog(t.deps, sys, { cursor: null, limit: 20 });
    expect(all.items.map((i) => i.seq)).toEqual(['4', '3', '2', '1']);
  });

  it('hides every money format in staff reasons and text inside before and after', async () => {
    await seed();
    await as(
      rahimSession,
      e('refund.issued', {
        scope: { shopId: KOPI },
        reason: 'Paid RM 5, RM5.00 and RM 1,234.56',
        after: { note: 'Refunded RM 12.30', lines: ['RM 1.5 off', 'two cartons'] },
      }),
    );
    const page = await queryLog(t.deps, personCaller(rahimSession), { cursor: null, limit: 20 });
    expect(page.items[0]).toMatchObject({
      reason: 'Paid RM •••, RM ••• and RM •••',
      after: { note: 'Refunded RM •••', lines: ['RM ••• off', 'two cartons'] },
    });
    const owner = await queryLog(t.deps, personCaller(ahSengSession), { cursor: null, limit: 20 });
    expect(owner.items[0]!.reason).toBe('Paid RM 5, RM5.00 and RM 1,234.56');
  });

  it('pages newest first with a cursor and filters by subject', async () => {
    await withTransaction(t.deps, sys, async (ctx) => {
      await appendLog(ctx, e('round.opened', { subjectId: 'a' }));
      await appendLog(ctx, e('round.closed', { subjectId: 'b' }));
      await appendLog(ctx, e('round.closed', { subjectId: 'a' }));
    });
    const p1 = await queryLog(t.deps, sys, { cursor: null, limit: 2 });
    expect(p1.items.map((i) => i.seq)).toEqual(['3', '2']);
    expect(p1.nextCursor).toBe('2');
    const p2 = await queryLog(t.deps, sys, { cursor: p1.nextCursor, limit: 2 });
    expect(p2.items.map((i) => i.seq)).toEqual(['1']);
    expect(p2.nextCursor).toBeNull();
    const only = await queryLog(t.deps, sys, {
      subjectType: 'round',
      subjectId: 'a',
      cursor: null,
      limit: 20,
    });
    expect(only.items.map((i) => i.seq)).toEqual(['3', '1']);
  });
});
