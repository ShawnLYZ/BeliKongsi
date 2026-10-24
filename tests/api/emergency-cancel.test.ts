import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import type { PrismaClient } from '@/generated/prisma/client';
import { fixedClock } from '@/server/adapters/clock';
import { balanceOf } from '@/server/modules/ledger/accounts';
import { runMoneyChecks } from '@/server/modules/ledger/checks';
import { closeRoundById } from '@/server/modules/rounds/close';
import { cancelOpenRound } from '@/server/modules/rounds/cancel';
import { openDueRounds } from '@/server/modules/rounds/open';
import { personCaller } from '@/server/platform/caller';
import { createPrismaClient } from '@/server/platform/db';
import type { AppDeps } from '@/server/platform/deps';
import { createTestApp, type Client, type TestApp } from './helpers/app';
import { openRoundOf } from './helpers/scenarios';
import { session } from './helpers/sessions';

const GERAI = seedId('shop', 'GERAI');
const OPS = seedId('operator', 'OPS');
const CUTOFF = '2026-11-05T12:00:00Z';
const NEXT_CUTOFF = new Date('2026-11-12T12:00:00Z');
const REASON = 'The supplier closed for a funeral';

const opsCaller = personCaller(session('nadia', 'ops', { operatorId: OPS }, 'operator'));

let app: TestApp;
const others: PrismaClient[] = [];

function worker(at: string): AppDeps {
  const prisma = createPrismaClient(app.appUrl);
  others.push(prisma);
  return { ...app.deps, prisma, clock: fixedClock(at) };
}

async function joinAndPay(client: Client, roundId: string, body: object) {
  const res = await client.post(`/api/rounds/${roundId}/participations`, body);
  expect(res.status).toBe(200);
  const paid = await client.post(`/api/payments/${res.body.paymentId}/simulate`, {
    outcome: 'succeeded',
    method: 'duitnow_qr',
  });
  expect(paid.status).toBe(200);
  return app.prisma.participation.findFirstOrThrow({ where: { paymentId: res.body.paymentId } });
}

const refundsOf = (roundId: string) =>
  app.prisma.ledgerPosting.findMany({
    where: { roundId, kind: { in: ['refund_round_cancelled', 'refund_failed'] } },
  });

beforeEach(async () => {
  app = await createTestApp({ seed: 'reference' });
  await openDueRounds(app.deps);
});

afterEach(async () => {
  await Promise.all(others.splice(0).map((p) => p.$disconnect()));
  await app.close();
});

describe('cancelling an open round in an emergency', () => {
  it('refunds every shop in full and leaves nothing in the hold', async () => {
    const round = await openRoundOf('CM');
    const siti = await joinAndPay(await app.as('siti'), round.id, {
      quantity: 2,
      destination: { type: 'door' },
    });
    const kumar = await joinAndPay(await app.as('mei'), round.id, {
      quantity: 1,
      destination: { type: 'door' },
    });
    expect(siti.paidSen).toBeGreaterThan(0);

    const result = await cancelOpenRound(app.deps, opsCaller, round.id, { reason: REASON });

    expect(result.refundedSen).toBe(siti.paidSen + kumar.paidSen);
    const after = await app.prisma.participation.findMany({ where: { roundId: round.id } });
    expect(after.map((p) => p.status)).toEqual(
      after.map(() => 'refunded_round_cancelled' as const),
    );
    expect(after.every((p) => p.outcomeReason === REASON)).toBe(true);
    expect(await balanceOf(app.prisma, { kind: 'round_hold', roundId: round.id })).toBe(0);
    expect((await app.prisma.round.findUniqueOrThrow({ where: { id: round.id } })).status).toBe(
      'cancelled',
    );
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });

  it('tells each owner, logs the decision and emits the event', async () => {
    const round = await openRoundOf('CM');
    await joinAndPay(await app.as('siti'), round.id, {
      quantity: 1,
      destination: { type: 'door' },
    });
    await cancelOpenRound(app.deps, opsCaller, round.id, { reason: REASON });

    const notice = await app.prisma.notification.findFirstOrThrow({
      where: { type: 'round.cancelled_emergency', shopId: GERAI },
    });
    expect(notice.body).toContain(`: ${REASON}. Full refund: RM `);
    expect(notice.link).toBe('/owner/kongsi');
    const log = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'round.cancelled', subjectId: round.id },
    });
    expect(log.reason).toBe(REASON);
    expect(log.operatorScope).toBe(true);
    const events = await app.prisma.integrationEvent.findMany({
      where: { type: 'round.cancelled' },
    });
    expect(events.map((e) => e.data)).toEqual([
      { roundId: round.id, by: 'ops', reasonCode: 'emergency' },
    ]);
  });

  it('opens the next round with the following Thursday cut-off', async () => {
    const round = await openRoundOf('CM');
    const { nextRoundId } = await cancelOpenRound(app.deps, opsCaller, round.id, {
      reason: REASON,
    });

    const next = await app.prisma.round.findUniqueOrThrow({ where: { id: nextRoundId! } });
    expect(next.status).toBe('open');
    expect(next.cutoffAt).toEqual(NEXT_CUTOFF);
    expect(next.opensAt).toEqual(round.cutoffAt);
  });

  it('opens no next round and switches the product off when Ops pause it', async () => {
    const round = await openRoundOf('CM');
    const { nextRoundId } = await cancelOpenRound(app.deps, opsCaller, round.id, {
      reason: REASON,
      pauseProduct: true,
    });

    expect(nextRoundId).toBeNull();
    const product = await app.prisma.product.findUniqueOrThrow({ where: { id: round.productId } });
    expect(product.active).toBe(false);
    expect(
      await app.prisma.round.count({ where: { productId: round.productId, status: 'open' } }),
    ).toBe(0);
  });

  it('logs that Ops paused the product and no round opened next', async () => {
    const paused = await openRoundOf('CM');
    await cancelOpenRound(app.deps, opsCaller, paused.id, { reason: REASON, pauseProduct: true });
    const pausedLog = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'round.cancelled', subjectId: paused.id },
    });
    expect(pausedLog.after).toEqual({ refundedSen: 0, pauseProduct: true, nextRoundId: null });
  });

  it('logs the next round it opened when the product stays on', async () => {
    const round = await openRoundOf('CM');
    const { nextRoundId } = await cancelOpenRound(app.deps, opsCaller, round.id, {
      reason: REASON,
    });
    const log = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'round.cancelled', subjectId: round.id },
    });
    expect(nextRoundId).not.toBeNull();
    expect(log.after).toEqual({ refundedSen: 0, pauseProduct: false, nextRoundId });
  });

  it('refunds the delivery fee when no door line is left for that date', async () => {
    const round = await openRoundOf('CM');
    await joinAndPay(await app.as('siti'), round.id, {
      quantity: 1,
      destination: { type: 'door' },
    });
    const line = await app.prisma.participation.findFirstOrThrow({ where: { roundId: round.id } });
    const feeAccount = {
      kind: 'delivery_fee_hold',
      shopId: GERAI,
      deliveryDate: line.deliveryDate,
    } as const;
    expect(await balanceOf(app.prisma, feeAccount)).toBeGreaterThan(0);

    await cancelOpenRound(app.deps, opsCaller, round.id, { reason: REASON });

    expect(await balanceOf(app.prisma, feeAccount)).toBe(0);
  });

  it('rejects a missing or blank reason with 422', async () => {
    const round = await openRoundOf('CM');
    const ops = await app.as('nadia');

    const missing = await ops.post(`/api/rounds/${round.id}/cancel`, {});
    const blank = await ops.post(`/api/rounds/${round.id}/cancel`, { reason: '   ' });

    expect(missing.status).toBe(422);
    expect(missing.body.code).toBe('REASON_REQUIRED');
    expect(blank.status).toBe(422);
    expect(blank.body.code).toBe('REASON_REQUIRED');
    expect((await app.prisma.round.findUniqueOrThrow({ where: { id: round.id } })).status).toBe(
      'open',
    );
  });

  it('refuses a caller who is not Ops with 403', async () => {
    const round = await openRoundOf('CM');
    const res = await (
      await app.as('siti')
    ).post(`/api/rounds/${round.id}/cancel`, { reason: REASON });
    expect(res.status).toBe(403);
    expect((await app.prisma.round.findUniqueOrThrow({ where: { id: round.id } })).status).toBe(
      'open',
    );
  });

  it('cancels through the API and answers with the refund and the next round', async () => {
    const round = await openRoundOf('CM');
    const line = await joinAndPay(await app.as('mei'), round.id, {
      quantity: 1,
      destination: { type: 'door' },
    });
    const res = await (
      await app.as('nadia')
    ).post(`/api/rounds/${round.id}/cancel`, { reason: REASON });

    expect(res.status).toBe(200);
    expect(res.body.refundedSen).toBe(line.paidSen);
    expect(typeof res.body.nextRoundId).toBe('string');
  });

  it('refuses a round that is already cancelled with 409', async () => {
    const round = await openRoundOf('CM');
    await cancelOpenRound(app.deps, opsCaller, round.id, { reason: REASON });
    await expect(
      cancelOpenRound(app.deps, opsCaller, round.id, { reason: REASON }),
    ).rejects.toMatchObject({ status: 409, code: 'ROUND_NOT_OPEN' });
  });

  it('still cancels an open round that is past its cut-off but not yet closed', async () => {
    const round = await openRoundOf('CM');
    await joinAndPay(await app.as('siti'), round.id, {
      quantity: 1,
      destination: { type: 'door' },
    });
    app.clock.set('2026-11-05T12:30:00Z');
    const result = await cancelOpenRound(app.deps, opsCaller, round.id, { reason: REASON });
    expect(result.refundedSen).toBeGreaterThan(0);
  });
});

describe('an emergency cancellation racing the close at the cut-off', () => {
  it('lets exactly one of them happen and refunds each line once', async () => {
    const siti = await app.as('siti');
    const races = [];
    for (const key of ['CM', 'EM', 'OIL', 'FLOUR', 'COFFEE', 'TEA']) {
      const round = await openRoundOf(key);
      const line = await joinAndPay(siti, round.id, {
        quantity: 1,
        destination: { type: 'door' },
      });
      races.push({ roundId: round.id, line });
    }

    app.clock.set(CUTOFF);
    const closer = worker(CUTOFF);
    const canceller = worker(CUTOFF);
    for (const { roundId, line } of races) {
      const [closed, cancelled] = await Promise.all([
        closeRoundById(closer, roundId),
        cancelOpenRound(canceller, opsCaller, roundId, { reason: REASON }).then(
          () => 'cancelled',
          (e: { code?: string; status?: number }) => `${e.status} ${e.code}`,
        ),
      ]);

      const round = await app.prisma.round.findUniqueOrThrow({ where: { id: roundId } });
      const lineAfter = await app.prisma.participation.findUniqueOrThrow({
        where: { id: line.id },
      });
      const refunds = await refundsOf(roundId);
      expect(refunds).toHaveLength(1);
      if (cancelled === 'cancelled') {
        expect(closed).toEqual({ outcome: 'skipped' });
        expect(round.status).toBe('cancelled');
        expect(lineAfter.status).toBe('refunded_round_cancelled');
        expect(refunds[0]!.kind).toBe('refund_round_cancelled');
      } else {
        expect(cancelled).toBe('409 ROUND_NOT_OPEN');
        expect(closed.outcome).not.toBe('skipped');
        expect(round.status).not.toBe('cancelled');
        expect(lineAfter.status).toBe('refunded_failed');
        expect(refunds[0]!.kind).toBe('refund_failed');
      }
      expect(await balanceOf(app.prisma, { kind: 'round_hold', roundId })).toBe(0);
    }
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });
});
