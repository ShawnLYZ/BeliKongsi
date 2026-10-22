import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import type { PrismaClient } from '@/generated/prisma/client';
import { fixedClock } from '@/server/adapters/clock';
import { balanceOf } from '@/server/modules/ledger/accounts';
import { runMoneyChecks } from '@/server/modules/ledger/checks';
import { cancelParticipation } from '@/server/modules/payments/cancel';
import { completePaymentSuccess } from '@/server/modules/payments/complete';
import { closeRoundById } from '@/server/modules/rounds/close';
import { openDueRounds } from '@/server/modules/rounds/open';
import { personCaller, systemCaller } from '@/server/platform/caller';
import { createPrismaClient } from '@/server/platform/db';
import type { AppDeps } from '@/server/platform/deps';
import { withTransaction } from '@/server/platform/tx';
import { createTestApp, type Client, type TestApp } from './helpers/app';
import { openRoundOf } from './helpers/scenarios';
import { session } from './helpers/sessions';

const GERAI = seedId('shop', 'GERAI');
const CUTOFF = '2026-11-05T12:00:00Z';
const JUST_BEFORE = '2026-11-05T11:59:59Z';
/** Ten of the week's rounds, each far below its minimum: every one fails at the close. */
const PRODUCTS = ['CM', 'EM', 'OIL', 'FLOUR', 'COFFEE', 'TEA', 'EGG_A', 'EGG_B', 'CUPS', 'CONT'];

let app: TestApp;
const others: PrismaClient[] = [];

/**
 * A worker on its own connection pool and clock. `attempts` counts its transactions: each call to
 * `$transaction` is one attempt, so a deadlock (40P01) that `withTransaction` retries shows up as
 * a second attempt for the same piece of work.
 */
function worker(at: string): { deps: AppDeps; attempts: () => number } {
  const prisma = createPrismaClient(app.appUrl);
  others.push(prisma);
  let attempts = 0;
  const counted = new Proxy(prisma, {
    get(target, key) {
      if (key === '$transaction') {
        return (...args: unknown[]) => {
          attempts += 1;
          return (target.$transaction as (...a: unknown[]) => unknown)(...args);
        };
      }
      const value: unknown = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return {
    deps: { ...app.deps, prisma: counted, clock: fixedClock(at) },
    attempts: () => attempts,
  };
}

const refundsOf = (participationId: string) =>
  app.prisma.ledgerPosting.findMany({
    where: { participationId, kind: { in: ['refund_cancelled', 'refund_failed'] } },
  });

beforeEach(async () => {
  app = await createTestApp({ seed: 'reference' });
  await openDueRounds(app.deps);
});

afterEach(async () => {
  await Promise.all(others.splice(0).map((p) => p.$disconnect()));
  await app.close();
});

describe('a close racing a cancel and a payment of the same round', () => {
  it('settles every line exactly once, without a deadlock, whichever goes first', async () => {
    const siti: Client = await app.as('siti');
    const owner = personCaller(session('siti', 'owner', { shopId: GERAI }, 'shop'));
    // Gerai Contoh has a paid door line in each round (so the close refunds it and its delivery
    // date), and a second payment for each round still waiting for its result.
    const races = [];
    for (const key of PRODUCTS) {
      const roundId = (await openRoundOf(key)).id;
      const paid = await siti.post(`/api/rounds/${roundId}/participations`, {
        quantity: 1,
        destination: { type: 'door' },
      });
      expect(paid.status).toBe(200);
      const done = await siti.post(`/api/payments/${paid.body.paymentId}/simulate`, {
        outcome: 'succeeded',
        method: 'duitnow_qr',
      });
      expect(done.status).toBe(200);
      const line = await app.prisma.participation.findFirstOrThrow({
        where: { paymentId: paid.body.paymentId },
      });
      const pending = await siti.post(`/api/rounds/${roundId}/participations`, {
        quantity: 1,
        destination: { type: 'door' },
      });
      expect(pending.body).toMatchObject({ status: 'pending' });
      races.push({ roundId, lineId: line.id, pendingId: pending.body.paymentId as string });
    }

    // The close runs at the cut-off; the cancel and the payment arrive a second before it.
    app.clock.set(CUTOFF);
    const closer = worker(CUTOFF);
    const canceller = worker(JUST_BEFORE);
    const payer = worker(JUST_BEFORE);
    for (const race of races) {
      const before = [closer.attempts(), canceller.attempts(), payer.attempts()];
      const [closed, cancelled] = await Promise.all([
        closeRoundById(closer.deps, race.roundId),
        cancelParticipation(canceller.deps, owner, race.lineId).then(
          () => 'cancelled',
          (e: { code?: string }) => e.code,
        ),
        withTransaction(payer.deps, systemCaller('race'), (ctx) =>
          completePaymentSuccess(ctx, race.pendingId, 'fpx'),
        ),
      ]);
      // One attempt each: nothing deadlocked and had to be retried.
      expect([closer.attempts(), canceller.attempts(), payer.attempts()]).toEqual(
        before.map((n) => n + 1),
      );

      // The paid line ends exactly one way, with exactly one refund.
      const line = await app.prisma.participation.findUniqueOrThrow({
        where: { id: race.lineId },
      });
      if (cancelled === 'cancelled') {
        expect(line.status).toBe('cancelled');
        expect((await refundsOf(line.id)).map((r) => r.kind)).toEqual(['refund_cancelled']);
      } else {
        expect(cancelled).toBe('ROUND_CLOSED');
        expect(line.status).toBe('refunded_failed');
        expect((await refundsOf(line.id)).map((r) => r.kind)).toEqual(['refund_failed']);
      }

      // The waiting payment either joined before the close (and was refunded with the round) or
      // found the round closed and was voided, moving nothing.
      const payment = await app.prisma.payment.findUniqueOrThrow({
        where: { id: race.pendingId },
      });
      const joined = await app.prisma.participation.findMany({
        where: { paymentId: race.pendingId },
      });
      if (payment.status === 'succeeded') {
        expect(joined.map((p) => p.status)).toEqual(['refunded_failed']);
        expect((await refundsOf(joined[0]!.id)).map((r) => r.kind)).toEqual(['refund_failed']);
      } else {
        expect(payment.status).toBe('voided');
        expect(joined).toEqual([]);
        expect(await app.prisma.ledgerPosting.count({ where: { paymentId: race.pendingId } })).toBe(
          0,
        );
      }
      // The close saw whatever lines were still active: none when the cancel came first and the
      // payment after it, otherwise every one of them failed below the minimum.
      const anyLeft = cancelled !== 'cancelled' || payment.status === 'succeeded';
      expect(closed).toEqual({ outcome: anyLeft ? 'failed' : 'empty' });
      expect(await balanceOf(app.prisma, { kind: 'round_hold', roundId: race.roundId })).toBe(0);
    }
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });
});
