import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { balanceOf } from '@/server/modules/ledger/accounts';
import { createPrismaClient } from '@/server/platform/db';
import { closeDueRounds, closeRoundById } from '@/server/modules/rounds/close';
import { createTestApp, type TestApp } from './helpers/app';
import { basketIdOf, openRoundOf, payBasket, setupKedaiKopi } from './helpers/scenarios';

const KEDAI = seedId('shop', 'KEDAI_KOPI');
const WEEK = '2026-W45';
const CUTOFF = '2026-11-05T12:00:00Z';

let app: TestApp;
let cmRound: string;

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

afterEach(async () => {
  await app.close();
});

describe('closing is safe to repeat and to race', () => {
  it('changes nothing when the close job runs twice (story 177)', async () => {
    expect(await closeDueRounds(app.deps)).toEqual({ closed: 12, failed: 0 });
    const counts = () =>
      Promise.all([
        app.prisma.ledgerPosting.count(),
        app.prisma.activityLogEntry.count(),
        app.prisma.notification.count(),
      ]);
    const before = await counts();
    expect(before.every((n) => n > 0)).toBe(true);
    expect(await closeDueRounds(app.deps)).toEqual({ closed: 0, failed: 0 });
    expect(await counts()).toEqual(before);
  });

  it('closes once, with one set of refunds, when two workers close the same round together', async () => {
    const otherPrisma = createPrismaClient(app.appUrl);
    try {
      const other = { ...app.deps, prisma: otherPrisma };
      const results = await Promise.all([
        closeRoundById(app.deps, cmRound),
        closeRoundById(other, cmRound),
      ]);
      expect(results.map((r) => r.outcome).sort()).toEqual(['formed', 'skipped']);
      expect(
        await app.prisma.activityLogEntry.count({
          where: { action: 'round.closed', subjectId: cmRound },
        }),
      ).toBe(1);
      expect(await app.prisma.supplierOrder.count({ where: { roundId: cmRound } })).toBe(1);

      // One set of refunds: a single refund_difference per kept line, and Kedai Kopi's exactly once.
      const kept = await app.prisma.participation.count({
        where: { roundId: cmRound, status: 'kept' },
      });
      expect(kept).toBeGreaterThan(0);
      const diffs = await app.prisma.ledgerPosting.findMany({
        where: { roundId: cmRound, kind: 'refund_difference' },
      });
      expect(diffs).toHaveLength(kept);
      expect(diffs.filter((d) => d.shopId === KEDAI).map((d) => d.amountSen)).toEqual([7344]);
      expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KEDAI })).toBe(7344);
      expect(
        await app.prisma.notification.count({
          where: {
            type: 'round.kept',
            userId: seedId('user', 'ahSeng'),
            body: { contains: 'condensed', mode: 'insensitive' },
          },
        }),
      ).toBe(1);
    } finally {
      await otherPrisma.$disconnect();
    }
  });
});
