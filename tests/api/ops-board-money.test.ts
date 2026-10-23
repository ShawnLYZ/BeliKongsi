import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { createTestApp, type TestApp } from './helpers/app';
import {
  opsApprovalOf,
  roundOf,
  supplierApprovalOf,
  supplierOrderOf,
  toFormed,
} from './helpers/scenarios';

const WEEK = '2026-W45';

type Check = {
  id: string;
  passed: boolean;
  failures: { roundId?: string; link?: string }[];
};

let app: TestApp;
let cmRound: string;

beforeEach(async () => {
  app = await createTestApp({ seed: 'demo' });
  await toFormed(app);
  cmRound = (await roundOf('CM', WEEK)).id;
});

afterEach(async () => {
  await app.close();
});

describe('The Ops rounds board and money overview', () => {
  it('groups rounds by status and reports success, tier and shops (story 129)', async () => {
    const nadia = await app.as('nadia');
    const res = await nadia.get('/api/ops/rounds');
    expect(res.status).toBe(200);
    const b = res.body;
    const count = (s: string) =>
      b.columns.find((c: { status: string; rounds: unknown[] }) => c.status === s)?.rounds.length ??
      0;
    const wentFurther = ['formed', 'ordered', 'confirmed', 'dispatched', 'at_hub', 'completed']
      .map(count)
      .reduce((a: number, n: number) => a + n, 0);
    // This week: 10 formed, tea failed, kraft bags empty. The history week: 7 completed (tiers
    // 2, 2, 3, 1, 2, 2 and 1) and tea failed.
    expect(wentFurther).toBe(17);
    expect(count('failed')).toBe(2);
    expect(count('empty')).toBe(1);
    expect(b.stats.successRate).toBeCloseTo(17 / 19, 5);
    expect(b.stats.averageTier).toBeCloseTo((10 * 2.0 + 13) / 17, 5);
    expect(b.stats.averageShopsPerRound).toBeGreaterThan(0);
  });

  it('shows only one status when asked', async () => {
    const res = await (await app.as('nadia')).get('/api/ops/rounds?status=failed');
    expect(res.body.columns).toHaveLength(1);
    expect(res.body.columns[0].status).toBe('failed');
    expect(res.body.columns[0].rounds).toHaveLength(2); // tea dust, this week and the last
  });

  it("shows Ops every shop's name in a round (story 131)", async () => {
    const nadia = await app.as('nadia');
    const d = (await nadia.get(`/api/ops/rounds/${cmRound}`)).body;
    expect(d.participants.map((p: { shopName: string }) => p.shopName)).toEqual(
      expect.arrayContaining(['Kedai Kopi Contoh', 'Gerai Contoh', 'Kafe Contoh']),
    );
    expect(d.ledger.postingsByKind.payment_in ?? d.ledger.postingsByKind).toBeDefined();
    expect(d.moneyCheck.passed).toBe(true);
  });

  it('answers 404 for a round that does not exist', async () => {
    const res = await (await app.as('nadia')).get(`/api/ops/rounds/${seedId('round', 'nope')}`);
    expect(res.status).toBe(404);
  });

  it('passes every money check after the full flow (story 130)', async () => {
    const nadia = await app.as('nadia');
    // The history week's suppliers were paid a week earlier.
    const paidBefore = (await nadia.get('/api/ops/money')).body.supplierPayoutsSen as number;
    const cmOrder = (await supplierOrderOf(cmRound)).id;
    await nadia.post(`/api/approvals/${await opsApprovalOf(cmOrder)}/approve`, {});
    const farid = await app.as('farid');
    await farid.post(`/api/approvals/${await supplierApprovalOf(cmOrder)}/approve`, {
      expectedDispatchDate: '2026-11-07',
    });
    await farid.post(`/api/supplier-orders/${cmOrder}/dispatched`);
    const hub = await nadia.post(`/api/supplier-orders/${cmOrder}/hub-check`, {
      goodUnits: 105,
      damagedUnits: 0,
    });
    expect(hub.status).toBe(200);
    const res = await nadia.get('/api/ops/money');
    expect(res.status).toBe(200);
    expect(res.body.checks).toHaveLength(8);
    expect(res.body.checks.every((c: Check) => c.passed)).toBe(true);
    expect(res.body.supplierPayoutsSen).toBe(paidBefore + 1533000);
    const paidIn = await app.prisma.ledgerPosting.aggregate({
      where: { kind: { in: ['payment_in', 'delivery_fee_in'] } },
      _sum: { amountSen: true },
    });
    expect(res.body.partnerCashSen).toBe(-(paidIn._sum.amountSen ?? 0) + paidBefore + 1533000);
  });

  it('shows a failing check with a link to the round', async () => {
    await app.adminQuery(
      `INSERT INTO ledger_postings (id, occurred_at, from_account_id, to_account_id, amount_sen, kind, round_id)
       SELECT gen_random_uuid(), now(), h.id, s.id, 100, 'refund_shortfall', h.round_id
       FROM ledger_accounts h, ledger_accounts s
       WHERE h.key = $1 AND s.kind = 'shop_balance' LIMIT 1`,
      [`round_hold:${cmRound}`],
    );
    const o = (await (await app.as('nadia')).get('/api/ops/money')).body;
    const check = o.checks.find((c: Check) => c.id === 'cached_balances_match_postings');
    expect(check).toMatchObject({ passed: false });
    expect(
      check.failures.some(
        (f: Check['failures'][number]) =>
          f.roundId === cmRound && f.link === `/ops/rounds/${cmRound}`,
      ),
    ).toBe(true);
  });

  it('lists money held in every live round, not only open ones', async () => {
    const o = (await (await app.as('nadia')).get('/api/ops/money')).body;
    const cm = o.heldPerOpenRound.find((h: { roundId: string }) => h.roundId === cmRound);
    expect(cm).toMatchObject({ productName: expect.any(String) });
    expect(cm.heldSen).toBeGreaterThan(0);
  });

  it('counts a round cancelled after closing against the success rate', async () => {
    const cmOrder = (await supplierOrderOf(cmRound)).id;
    const nadia = await app.as('nadia');
    const rej = await nadia.post(`/api/approvals/${await opsApprovalOf(cmOrder)}/reject`, {
      reason: 'Price dispute',
    });
    expect(rej.status).toBe(200);
    const b = (await nadia.get('/api/ops/rounds')).body;
    expect(b.stats.successRate).toBeCloseTo(16 / 19, 5);
  });

  it('keeps another round failing check out of this round detail', async () => {
    await app.adminQuery(
      `INSERT INTO ledger_postings (id, occurred_at, from_account_id, to_account_id, amount_sen, kind, round_id)
       SELECT gen_random_uuid(), now(), h.id, s.id, 100, 'refund_shortfall', h.round_id
       FROM ledger_accounts h, ledger_accounts s
       WHERE h.key = $1 AND s.kind = 'shop_balance' LIMIT 1`,
      [`round_hold:${cmRound}`],
    );
    const nadia = await app.as('nadia');
    const other = (await roundOf('EM', WEEK)).id;
    const d = (await nadia.get(`/api/ops/rounds/${other}`)).body;
    expect(d.moneyCheck.passed).toBe(true);
    expect(d.moneyCheck.checks.every((c: Check) => c.passed && c.failures.length === 0)).toBe(true);
    const own = (await nadia.get(`/api/ops/rounds/${cmRound}`)).body;
    expect(own.moneyCheck.passed).toBe(false);
    const failing = own.moneyCheck.checks.filter((c: Check) => !c.passed);
    expect(failing.length).toBeGreaterThan(0);
    expect(failing.every((c: Check) => c.failures.length > 0)).toBe(true);
  });

  it('shows a participation failure on its own round detail', async () => {
    await app.adminQuery(
      `UPDATE participations SET paid_sen = paid_sen + 5 WHERE id = (SELECT id FROM participations WHERE round_id = $1 LIMIT 1)`,
      [cmRound],
    );
    const d = (await (await app.as('nadia')).get(`/api/ops/rounds/${cmRound}`)).body;
    const paid = d.moneyCheck.checks.find(
      (c: Check) => c.id === 'participation_paid_equals_refunds_plus_allocated',
    );
    expect(paid.passed).toBe(false);
    expect(paid.failures.length).toBeGreaterThan(0);
    expect(d.moneyCheck.passed).toBe(false);
  });

  it('keeps the board and money overview from other roles', async () => {
    for (const who of ['ahSeng', 'farid'] as const) {
      const c = await app.as(who);
      expect((await c.get('/api/ops/rounds')).status).toBe(403);
      expect((await c.get(`/api/ops/rounds/${cmRound}`)).status).toBe(403);
      expect((await c.get('/api/ops/money')).status).toBe(403);
    }
  });
});
