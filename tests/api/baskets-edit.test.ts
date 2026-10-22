/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are arbitrary JSON; tests assert on them */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { draftWeeklyBaskets } from '@/server/modules/baskets/draft';
import { openDueRounds } from '@/server/modules/rounds/open';
import { createTestApp, type TestApp } from './helpers/app';
import { insertParticipation } from './helpers/builders';
import { basketIdOf, basketOf, setupKedaiKopi } from './helpers/scenarios';
import { expectNoMoneyFields } from './helpers/scans';

const KEDAI = seedId('shop', 'KEDAI_KOPI');
const MONDAY_0610 = '2026-11-01T22:10:00Z';
let app: TestApp;
let kedaiBasket: string;

async function start(opts: { cupsAnchor?: string } = {}) {
  app = await createTestApp({ seed: 'reference' });
  if (opts.cupsAnchor) {
    await app.prisma.product.update({
      where: { id: seedId('product', 'CUPS') },
      data: { scheduleAnchorWeek: opts.cupsAnchor },
    });
  }
  await openDueRounds(app.deps);
  app.clock.set(MONDAY_0610);
  await setupKedaiKopi(app);
  await draftWeeklyBaskets(app.deps);
  kedaiBasket = (await basketIdOf('KEDAI_KOPI', '2026-W45'))!;
}
const lineOf = async (key: string) =>
  (await basketOf('KEDAI_KOPI', '2026-W45')).lines.find((l) => l.productKey === key)!;
const currentAs = async (who: Parameters<TestApp['as']>[0]) =>
  (await (await app.as(who)).get(`/api/shops/${KEDAI}/baskets/current`)).body;

afterEach(async () => {
  await app.close();
});

describe('editing the basket', () => {
  beforeEach(async () => {
    await start();
  });

  it('raises the quantity and highlights a staff addition (story 33, C5)', async () => {
    const res = await (
      await app.as('rahim')
    ).post(`/api/baskets/${kedaiBasket}/lines`, {
      productId: seedId('product', 'EM'),
      quantity: 1,
    });
    expect(res.body).toEqual({ basketId: kedaiBasket, week: '2026-W45', routedToNextWeek: false });
    const v = await currentAs('ahSeng');
    expect(v.lines.find((l: any) => l.shortName === 'evaporated milk')).toMatchObject({
      quantity: 1,
      staffAddedQuantity: 1,
      changedBy: { name: 'Rahim', role: 'staff' },
    });
    expect(
      (await app.prisma.notification.findFirstOrThrow({ where: { type: 'basket.staff_added' } }))
        .whatsappText,
    ).toBe("Rahim added 1 carton of evaporated milk to this week's basket.");
    expect(
      await app.prisma.activityLogEntry.count({ where: { action: 'basket.line_added_by_staff' } }),
    ).toBe(1);
    // Adding again raises the existing line.
    await (
      await app.as('rahim')
    ).post(`/api/baskets/${kedaiBasket}/lines`, {
      productId: seedId('product', 'CM'),
      quantity: 2,
    });
    expect(await lineOf('CM')).toMatchObject({ quantity: 8, staffAddedQuantity: 2 });
  });

  it('sends staff additions after payment to next week’s basket (story 98)', async () => {
    await app.prisma.weeklyBasket.update({ where: { id: kedaiBasket }, data: { status: 'paid' } });
    const res = await (
      await app.as('rahim')
    ).post(`/api/baskets/${kedaiBasket}/lines`, {
      productId: seedId('product', 'CM'),
      quantity: 2,
    });
    expect(res.body).toMatchObject({ week: '2026-W46', routedToNextWeek: true });
    const next = await basketOf('KEDAI_KOPI', '2026-W46');
    expect(next).toMatchObject({ status: 'draft', draftedAt: null });
    expect(next.lines).toHaveLength(1);
    expect(next.lines[0]).toMatchObject({
      productKey: 'CM',
      quantity: 2,
      roundId: null,
      staffAddedQuantity: 2,
    });
    expect((await basketOf('KEDAI_KOPI', '2026-W45')).lines).toHaveLength(5);
    expect(
      (await app.prisma.notification.findFirstOrThrow({ where: { type: 'basket.staff_added' } }))
        .whatsappText,
    ).toBe("Rahim added 2 cartons of condensed milk to next week's basket.");
    // The W45 view is still the paid basket; the draft stub is not shown as current.
    expect((await currentAs('ahSeng')).week).toBe('2026-W45');
  });

  it('lets staff change quantities but not limits, removals or fulfilment (story 102)', async () => {
    const line = (await lineOf('CM')).id;
    const r = await app.as('rahim');
    expect(
      (await r.patch(`/api/baskets/${kedaiBasket}/lines/${line}`, { quantity: 3 })).status,
    ).toBe(200);
    expect((await lineOf('CM')).quantity).toBe(3);
    expect(
      (await r.patch(`/api/baskets/${kedaiBasket}/lines/${line}`, { priceLimitSen: 1 })).status,
    ).toBe(403);
    expect(
      (await r.patch(`/api/baskets/${kedaiBasket}/lines/${line}`, { removed: true })).status,
    ).toBe(403);
    expect(
      (await r.patch(`/api/baskets/${kedaiBasket}/fulfilment`, { fulfilment: 'door' })).status,
    ).toBe(403);
    expect(await lineOf('CM')).toMatchObject({ removed: false, quantity: 3 });
  });

  it('lets the owner change quantity, limit and removal, and logs before and after', async () => {
    const line = (await lineOf('OIL')).id;
    const o = await app.as('ahSeng');
    expect(
      (
        await o.patch(`/api/baskets/${kedaiBasket}/lines/${line}`, {
          quantity: 4,
          priceLimitSen: 9000,
        })
      ).status,
    ).toBe(200);
    expect(
      (await o.patch(`/api/baskets/${kedaiBasket}/lines/${line}`, { removed: true })).status,
    ).toBe(200);
    expect(await lineOf('OIL')).toMatchObject({ quantity: 4, priceLimitSen: 9000, removed: true });
    const logs = await app.prisma.activityLogEntry.findMany({
      where: { action: 'basket.line_changed', subjectId: line },
      orderBy: { seq: 'asc' },
    });
    expect(logs).toHaveLength(2);
    expect(logs[0]!.before).toMatchObject({ quantity: 2 });
    expect(logs[0]!.after).toMatchObject({ quantity: 4, priceLimitSen: 9000 });
    expect(
      (await o.patch(`/api/baskets/${kedaiBasket}/lines/${line}`, { quantity: 0 })).status,
    ).toBe(400);
  });

  it('changes fulfilment for the owner only, and refuses a door that is too far', async () => {
    const o = await app.as('ahSeng');
    const res = await o.patch(`/api/baskets/${kedaiBasket}/fulfilment`, {
      fulfilment: 'pickup',
      pickupPointId: seedId('pickup_point', 'PP_KUANTAN'),
    });
    expect(res.status).toBe(200);
    expect(await basketOf('KEDAI_KOPI', '2026-W45')).toMatchObject({
      fulfilment: 'pickup',
      pickupPointId: seedId('pickup_point', 'PP_KUANTAN'),
    });
    await app.prisma.shop.update({ where: { id: KEDAI }, data: { lat: 5.5, lng: 100.9 } });
    const far = await o.patch(`/api/baskets/${kedaiBasket}/fulfilment`, { fulfilment: 'door' });
    expect(far.status).toBe(422);
    expect(JSON.stringify(far.body)).toContain('DOOR_TOO_FAR');
    expect(
      await app.prisma.activityLogEntry.count({ where: { action: 'basket.fulfilment_changed' } }),
    ).toBe(1);
  });

  it('keeps other shops’ baskets out of reach', async () => {
    const res = await (
      await app.as('siti')
    ).post(`/api/baskets/${kedaiBasket}/lines`, {
      productId: seedId('product', 'EM'),
      quantity: 1,
    });
    expect(res.status).toBe(404);
    expect((await (await app.as('siti')).get(`/api/shops/${KEDAI}/baskets/current`)).status).toBe(
      404,
    );
  });

  it('shows staff the basket without any money (story 99)', async () => {
    const body = await currentAs('rahim');
    expect(body.lines.length).toBe(5);
    expectNoMoneyFields(body);
    await (
      await app.as('rahim')
    ).post(`/api/baskets/${kedaiBasket}/lines`, {
      productId: seedId('product', 'EM'),
      quantity: 1,
    });
    const after = await currentAs('rahim');
    expect(after.lines.find((l: any) => l.name.includes('Evaporated'))).toMatchObject({
      quantity: 1,
      addedByMe: true,
      waitingForOwner: true,
    });
    expectNoMoneyFields(after);
  });

  it('shows the owner starting and projected prices and estimated savings (stories 29–31)', async () => {
    const cmRound = await app.prisma.round.findFirstOrThrow({
      where: { productId: seedId('product', 'CM'), status: 'open' },
    });
    await insertParticipation(app.prisma, {
      roundId: cmRound.id,
      shopId: seedId('shop', 'GERAI'),
      quantity: 99,
      unitShippingSen: 100,
    });
    const cm = (await currentAs('ahSeng')).lines.find((l: any) => l.shortName === 'condensed milk');
    expect(cm).toMatchObject({
      quantity: 6,
      startingAllInSen: 16409,
      startingLineSen: 98454,
      projectedAllInSen: 15185,
      estimatedSavingsSen: (16500 - 15185) * 6,
      savingsBasis: 'usual_price',
    });
    expect(cm.explanation).toContain(
      '99 cartons so far. 1 more carton and everyone pays RM 146.00.',
    );
  });

  it('records when the owner first opens the basket (C11)', async () => {
    expect((await basketOf('KEDAI_KOPI', '2026-W45')).firstOpenedAt).toBeNull();
    await currentAs('rahim');
    expect((await basketOf('KEDAI_KOPI', '2026-W45')).firstOpenedAt).toBeNull();
    await currentAs('ahSeng');
    const first = (await basketOf('KEDAI_KOPI', '2026-W45')).firstOpenedAt;
    expect(first).toEqual(new Date(MONDAY_0610));
    app.clock.set('2026-11-02T01:00:00Z');
    const v = await currentAs('ahSeng');
    expect(v).toMatchObject({ week: '2026-W45', status: 'draft', fulfilment: 'pickup' });
    expect(v.pickupPoint.name).toBeTruthy();
    expect(v.totals.totalNowSen).toBeGreaterThan(0);
    expect((await basketOf('KEDAI_KOPI', '2026-W45')).firstOpenedAt).toEqual(first);
  });
});

describe('fortnightly products', () => {
  it('sends a fortnightly product to the week its round closes', async () => {
    await start({ cupsAnchor: '2026-W44' }); // next cut-off is in W46
    expect((await basketOf('KEDAI_KOPI', '2026-W45')).lines.map((l) => l.productKey)).not.toContain(
      'CUPS',
    );
    const res = await (
      await app.as('rahim')
    ).post(`/api/baskets/${kedaiBasket}/lines`, {
      productId: seedId('product', 'CUPS'),
      quantity: 1,
    });
    expect(res.body).toMatchObject({ week: '2026-W46', routedToNextWeek: true });
    expect((await basketOf('KEDAI_KOPI', '2026-W46')).lines[0]).toMatchObject({
      productKey: 'CUPS',
      roundId: null,
    });
  });
});
