import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { simulatedLogistics } from '@/server/adapters/logistics';
import { unitAmounts } from '@/server/engine';
import { basketTotals, deliveryFeeDue } from '@/server/modules/baskets/amounts';
import { draftBasketForShop, draftWeeklyBaskets } from '@/server/modules/baskets/draft';
import { post } from '@/server/modules/ledger/post';
import { openDueRounds } from '@/server/modules/rounds/open';
import { systemCaller } from '@/server/platform/caller';
import { withTransaction } from '@/server/platform/tx';
import { createTestApp, type TestApp } from './helpers/app';
import { insertParticipation } from './helpers/builders';
import { basketIdOf, basketOf, setupKedaiKopi } from './helpers/scenarios';

const WEEK = '2026-W45';
const MONDAY_0600 = '2026-11-01T22:00:00Z';
const GERAI = seedId('shop', 'GERAI');
const KAFE = seedId('shop', 'KAFE');
let app: TestApp;

async function startWeek(opts: { cupsAnchor?: string } = {}) {
  app = await createTestApp({ seed: 'reference' });
  if (opts.cupsAnchor) {
    await app.prisma.product.update({
      where: { id: seedId('product', 'CUPS') },
      data: { scheduleAnchorWeek: opts.cupsAnchor },
    });
  }
  await openDueRounds(app.deps);
}
afterEach(async () => {
  await app.close();
});

describe('drafting weekly baskets', () => {
  beforeEach(async () => {
    await startWeek();
    app.clock.set(MONDAY_0600);
  });

  it('drafts a basket for each shop with a usual list on Monday at 06:00 (story 27)', async () => {
    expect(await draftWeeklyBaskets(app.deps)).toEqual({ drafted: 2, failed: 0 }); // Gerai, Kafe
    const gerai = await basketOf('GERAI', WEEK);
    expect(gerai).toMatchObject({
      status: 'draft',
      deadlineAt: new Date('2026-11-05T12:00:00Z'),
      fulfilment: 'door',
    });
    expect(gerai.lines.map((l) => [l.productKey, l.quantity])).toEqual([
      ['CM', 4],
      ['EM', 2],
      ['FLOUR', 2],
      ['CONT', 3],
    ]);
    expect(gerai.lines.every((l) => l.source === 'usual_list' && l.roundId !== null)).toBe(true);
    const kafe = await basketOf('KAFE', WEEK);
    expect(kafe).toMatchObject({
      fulfilment: 'pickup',
      pickupPointId: seedId('pickup_point', 'PP_KUANTAN'),
    });
  });

  it('keeps drafting the other shops when one shop cannot be drafted', async () => {
    // Gerai delivers to the door, and from the middle of the sea no pickup point is close enough.
    await app.prisma.shop.update({ where: { id: GERAI }, data: { lat: 5.5, lng: 106.5 } });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await draftWeeklyBaskets(app.deps);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining(GERAI), expect.any(String));
    errors.mockRestore();
    expect(res).toEqual({ drafted: 1, failed: 1 });
    expect(await basketIdOf('GERAI', WEEK)).toBeUndefined();
    expect((await basketOf('KAFE', WEEK)).status).toBe('draft');
  });

  it('does nothing before Monday 06:00 or when run twice', async () => {
    app.clock.set('2026-11-01T21:59:00Z');
    expect(await draftWeeklyBaskets(app.deps)).toEqual({ drafted: 0, failed: 0 });
    expect(await app.prisma.weeklyBasket.count()).toBe(0);
    app.clock.set(MONDAY_0600);
    await draftWeeklyBaskets(app.deps);
    expect(await draftWeeklyBaskets(app.deps)).toEqual({ drafted: 0, failed: 0 });
    expect(await app.prisma.weeklyBasket.count()).toBe(2);
  });

  it('leaves background shops out', async () => {
    await draftWeeklyBaskets(app.deps);
    const baskets = await app.prisma.weeklyBasket.findMany({ include: { shop: true } });
    expect(baskets).toHaveLength(2);
    expect(baskets.every((b) => !b.shop.isBackground)).toBe(true);
  });

  it('asks the owner to approve, and logs and announces the draft', async () => {
    await draftWeeklyBaskets(app.deps);
    const gerai = await basketOf('GERAI', WEEK);
    expect(gerai.draftedAt).toEqual(new Date(MONDAY_0600));
    const approval = await app.prisma.approvalRequest.findUniqueOrThrow({
      where: { id: gerai.approvalRequestId! },
    });
    expect(approval).toMatchObject({
      type: 'weekly_basket',
      subjectId: gerai.id,
      assigneeRole: 'owner',
      status: 'pending',
      shopId: GERAI,
    });
    const totals = await basketTotals(app.prisma, gerai.id, new Date(MONDAY_0600));
    expect(approval.amountSen).toBe(totals.totalNowSen);

    const log = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'basket.drafted', subjectId: gerai.id },
    });
    expect(log.actorType).toBe('system');
    const events = await app.prisma.integrationEvent.findMany({
      where: { type: 'basket.drafted' },
    });
    expect(events.map((e) => e.data)).toContainEqual({
      basketId: gerai.id,
      shopId: GERAI,
      week: WEEK,
      lineCount: 4,
    });
  });

  it('tells the owner the amount now and the estimate', async () => {
    await draftWeeklyBaskets(app.deps);
    const n = await app.prisma.notification.findFirstOrThrow({
      where: { type: 'basket.ready', userId: seedId('user', 'mei') },
    });
    expect(n.whatsappText).toMatch(
      /^Your Kongsi basket for this week is ready: 4 items, RM [\d,.]+ now, about RM [\d,.]+ after cut-off\. Approve by Thu 8 pm\.$/,
    );
    const staff = await app.prisma.notification.count({
      where: { type: 'basket.ready', userId: seedId('user', 'danial') },
    });
    expect(staff).toBe(0);
  });

  it('leaves a basket that is no longer a draft alone', async () => {
    await draftWeeklyBaskets(app.deps);
    const gerai = await basketOf('GERAI', WEEK);
    await app.prisma.weeklyBasket.update({ where: { id: gerai.id }, data: { status: 'skipped' } });
    const res = await withTransaction(app.deps, systemCaller('test'), (ctx) =>
      draftBasketForShop(ctx, GERAI, WEEK),
    );
    expect(res).toEqual({ basketId: gerai.id, created: false });
    expect((await basketOf('GERAI', WEEK)).status).toBe('skipped');
  });
});

describe('what goes into the basket', () => {
  it('leaves out products whose round does not close this week (story 28)', async () => {
    await startWeek({ cupsAnchor: '2026-W44' }); // fortnightly: the next cut-off is in W46
    app.clock.set(MONDAY_0600);
    await draftWeeklyBaskets(app.deps);
    const kafe = await basketOf('KAFE', WEEK);
    expect(kafe.lines.map((l) => l.productKey)).toEqual(['CM', 'COFFEE', 'EGG_B']);
  });

  it('writes no basket for a shop none of whose products close this week', async () => {
    await startWeek();
    await app.prisma.round.updateMany({ data: { cutoffAt: new Date('2026-11-12T12:00:00Z') } });
    app.clock.set(MONDAY_0600);
    expect(await draftWeeklyBaskets(app.deps)).toEqual({ drafted: 0, failed: 0 });
    expect(await basketIdOf('GERAI', WEEK)).toBeUndefined();
  });

  it('merges staff additions into the draft and keeps them highlighted', async () => {
    await startWeek();
    // Staff added one more CM (already on the usual list) and two OIL (not on it).
    const basket = await app.prisma.weeklyBasket.create({
      data: {
        shopId: GERAI,
        basketWeek: WEEK,
        status: 'draft',
        deadlineAt: new Date('2026-11-05T12:00:00Z'),
        fulfilment: 'door',
        lines: {
          create: [
            {
              productId: seedId('product', 'CM'),
              roundId: null,
              quantity: 1,
              staffAddedQuantity: 1,
              source: 'staff',
              removed: false,
            },
            {
              productId: seedId('product', 'OIL'),
              roundId: null,
              quantity: 2,
              staffAddedQuantity: 2,
              source: 'staff',
              removed: false,
            },
          ],
        },
      },
    });
    app.clock.set(MONDAY_0600);
    expect(await draftWeeklyBaskets(app.deps)).toEqual({ drafted: 2, failed: 0 });

    const merged = await basketOf('GERAI', WEEK);
    expect(merged.id).toBe(basket.id);
    expect(merged.draftedAt).not.toBeNull();
    const by = Object.fromEntries(merged.lines.map((l) => [l.productKey, l]));
    expect(by.CM).toMatchObject({ quantity: 5, staffAddedQuantity: 1, source: 'staff' });
    expect(by.OIL).toMatchObject({ quantity: 2, staffAddedQuantity: 2, source: 'staff' });
    expect(by.OIL!.roundId).not.toBeNull();
    expect(by.EM).toMatchObject({ quantity: 2, staffAddedQuantity: 0, source: 'usual_list' });
    expect(merged.lines).toHaveLength(5);
  });

  it('drafts this week’s basket as soon as setup saves the usual list (story 9)', async () => {
    await startWeek();
    app.clock.set('2026-11-01T22:10:00Z');
    await setupKedaiKopi(app);
    const basket = await basketOf('KEDAI_KOPI', WEEK);
    expect(basket.status).toBe('draft');
    expect(basket.lines.map((l) => [l.productKey, l.quantity])).toEqual([
      ['CM', 6],
      ['OIL', 2],
      ['COFFEE', 1],
      ['EGG_A', 10],
      ['CUPS', 2],
    ]);
    expect(basket.pickupPointId).toBe(seedId('pickup_point', 'PP_IPOH'));
    const notices = await app.prisma.notification.count({
      where: { type: 'basket.ready', userId: seedId('user', 'ahSeng') },
    });
    expect(notices).toBe(1);
  });

  it('does not draft a second time when the list is saved again', async () => {
    await startWeek();
    app.clock.set('2026-11-01T22:10:00Z');
    await setupKedaiKopi(app);
    await setupKedaiKopi(app);
    const kedai = seedId('shop', 'KEDAI_KOPI');
    expect(await app.prisma.weeklyBasket.count({ where: { shopId: kedai } })).toBe(1);
    expect(await app.prisma.activityLogEntry.count({ where: { action: 'basket.drafted' } })).toBe(
      1,
    );
  });
});

describe('basket totals', () => {
  const at = new Date(MONDAY_0600);
  beforeEach(async () => {
    await startWeek();
    app.clock.set(MONDAY_0600);
    await draftWeeklyBaskets(app.deps);
  });

  it('adds up starting prices and a door delivery fee for Gerai', async () => {
    const id = (await basketIdOf('GERAI', WEEK))!;
    const t = await basketTotals(app.prisma, id, at);
    expect([800, 1200, 1800]).toContain(t.deliveryFeeSen);
    expect(t.totalNowSen).toBe(t.itemsAtStartingSen + t.deliveryFeeSen);
    expect(t.feeIncludedSen).toBeGreaterThan(0);
    expect(t).toMatchObject({ balanceAvailableSen: 0, balanceAppliedSen: 0 });
    expect(t.payNowSen).toBe(t.totalNowSen);
    // Nobody else has joined, so no tier is reached yet: the estimate is the starting price.
    expect(t.estimatedAfterCutoffSen).toBe(t.totalNowSen);
    expect(t.savingsHasBuyAloneBasis).toBe(false);
  });

  it('prices Kafe’s lines at tier 1 with the fee and shipping, with no delivery fee', async () => {
    const id = (await basketIdOf('KAFE', WEEK))!;
    const t = await basketTotals(app.prisma, id, at);
    expect(t.deliveryFeeSen).toBe(0);

    let items = 0;
    let fees = 0;
    const kuantan = await app.prisma.pickupPoint.findUniqueOrThrow({
      where: { id: seedId('pickup_point', 'PP_KUANTAN') },
    });
    for (const line of (await basketOf('KAFE', WEEK)).lines) {
      const round = await app.prisma.round.findUniqueOrThrow({
        where: { id: line.roundId! },
        include: { hub: true },
      });
      const tier1 = (round.tiersSnapshot as { unitPriceSen: number }[])[0]!.unitPriceSen;
      const shipping = simulatedLogistics.quoteShipping({
        hub: round.hub,
        pickupPoint: kuantan,
        unitWeightGrams: round.unitWeightGrams,
      }).unitShippingSen;
      const unit = unitAmounts(tier1, round.feeBps, shipping);
      items += unit.allInSen * line.quantity;
      fees += unit.feeSen * line.quantity;
    }
    expect(t.itemsAtStartingSen).toBe(items);
    expect(t.feeIncludedSen).toBe(fees);
    // CM alone: RM 158.00 + RM 3.16 fee + RM 4.29 shipping (19.5 kg at 22 sen/kg) = RM 165.45.
    expect(unitAmounts(15800, 200, 429).allInSen).toBe(16545);
  });

  it('uses the balance first and never more than the total', async () => {
    await withTransaction(app.deps, systemCaller('test'), (ctx) =>
      post(ctx, {
        from: { kind: 'partner_cash' },
        to: { kind: 'shop_balance', shopId: KAFE },
        amountSen: 1_000,
        kind: 'refund_failed',
      }),
    );
    const id = (await basketIdOf('KAFE', WEEK))!;
    const t = await basketTotals(app.prisma, id, at);
    expect(t).toMatchObject({ balanceAvailableSen: 1_000, balanceAppliedSen: 1_000 });
    expect(t.payNowSen).toBe(t.totalNowSen - 1_000);
  });

  it('drops lines whose round has closed by the given time', async () => {
    const id = (await basketIdOf('KAFE', WEEK))!;
    const t = await basketTotals(app.prisma, id, new Date('2026-11-05T12:00:00Z'));
    expect(t.totalNowSen).toBe(0);
  });

  it('charges the door delivery fee once per shop and date', async () => {
    const id = (await basketIdOf('GERAI', WEEK))!;
    const date = '2026-11-10';
    expect(await deliveryFeeDue(app.prisma, GERAI, date)).toBe(true);

    // Another pending payment carrying the fee for that date does not take it off this one: if
    // that payment fails the fee would be lost (a duplicate is refunded when both succeed).
    const oil = await app.prisma.round.findFirstOrThrow({
      where: { productId: seedId('product', 'OIL') },
    });
    const part = await insertParticipation(app.prisma, {
      roundId: oil.id,
      shopId: GERAI,
      quantity: 1,
      unitShippingSen: 100,
    });
    await app.prisma.payment.update({
      where: { id: part.paymentId },
      data: { status: 'pending', deliveryFeeSen: 800, deliveryFeeDates: [date] },
    });
    await app.prisma.paymentLine.update({
      where: { id: part.paymentLineId },
      data: { deliveryDate: date },
    });
    expect(await deliveryFeeDue(app.prisma, GERAI, date)).toBe(true);
    expect((await basketTotals(app.prisma, id, at)).deliveryFeeSen).toBe(1200);

    // A held charge keeps the fee off later payments; a refunded one does not.
    await app.prisma.deliveryFeeCharge.create({
      data: {
        shopId: GERAI,
        deliveryDate: date,
        amountSen: 800,
        paymentId: part.paymentId,
        status: 'held',
      },
    });
    expect(await deliveryFeeDue(app.prisma, GERAI, date)).toBe(false);
    expect((await basketTotals(app.prisma, id, at)).deliveryFeeSen).toBe(0);
    await app.prisma.deliveryFeeCharge.update({
      where: { shopId_deliveryDate: { shopId: GERAI, deliveryDate: date } },
      data: { status: 'refunded' },
    });
    expect(await deliveryFeeDue(app.prisma, GERAI, date)).toBe(true);
    expect((await basketTotals(app.prisma, id, at)).deliveryFeeSen).toBe(1200);
  });
});
