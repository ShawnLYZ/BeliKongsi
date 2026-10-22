import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { closeDueRounds } from '@/server/modules/rounds/close';
import { createTestApp, type TestApp } from './helpers/app';
import { expectNoMoneyFields } from './helpers/scans';
import { basketIdOf, openRoundOf, payBasket, roundOf, setupKedaiKopi } from './helpers/scenarios';

const KEDAI = seedId('shop', 'KEDAI_KOPI');
const GERAI = seedId('shop', 'GERAI');
const WEEK = '2026-W45';
const CUTOFF = '2026-11-05T12:00:00Z';

let app: TestApp;

afterEach(async () => {
  await app.close();
});

describe('the closed-round result view', () => {
  beforeEach(async () => {
    app = await createTestApp({ seed: 'demo' });
    await setupKedaiKopi(app);
    await payBasket(app, 'ahSeng', (await basketIdOf('KEDAI_KOPI', WEEK))!);
    app.clock.set(CUTOFF);
    await closeDueRounds(app.deps);
  });

  it('shows the formed round result with the same shop count as its round.closed event', async () => {
    const cm = await roundOf('CM', WEEK);
    const res = await (await app.as('ahSeng')).get(`/api/rounds/${cm.id}`);
    expect(res.status).toBe(200);
    const event = await app.prisma.integrationEvent.findFirstOrThrow({
      where: { type: 'round.closed', data: { path: ['roundId'], equals: cm.id } },
    });
    const eventData = event.data as { shopCount: number };
    expect(res.body.result).toEqual({
      finalTier: 3,
      finalUnitPriceSen: 14600,
      totalKept: 105,
      shopCount: 9,
      closedAt: cm.closedAt!.toISOString(),
    });
    expect(res.body.result.shopCount).toBe(eventData.shopCount);
    const next = await openRoundOf('CM');
    expect(next.id).not.toBe(cm.id);
    expect(res.body).toMatchObject({
      status: 'formed',
      nextRoundId: next.id,
      nextRoundCutoffAt: next.cutoffAt.toISOString(),
    });
  });

  it('shows a failed round with no formed result and the next round to join', async () => {
    const tea = await roundOf('TEA', WEEK);
    const res = await (await app.as('ahSeng')).get(`/api/rounds/${tea.id}`);
    expect(res.status).toBe(200);
    const next = await openRoundOf('TEA');
    expect(res.body).toMatchObject({
      status: 'failed',
      result: null,
      nextRoundId: next.id,
      nextRoundCutoffAt: next.cutoffAt.toISOString(),
    });
  });

  it('gives staff the closed round with no money fields', async () => {
    const cm = await roundOf('CM', WEEK);
    const res = await (await app.as('rahim')).get(`/api/rounds/${cm.id}`);
    expect(res.status).toBe(200);
    expectNoMoneyFields(res.body);
    expect(res.body).not.toHaveProperty('result');
    expect(res.body.nextRoundId).toBe((await openRoundOf('CM')).id);
  });
});

describe('ParticipationView.destinationType', () => {
  beforeEach(async () => {
    app = await createTestApp({ seed: 'demo' });
    await setupKedaiKopi(app);
    await payBasket(app, 'ahSeng', (await basketIdOf('KEDAI_KOPI', WEEK))!);
  });

  it("is 'door' for Gerai Contoh's door lines and 'pickup_point' for Kedai Kopi's pickup lines", async () => {
    const gerai = (await (await app.as('siti')).get(`/api/shops/${GERAI}/participations`)).body
      .items as { participationId: string; destinationType: string }[];
    expect(gerai.length).toBeGreaterThan(0);
    for (const item of gerai) {
      const row = await app.prisma.participation.findUniqueOrThrow({
        where: { id: item.participationId },
      });
      expect(item.destinationType).toBe(row.destinationType);
    }
    expect(gerai.some((i) => i.destinationType === 'door')).toBe(true);

    const kedai = (await (await app.as('ahSeng')).get(`/api/shops/${KEDAI}/participations`)).body
      .items as { destinationType: string }[];
    expect(kedai).toHaveLength(5);
    expect(kedai.every((i) => i.destinationType === 'pickup_point')).toBe(true);
  });
});
