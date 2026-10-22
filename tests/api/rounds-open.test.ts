import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { openDueRounds } from '@/server/modules/rounds/open';
import { createTestApp, type TestApp } from './helpers/app';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ seed: 'reference' });
});
afterEach(async () => {
  await app.close();
});

describe('opening rounds', () => {
  it('opens one round per active product closing Thu 5 Nov 8 pm', async () => {
    expect(await openDueRounds(app.deps)).toEqual({ opened: 12 });
    const rounds = await app.prisma.round.findMany({ where: { status: 'open' } });
    expect(new Set(rounds.map((r) => r.cutoffAt.toISOString()))).toEqual(
      new Set(['2026-11-05T12:00:00.000Z']),
    );
    expect(new Set(rounds.map((r) => r.cycleLabel))).toEqual(new Set(['2026-W45']));
  });

  it('opens nothing new when run again', async () => {
    await openDueRounds(app.deps);
    expect(await openDueRounds(app.deps)).toEqual({ opened: 0 });
  });

  it('freezes tiers when a round opens (story 51)', async () => {
    await openDueRounds(app.deps);
    const productId = seedId('product', 'CM');
    await app.prisma.priceTier.updateMany({
      where: { productId },
      data: { unitPriceSen: { increment: 100 } },
    });
    const round = await app.prisma.round.findFirstOrThrow({ where: { productId } });
    expect(round.tiersSnapshot).toEqual([
      { minQuantity: 20, unitPriceSen: 15800 },
      { minQuantity: 50, unitPriceSen: 15200 },
      { minQuantity: 100, unitPriceSen: 14600 },
    ]);
    expect(round.feeBps).toBe(200);
  });

  it('logs and emits the opening without names', async () => {
    await openDueRounds(app.deps);
    const logs = await app.prisma.activityLogEntry.findMany({ where: { action: 'round.opened' } });
    expect(logs).toHaveLength(12);
    expect(logs.every((l) => l.actorType === 'system')).toBe(true);
    const events = await app.prisma.integrationEvent.findMany({ where: { type: 'round.opened' } });
    expect(events).toHaveLength(12);
    const allowed = new Set(['roundId', 'productId', 'supplierId', 'cutoffAt', 'tiers']);
    for (const e of events) {
      expect(Object.keys(e.data as object).every((k) => allowed.has(k))).toBe(true);
    }
  });
});
