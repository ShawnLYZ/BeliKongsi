import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { runDueJobs } from '@/server/modules/jobs/run';
import { balanceOf } from '@/server/modules/ledger/accounts';
import { runMoneyChecks } from '@/server/modules/ledger/checks';
import { voidOverduePayments } from '@/server/modules/payments/overdue';
import { closeDueRounds, closeRoundById } from '@/server/modules/rounds/close';
import { openDueRounds } from '@/server/modules/rounds/open';
import { createTestApp, type Client, type TestApp } from './helpers/app';
import {
  basketIdOf,
  feeChargeOf,
  openRoundOf,
  participationOf,
  payBasket,
  roundOf,
  setupKedaiKopi,
} from './helpers/scenarios';

const KEDAI = seedId('shop', 'KEDAI_KOPI');
const GERAI = seedId('shop', 'GERAI');
const WEEK = '2026-W45';
const CUTOFF = '2026-11-05T12:00:00Z';
const DOOR_DATE = '2026-11-10';
const geraiFeeHold = { kind: 'delivery_fee_hold', shopId: GERAI, deliveryDate: DOOR_DATE } as const;

/**
 * Kedai Kopi Contoh's refunds at cut-off on its other lines (Ipoh, shipping unchanged), per unit
 * (starting goods + fee) − (final goods + fee), times the quantity:
 */
const KEDAI_OTHER_REFUNDS_SEN =
  1 * (14100 + 282 - (13600 + 272)) + // EM 58 → tier 2: 510
  2 * (10800 + 216 - (10000 + 200)) + // OIL 106 → tier 3: 2 × 816
  10 * (1230 + 25 - (1190 + 24)) + // EGG_A 330 → tier 2: 10 × 41
  1 * (24500 + 490 - (23600 + 472)) + // COFFEE 30 → tier 2: 918
  2 * (12400 + 248 - (11800 + 236)); // CUPS 31 → tier 2: 2 × 612

let app: TestApp;
let cmRound: string;

const joinAndPay = async (client: Client, roundId: string, body: object) => {
  const res = await client.post(`/api/rounds/${roundId}/participations`, body);
  if (res.status !== 200) throw new Error(`join failed: ${res.status} ${JSON.stringify(res.body)}`);
  const paid = await client.post(`/api/payments/${res.body.paymentId}/simulate`, {
    outcome: 'succeeded',
    method: 'duitnow_qr',
  });
  if (paid.status !== 200) throw new Error(`payment failed: ${paid.status}`);
  return res.body as { paymentId: string };
};
const postingsOf = (participationId: string) =>
  app.prisma.ledgerPosting.findMany({ where: { participationId, kind: { not: 'payment_in' } } });
const eventsOf = async (type: string) =>
  (await app.prisma.integrationEvent.findMany({ where: { type }, orderBy: { seq: 'asc' } })).map(
    (e) => e.data as Record<string, unknown>,
  );

afterEach(async () => {
  await app.close();
});

describe('closing the demo week', () => {
  beforeEach(async () => {
    app = await createTestApp({ seed: 'demo' });
    await setupKedaiKopi(app);
    const basketId = (await basketIdOf('KEDAI_KOPI', WEEK))!;
    const added = await (
      await app.as('rahim')
    ).post(`/api/baskets/${basketId}/lines`, { productId: seedId('product', 'EM'), quantity: 1 });
    if (added.status !== 200) throw new Error(`staff add failed: ${added.status}`);
    await payBasket(app, 'ahSeng', basketId);
    cmRound = (await openRoundOf('CM')).id;
    app.clock.set(CUTOFF);
  });

  it('closes condensed milk at tier 3 and refunds RM 73.44 to Kedai Kopi Contoh (story 62)', async () => {
    await closeDueRounds(app.deps);
    expect(await app.prisma.round.findUniqueOrThrow({ where: { id: cmRound } })).toMatchObject({
      status: 'formed',
      finalTier: 3,
      finalUnitPriceSen: 14600,
      totalAtCutoff: 105,
      totalKept: 105,
      closeIterations: 1,
      closedAt: new Date(CUTOFF),
    });
    const cm = await participationOf('KEDAI_KOPI', 'CM');
    expect(cm).toMatchObject({
      status: 'kept',
      finalGoodsSen: 14600,
      finalFeeSen: 292,
      finalAllInSen: 15185,
      outcomeReason: 'Kept at tier 3: RM 151.85 all-in. Refund: RM 73.44.',
    });
    expect(await postingsOf(cm.id)).toMatchObject([
      { kind: 'refund_difference', amountSen: 7344, roundId: cmRound, shopId: KEDAI },
    ]);
    expect(KEDAI_OTHER_REFUNDS_SEN).toBe(4694);
    expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KEDAI })).toBe(
      7344 + KEDAI_OTHER_REFUNDS_SEN,
    );
    // What stays in the round is exactly the kept lines at the final price.
    const kept = await app.prisma.participation.findMany({ where: { roundId: cmRound } });
    expect(kept.every((p) => p.status === 'kept')).toBe(true);
    expect(await balanceOf(app.prisma, { kind: 'round_hold', roundId: cmRound })).toBe(
      kept.reduce((s, p) => s + p.finalAllInSen! * p.quantity, 0),
    );
  });

  it('drops Kafe Contoh’s Grade B eggs for its limit and refunds RM 123.30 (story 64)', async () => {
    await closeDueRounds(app.deps);
    const eggs = await participationOf('KAFE', 'EGG_B');
    expect(eggs).toMatchObject({
      status: 'dropped_price_limit',
      finalAllInSen: 1233,
      outcomeReason:
        'Dropped: the final all-in price of RM 12.33 is above your limit of RM 12.20. Full refund: RM 123.30.',
    });
    expect(await postingsOf(eggs.id)).toMatchObject([{ kind: 'refund_dropped', amountSen: 12330 }]);
    expect(await roundOf('EGG_B', WEEK)).toMatchObject({
      status: 'formed',
      finalTier: 1,
      finalUnitPriceSen: 1170,
      totalAtCutoff: 130,
      totalKept: 120,
      closeIterations: 2,
    });
    expect(
      await app.prisma.activityLogEntry.count({
        where: { action: 'participation.dropped_price_limit', subjectId: eggs.id },
      }),
    ).toBe(1);
    expect(await eventsOf('participation.dropped')).toEqual([
      {
        participationId: eggs.id,
        roundId: eggs.roundId,
        shopId: seedId('shop', 'KAFE'),
        quantity: 10,
        outcome: 'dropped_price_limit',
      },
    ]);
  });

  it('fails tea dust below its minimum and refunds everyone in full (story 63)', async () => {
    await closeDueRounds(app.deps);
    const tea = await roundOf('TEA', WEEK);
    expect(tea).toMatchObject({
      status: 'failed',
      finalTier: null,
      finalUnitPriceSen: null,
      totalAtCutoff: 6,
      totalKept: 0,
    });
    const parts = await app.prisma.participation.findMany({ where: { roundId: tea.id } });
    expect(parts).toHaveLength(2);
    for (const p of parts) {
      expect(p).toMatchObject({ status: 'refunded_failed', finalAllInSen: null });
      expect(p.outcomeReason).toMatch(
        /^The round didn't reach its minimum of 10 cartons\. Full refund: RM [\d,.]+\.$/,
      );
      expect(await postingsOf(p.id)).toMatchObject([
        { kind: 'refund_failed', amountSen: p.paidSen },
      ]);
    }
    expect(await balanceOf(app.prisma, { kind: 'round_hold', roundId: tea.id })).toBe(0);
  });

  it('closes paper bags empty and opens the next round (story 94)', async () => {
    await closeDueRounds(app.deps);
    expect(await roundOf('KRAFT', WEEK)).toMatchObject({
      status: 'empty',
      totalAtCutoff: 0,
      totalKept: 0,
      closedAt: new Date(CUTOFF),
    });
    // Fortnightly: the next paper bags round closes in W47.
    expect(await openRoundOf('KRAFT')).toMatchObject({
      cutoffAt: new Date('2026-11-19T12:00:00Z'),
      opensAt: new Date(CUTOFF),
      cycleLabel: '2026-W47',
    });
  });

  it('opens the next weekly round at the cut-off', async () => {
    await closeDueRounds(app.deps);
    const next = await openRoundOf('CM');
    expect(next.id).not.toBe(cmRound);
    expect(next.opensAt).toEqual(new Date(CUTOFF));
    expect(next.cutoffAt).toEqual(new Date('2026-11-12T12:00:00Z'));
  });

  it('closes a round exactly at its cut-off but not a second before', async () => {
    app.clock.set('2026-11-05T11:59:59Z');
    expect(await closeDueRounds(app.deps)).toEqual({ closed: 0, failed: 0 });
    expect(await closeRoundById(app.deps, cmRound)).toEqual({ outcome: 'skipped' });
    expect((await openRoundOf('CM')).id).toBe(cmRound);
    app.clock.set(CUTOFF);
    expect((await closeDueRounds(app.deps)).closed).toBe(12);
    expect(await app.prisma.round.count({ where: { status: 'open' } })).toBe(12);
    expect(await closeDueRounds(app.deps)).toEqual({ closed: 0, failed: 0 });
  });

  it('counts and logs a round that fails to close, leaves it open and still closes the rest', async () => {
    // A round whose stored tiers are unusable: the engine refuses to close it.
    await app.prisma.round.update({ where: { id: cmRound }, data: { tiersSnapshot: [] } });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await closeDueRounds(app.deps)).toEqual({ closed: 11, failed: 1 });
      // The whole error, stack included, so the failure can be traced.
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining(cmRound),
        expect.objectContaining({ stack: expect.stringContaining('closeRound') }),
      );
      // The scheduled jobs report it too, on every run until it closes.
      expect((await runDueJobs(app.deps)).failedRounds).toBe(1);
    } finally {
      logged.mockRestore();
    }
    expect((await app.prisma.round.findUniqueOrThrow({ where: { id: cmRound } })).status).toBe(
      'open',
    );
    expect(await app.prisma.round.count({ where: { status: { not: 'open' } } })).toBe(11);
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });

  it('logs the close and emits the round and refund events', async () => {
    expect(await closeRoundById(app.deps, cmRound)).toEqual({ outcome: 'formed' });
    const log = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'round.closed', subjectId: cmRound },
    });
    expect(log.after).toMatchObject({
      status: 'formed',
      finalTier: 3,
      finalUnitPriceSen: 14600,
      totalAtCutoff: 105,
      totalKept: 105,
    });
    expect(await eventsOf('round.closed')).toEqual([
      {
        roundId: cmRound,
        outcome: 'formed',
        finalTier: 3,
        finalUnitPriceSen: 14600,
        totalKept: 105,
        shopCount: 9,
      },
    ]);
    const cm = await participationOf('KEDAI_KOPI', 'CM');
    const refunds = await eventsOf('refund.issued');
    expect(refunds).toHaveLength(9);
    expect(refunds).toContainEqual({
      shopId: KEDAI,
      amountSen: 7344,
      kind: 'difference',
      referenceId: cm.id,
    });
    expect(
      await app.prisma.activityLogEntry.count({
        where: { action: 'refund.issued', subjectId: cm.id },
      }),
    ).toBe(1);
  });

  it('holds zero money for empty and failed rounds and passes every money check', async () => {
    await closeDueRounds(app.deps);
    for (const key of ['TEA', 'KRAFT']) {
      const round = await roundOf(key, WEEK);
      expect(await balanceOf(app.prisma, { kind: 'round_hold', roundId: round.id })).toBe(0);
    }
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });
});

describe('the delivery fee at close (PRD §6.9)', () => {
  it('keeps the delivery fee while another door line for that date is kept', async () => {
    app = await createTestApp({ seed: 'demo' });
    // Gerai Contoh (door, fee held for 10 Nov) adds a Grade B eggs door line it will be dropped from.
    const siti = await app.as('siti');
    await joinAndPay(siti, (await openRoundOf('EGG_B')).id, {
      quantity: 1,
      priceLimitSen: 1,
      destination: { type: 'door' },
    });
    const eggs = await participationOf('GERAI', 'EGG_B');
    expect(eggs).toMatchObject({ destinationType: 'door', deliveryDate: DOOR_DATE });
    app.clock.set(CUTOFF);

    await closeDueRounds(app.deps);
    expect((await participationOf('GERAI', 'EGG_B')).status).toBe('dropped_price_limit');
    expect((await participationOf('GERAI', 'CM')).status).toBe('kept');
    expect(await feeChargeOf('GERAI', DOOR_DATE)).toMatchObject({
      amountSen: 1200,
      status: 'held',
    });
    expect(await balanceOf(app.prisma, geraiFeeHold)).toBe(1200);
    expect(
      await app.prisma.ledgerPosting.count({
        where: { shopId: GERAI, kind: 'refund_delivery_fee' },
      }),
    ).toBe(0);
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });

  it('refunds the delivery fee when every door line for that date is refunded (story 68)', async () => {
    app = await createTestApp({ seed: 'reference' });
    await openDueRounds(app.deps);
    // Gerai Contoh's only lines: tea dust and flour by door, both far below their minimums.
    const siti = await app.as('siti');
    await joinAndPay(siti, (await openRoundOf('TEA')).id, {
      quantity: 1,
      destination: { type: 'door' },
    });
    await joinAndPay(siti, (await openRoundOf('FLOUR')).id, {
      quantity: 1,
      destination: { type: 'door' },
    });
    expect(await feeChargeOf('GERAI', DOOR_DATE)).toMatchObject({
      amountSen: 1200,
      status: 'held',
    });
    const tea = await participationOf('GERAI', 'TEA');
    const flour = await participationOf('GERAI', 'FLOUR');
    app.clock.set(CUTOFF);

    // Tea dust fails first: the flour line still needs the delivery, so the fee stays.
    expect(await closeRoundById(app.deps, tea.roundId)).toEqual({ outcome: 'failed' });
    expect((await feeChargeOf('GERAI', DOOR_DATE))!.status).toBe('held');
    // Flour fails too: nothing goes to the door on 10 Nov any more, so the fee comes back.
    expect(await closeRoundById(app.deps, flour.roundId)).toEqual({ outcome: 'failed' });
    expect((await feeChargeOf('GERAI', DOOR_DATE))!.status).toBe('refunded');
    expect(await balanceOf(app.prisma, geraiFeeHold)).toBe(0);
    expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: GERAI })).toBe(
      tea.paidSen + flour.paidSen + 1200,
    );
    expect(await eventsOf('refund.issued')).toContainEqual(
      expect.objectContaining({ shopId: GERAI, amountSen: 1200, kind: 'delivery_fee' }),
    );
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });
});

describe('payments at the cut-off', () => {
  let mei: Client;
  let pendingId: string;

  beforeEach(async () => {
    app = await createTestApp({ seed: 'reference' });
    await openDueRounds(app.deps);
    cmRound = (await openRoundOf('CM')).id;
    mei = await app.as('mei');
    const res = await mei.post(`/api/rounds/${cmRound}/participations`, { quantity: 2 });
    expect(res.body).toMatchObject({ status: 'pending' });
    pendingId = res.body.paymentId;
  });
  const simulateSuccess = () =>
    mei.post(`/api/payments/${pendingId}/simulate`, { outcome: 'succeeded', method: 'fpx' });
  const statusOf = async () =>
    (await app.prisma.payment.findUniqueOrThrow({ where: { id: pendingId } })).status;
  const cmHold = () => balanceOf(app.prisma, { kind: 'round_hold', roundId: cmRound });

  it('refuses a payment result that arrives exactly at the cut-off, like a late one', async () => {
    app.clock.set(CUTOFF);
    const res = await simulateSuccess();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PAYMENT_VOIDED');
    expect(await statusOf()).toBe('voided');
    expect(await app.prisma.participation.count({ where: { paymentId: pendingId } })).toBe(0);
    expect(await cmHold()).toBe(0);
  });

  it('voids an abandoned payment exactly at its deadline', async () => {
    app.clock.set('2026-11-05T11:59:59Z');
    expect((await voidOverduePayments(app.deps)).voided).toBe(0);
    app.clock.set(CUTOFF);
    expect(await voidOverduePayments(app.deps)).toEqual({ voided: 1, failed: 0 });
    expect(await statusOf()).toBe('voided');
  });

  it('refuses to settle a payment into a round that has already closed', async () => {
    // A deadline later than the round's cut-off, so only the round's status stops it.
    await app.prisma.payment.update({
      where: { id: pendingId },
      data: { deadlineAt: new Date('2026-11-06T12:00:00Z') },
    });
    app.clock.set(CUTOFF);
    expect(await closeRoundById(app.deps, cmRound)).toEqual({ outcome: 'empty' });

    const res = await simulateSuccess();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PAYMENT_VOIDED');
    expect(await statusOf()).toBe('voided');
    expect(await app.prisma.participation.count({ where: { paymentId: pendingId } })).toBe(0);
    expect(await app.prisma.ledgerPosting.count({ where: { paymentId: pendingId } })).toBe(0);
    expect(await cmHold()).toBe(0);
    expect(
      (
        await app.prisma.activityLogEntry.findFirstOrThrow({
          where: { action: 'payment.voided', subjectId: pendingId },
        })
      ).reason,
    ).toBe('The round closed before the payment arrived.');
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });
});
