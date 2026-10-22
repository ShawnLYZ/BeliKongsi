import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { draftWeeklyBaskets } from '@/server/modules/baskets/draft';
import { accountKey, balanceOf } from '@/server/modules/ledger/accounts';
import { runMoneyChecks } from '@/server/modules/ledger/checks';
import { post } from '@/server/modules/ledger/post';
import { runDueJobs } from '@/server/modules/jobs/run';
import { cancelParticipation } from '@/server/modules/payments/cancel';
import { createPayment } from '@/server/modules/payments/create';
import { joinRound } from '@/server/modules/payments/join';
import { openDueRounds } from '@/server/modules/rounds/open';
import { personCaller, systemCaller } from '@/server/platform/caller';
import { withTransaction } from '@/server/platform/tx';
import { createTestApp, type Client, type TestApp } from './helpers/app';
import { basketIdOf, participationOf, payBasket, setupKedaiKopi } from './helpers/scenarios';
import { session } from './helpers/sessions';

const KEDAI = seedId('shop', 'KEDAI_KOPI');
const GERAI = seedId('shop', 'GERAI');
const MONDAY_0610 = '2026-11-01T22:10:00Z';
const DOOR_DATE = '2026-11-10';
const WEEK = '2026-W45';
const feeHold = { kind: 'delivery_fee_hold', shopId: GERAI, deliveryDate: DOOR_DATE } as const;

let app: TestApp;
let ah: Client;
let cmRound: string;

const roundIdOf = async (key: string) =>
  (
    await app.prisma.round.findFirstOrThrow({
      where: { productId: seedId('product', key), status: 'open' },
    })
  ).id;
const join = (client: Client, roundId: string, body: object) =>
  client.post(`/api/rounds/${roundId}/participations`, body);
const pay = async (client: Client, summary: { paymentId: string }) => {
  const res = await client.post(`/api/payments/${summary.paymentId}/simulate`, {
    outcome: 'succeeded',
    method: 'duitnow_qr',
  });
  expect(res.status).toBe(200);
};
const joinAndPay = async (client: Client, roundId: string, body: object) => {
  const res = await join(client, roundId, body);
  expect(res.status).toBe(200);
  await pay(client, res.body);
  return res.body;
};
const logCount = (action: string) =>
  app.prisma.activityLogEntry.count({ where: { action: action as never } });
const moneyOk = async () => expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
const chargeOf = () =>
  app.prisma.deliveryFeeCharge.findUniqueOrThrow({
    where: { shopId_deliveryDate: { shopId: GERAI, deliveryDate: DOOR_DATE } },
  });

beforeEach(async () => {
  app = await createTestApp({ seed: 'reference' });
  await openDueRounds(app.deps);
  app.clock.set(MONDAY_0610);
  await setupKedaiKopi(app);
  cmRound = await roundIdOf('CM');
  ah = await app.as('ahSeng');
});

afterEach(async () => {
  await app.close();
});

describe('joining from the catalogue', () => {
  it('joins a round from the catalogue at the starting price (story 46)', async () => {
    const mei = await app.as('mei');
    const res = await join(mei, cmRound, { quantity: 2 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      linesTotalSen: 2 * 16545,
      deliveryFeeSen: 0,
      totalSen: 2 * 16545,
      balanceAppliedSen: 0,
      externalSen: 2 * 16545,
      status: 'pending',
      checkoutUrl: `/checkout/${res.body.paymentId}`,
    });
    // Nothing is joined or posted until the simulated checkout succeeds.
    expect(await app.prisma.participation.count()).toBe(0);
    expect(await app.prisma.ledgerPosting.count()).toBe(0);

    await pay(mei, res.body);
    expect(await participationOf('KAFE', 'CM')).toMatchObject({
      quantity: 2,
      paidSen: 2 * 16545,
      source: 'catalogue',
      status: 'active',
      roundId: cmRound,
    });
    expect(await balanceOf(app.prisma, { kind: 'round_hold', roundId: cmRound })).toBe(2 * 16545);
    const payment = await app.prisma.payment.findUniqueOrThrow({
      where: { id: res.body.paymentId },
    });
    expect(payment.purpose).toBe('join');
    await moneyOk();
  });

  it('uses the round cut-off as the deadline and the shop default destination', async () => {
    const res = await join(ah, cmRound, { quantity: 1 });
    const p = await app.prisma.payment.findUniqueOrThrow({ where: { id: res.body.paymentId } });
    expect(p.deadlineAt).toEqual(new Date('2026-11-05T12:00:00Z'));
    await pay(ah, res.body);
    expect(await participationOf('KEDAI_KOPI', 'CM')).toMatchObject({
      destinationType: 'pickup_point',
      pickupPointId: seedId('pickup_point', 'PP_IPOH'),
    });
  });

  it('refuses a closed round and a bad body', async () => {
    expect((await join(ah, cmRound, { quantity: 0 })).status).toBe(400);
    expect((await join(ah, cmRound, { quantity: 1.5 })).status).toBe(400);
    expect((await join(ah, seedId('shop', 'GERAI'), { quantity: 1 })).status).toBe(404);
    app.clock.set('2026-11-05T12:00:00Z');
    const late = await join(ah, cmRound, { quantity: 1 });
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('ROUND_CLOSED');
    app.clock.set(MONDAY_0610);
    await app.prisma.round.update({ where: { id: cmRound }, data: { status: 'failed' } });
    expect((await join(ah, cmRound, { quantity: 1 })).status).toBe(409);
    expect(await app.prisma.payment.count()).toBe(0);
  });

  it('charges one delivery fee per door delivery date (PRD §6.9, review focus 5)', async () => {
    await draftWeeklyBaskets(app.deps);
    const siti = await app.as('siti');
    const paid = await payBasket(app, 'siti', (await basketIdOf('GERAI', WEEK))!);
    expect(paid).toMatchObject({ status: 'succeeded', deliveryFeeSen: 1200 });
    expect(await chargeOf()).toMatchObject({ amountSen: 1200, status: 'held' });

    const res = await join(siti, await roundIdOf('OIL'), {
      quantity: 1,
      destination: { type: 'door' },
    });
    expect(res.status).toBe(200);
    expect(res.body.deliveryFeeSen).toBe(0);
    expect(res.body.totalSen).toBe(res.body.linesTotalSen);
    await pay(siti, res.body);
    expect(await balanceOf(app.prisma, feeHold)).toBe(1200);
    await moneyOk();
  });

  it('takes the fee once when two door payments are in flight, refunding the duplicate', async () => {
    const siti = await app.as('siti');
    const door = { type: 'door' };
    const a = await join(siti, cmRound, { quantity: 1, destination: door });
    const b = await join(siti, await roundIdOf('OIL'), { quantity: 1, destination: door });
    expect(a.body.deliveryFeeSen).toBe(1200);
    expect(b.body.deliveryFeeSen).toBe(1200);
    await pay(siti, a.body);
    await pay(siti, b.body);
    expect(await balanceOf(app.prisma, feeHold)).toBe(1200);
    expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: GERAI })).toBe(1200);
    await moneyOk();
  });

  it('works with a system caller and opts.shopId inside one outer transaction (the seed)', async () => {
    const caller = systemCaller('seed');
    const summary = await withTransaction(app.deps, caller, async (ctx) => {
      const s = await joinRound(
        app.deps,
        caller,
        cmRound,
        { quantity: 3 },
        { shopId: KEDAI, source: 'background_seed', settleImmediatelyWith: 'fpx' },
      );
      // Visible to the same transaction before it commits.
      expect(await ctx.tx.participation.count()).toBe(1);
      return s;
    });
    expect(summary).toMatchObject({ status: 'succeeded', linesTotalSen: 3 * 16409 });
    expect(await participationOf('KEDAI_KOPI', 'CM')).toMatchObject({
      source: 'background_seed',
      paidSen: 3 * 16409,
      quantity: 3,
      destinationType: 'pickup_point',
    });
    expect((await app.prisma.payment.findFirstOrThrow({ where: { shopId: KEDAI } })).method).toBe(
      'fpx',
    );
    await moneyOk();
  });

  it('tells the owner a failed join did not join the Kongsi', async () => {
    const res = await join(ah, cmRound, { quantity: 1 });
    const failed = await ah.post(`/api/payments/${res.body.paymentId}/simulate`, {
      outcome: 'failed',
      method: 'duitnow_qr',
    });
    expect(failed.status).toBe(200);
    const n = await app.prisma.notification.findFirstOrThrow({ where: { type: 'payment.failed' } });
    expect(n.whatsappText).toBe(
      "Payment failed (simulated). You haven't joined the condensed milk Kongsi. Tap to try again.",
    );
    expect(n.link).toBe('/owner/rounds');
  });

  it('keeps joining to owners', async () => {
    expect((await join(await app.as('rahim'), cmRound, { quantity: 1 })).status).toBe(403);
    expect((await join(await app.as('nadia'), cmRound, { quantity: 1 })).status).toBe(403);
    expect(await app.prisma.payment.count()).toBe(0);
  });
});

describe('cancelling before cut-off', () => {
  let cmPart: string;
  beforeEach(async () => {
    await draftWeeklyBaskets(app.deps);
    await payBasket(app, 'ahSeng', (await basketIdOf('KEDAI_KOPI', WEEK))!);
    cmPart = (await participationOf('KEDAI_KOPI', 'CM')).id;
  });

  it('refunds a cancelled line in full before cut-off (story 57)', async () => {
    const r = await ah.post(`/api/participations/${cmPart}/cancel`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ refundSen: 98454, deliveryFeeRefundSen: 0 });
    expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KEDAI })).toBe(98454);
    expect(await balanceOf(app.prisma, { kind: 'round_hold', roundId: cmRound })).toBe(0);
    expect(
      await app.prisma.participation.findUniqueOrThrow({ where: { id: cmPart } }),
    ).toMatchObject({ status: 'cancelled', paidSen: 98454 });

    const posting = await app.prisma.ledgerPosting.findFirstOrThrow({
      where: { kind: 'refund_cancelled' },
      include: { fromAccount: true, toAccount: true },
    });
    expect(posting).toMatchObject({
      amountSen: 98454,
      participationId: cmPart,
      roundId: cmRound,
      shopId: KEDAI,
    });
    expect([posting.fromAccount.key, posting.toAccount.key]).toEqual([
      accountKey({ kind: 'round_hold', roundId: cmRound }),
      accountKey({ kind: 'shop_balance', shopId: KEDAI }),
    ]);
    expect(await logCount('participation.cancelled')).toBe(1);
    expect(await logCount('refund.issued')).toBe(1);
    const events = await app.prisma.integrationEvent.findMany({
      where: { type: { in: ['participation.cancelled', 'refund.issued'] } },
      orderBy: { seq: 'asc' },
    });
    expect(events.map((e) => e.type)).toEqual(['participation.cancelled', 'refund.issued']);
    expect(events[1]!.data).toEqual({
      shopId: KEDAI,
      amountSen: 98454,
      kind: 'full',
      referenceId: cmPart,
    });
    const note = await app.prisma.notification.findFirstOrThrow({
      where: { type: 'participation.cancelled' },
    });
    expect(note.body).toBe(
      'Cancelled: 6 cartons of condensed milk. RM 984.54 is back in your balance.',
    );
    expect(note.link).toBe('/owner/kongsi');
    await moneyOk();
  });

  it('lists the owner’s lines on My Kongsi, cancellable until cut-off', async () => {
    const mine = async (status: 'active' | 'history') => {
      const res = await ah.get(`/api/shops/${KEDAI}/participations?status=${status}`);
      expect(res.status).toBe(200);
      return res.body.items as { participationId: string; status: string }[];
    };
    const lines = await mine('active');
    expect(lines).toHaveLength(5);
    expect(lines.find((l) => l.participationId === cmPart)).toMatchObject({
      productName: expect.stringContaining('condensed milk'),
      quantity: 6,
      paidSen: 98454,
      status: 'active',
    });
    await ah.post(`/api/participations/${cmPart}/cancel`);
    // A cancelled line leaves the active lines for the history, with its full refund.
    expect((await mine('active')).map((l) => l.participationId)).not.toContain(cmPart);
    expect((await mine('history')).find((l) => l.participationId === cmPart)).toMatchObject({
      status: 'cancelled',
      refundSen: 98454,
    });
    // (After the cut-off no line can be cancelled: see 'refuses to cancel after cut-off'.)
    // Staff see no money, so not the lines either.
    const rahim = await app.as('rahim');
    expect((await rahim.get(`/api/shops/${KEDAI}/participations?status=active`)).status).toBe(403);
  });

  it('cannot cancel twice', async () => {
    expect((await ah.post(`/api/participations/${cmPart}/cancel`)).status).toBe(200);
    expect((await ah.post(`/api/participations/${cmPart}/cancel`)).status).toBe(409);
    expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KEDAI })).toBe(98454);
  });

  it('refuses to cancel after cut-off', async () => {
    app.clock.set('2026-11-05T12:00:01Z');
    const r = await ah.post(`/api/participations/${cmPart}/cancel`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('ROUND_CLOSED');
    expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KEDAI })).toBe(0);
  });

  it('keeps cancelling to the owner of that shop', async () => {
    const post = async (key: Parameters<typeof app.as>[0], id = cmPart) =>
      (await (await app.as(key)).post(`/api/participations/${id}/cancel`)).status;
    expect(await post('rahim')).toBe(403);
    expect(await post('nadia')).toBe(403);
    expect(await post('siti')).toBe(404);
    expect(await post('ahSeng', GERAI)).toBe(404);
    expect(await post('ahSeng', 'not-an-id')).toBe(404);
    expect(
      (await app.prisma.participation.findUniqueOrThrow({ where: { id: cmPart } })).status,
    ).toBe('active');
  });

  it('works with a system caller inside an outer transaction', async () => {
    const caller = systemCaller('test');
    const r = await withTransaction(app.deps, caller, () =>
      cancelParticipation(app.deps, caller, cmPart),
    );
    expect(r).toEqual({ refundSen: 98454, deliveryFeeRefundSen: 0 });
  });
});

describe('cancelling door lines and the delivery fee', () => {
  it('refunds the delivery fee when the last door line for that date is cancelled', async () => {
    await draftWeeklyBaskets(app.deps);
    await payBasket(app, 'siti', (await basketIdOf('GERAI', WEEK))!);
    const parts = await app.prisma.participation.findMany({
      where: { shopId: GERAI },
      orderBy: { id: 'asc' },
    });
    // All four of Gerai's lines are door lines for the same delivery date.
    expect(parts).toHaveLength(4);
    expect(parts.every((p) => p.destinationType === 'door' && p.deliveryDate === DOOR_DATE)).toBe(
      true,
    );
    const siti = await app.as('siti');
    const fees = [];
    for (const p of parts) {
      const r = await siti.post(`/api/participations/${p.id}/cancel`);
      expect(r.status).toBe(200);
      expect(r.body.refundSen).toBe(p.paidSen);
      fees.push(r.body.deliveryFeeRefundSen);
    }
    expect(fees).toEqual([0, 0, 0, 1200]);
    expect(await balanceOf(app.prisma, feeHold)).toBe(0);
    const total = parts.reduce((s, p) => s + p.paidSen, 0);
    expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: GERAI })).toBe(total + 1200);
    expect((await chargeOf()).status).toBe('refunded');
    const feePosting = await app.prisma.ledgerPosting.findFirstOrThrow({
      where: { kind: 'refund_delivery_fee' },
    });
    expect(feePosting.amountSen).toBe(1200);
    const events = await app.prisma.integrationEvent.findMany({
      where: { type: 'refund.issued' },
      orderBy: { seq: 'asc' },
    });
    expect(events).toHaveLength(5);
    expect(events.map((e) => (e.data as { kind: string }).kind).sort()).toEqual([
      'delivery_fee',
      'full',
      'full',
      'full',
      'full',
    ]);
    expect(
      events.find((e) => (e.data as { kind: string }).kind === 'delivery_fee')!.data,
    ).toMatchObject({
      shopId: GERAI,
      amountSen: 1200,
    });
    await moneyOk();

    // The refunded fee row is charged again by a later door payment.
    const again = await join(siti, cmRound, { quantity: 1, destination: { type: 'door' } });
    expect(again.body.deliveryFeeSen).toBe(1200);
  });

  it('keeps the fee while another door line for the date remains', async () => {
    const siti = await app.as('siti');
    const door = { type: 'door' };
    const a = await joinAndPay(siti, cmRound, { quantity: 1, destination: door });
    await joinAndPay(siti, await roundIdOf('OIL'), { quantity: 1, destination: door });
    expect(a.deliveryFeeSen).toBe(1200);
    const first = await participationOf('GERAI', 'CM');
    const r = await siti.post(`/api/participations/${first.id}/cancel`);
    expect(r.body.deliveryFeeRefundSen).toBe(0);
    expect((await chargeOf()).status).toBe('held');
    await moneyOk();
  });

  describe('a pending door payment keeps the fee (review fix)', () => {
    /** Steps 1 to 3: Gerai pays its basket, Siti starts an OIL door join, then cancels all four. */
    async function upToCancelAll() {
      await draftWeeklyBaskets(app.deps);
      await payBasket(app, 'siti', (await basketIdOf('GERAI', WEEK))!);
      const siti = await app.as('siti');
      const oil = await join(siti, await roundIdOf('OIL'), {
        quantity: 1,
        destination: { type: 'door' },
      });
      expect(oil.body).toMatchObject({ status: 'pending', deliveryFeeSen: 0 });
      const parts = await app.prisma.participation.findMany({
        where: { shopId: GERAI },
        orderBy: { id: 'asc' },
      });
      const fees = [];
      for (const p of parts) {
        fees.push(
          (await siti.post(`/api/participations/${p.id}/cancel`)).body.deliveryFeeRefundSen,
        );
      }
      return { siti, oil: oil.body, fees, parts };
    }

    it('keeps the fee held, so the pending payment that settles later is covered', async () => {
      const { siti, oil, fees } = await upToCancelAll();
      expect(fees).toEqual([0, 0, 0, 0]);
      expect((await chargeOf()).status).toBe('held');
      expect(await balanceOf(app.prisma, feeHold)).toBe(1200);
      await pay(siti, oil);
      expect(await balanceOf(app.prisma, feeHold)).toBe(1200);
      expect((await chargeOf()).status).toBe('held');
      await moneyOk();
      // Cancelling that last door line now returns the fee.
      const last = await participationOf('GERAI', 'OIL');
      const r = await siti.post(`/api/participations/${last.id}/cancel`);
      expect(r.body.deliveryFeeRefundSen).toBe(1200);
      expect(await balanceOf(app.prisma, feeHold)).toBe(0);
      await moneyOk();
    });

    it('refunds the fee when that pending payment then fails', async () => {
      const { siti, oil, parts } = await upToCancelAll();
      const res = await siti.post(`/api/payments/${oil.paymentId}/simulate`, {
        outcome: 'failed',
        method: 'duitnow_qr',
      });
      expect(res.status).toBe(200);
      expect((await chargeOf()).status).toBe('refunded');
      expect(await balanceOf(app.prisma, feeHold)).toBe(0);
      const total = parts.reduce((s, p) => s + p.paidSen, 0);
      expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: GERAI })).toBe(
        total + 1200,
      );
      await moneyOk();
    });

    it('refunds the fee when that pending payment is voided after the deadline', async () => {
      const { siti, oil } = await upToCancelAll();
      app.clock.set('2026-11-05T12:00:01Z');
      const res = await siti.post(`/api/payments/${oil.paymentId}/simulate`, {
        outcome: 'succeeded',
        method: 'duitnow_qr',
      });
      expect(res.status).toBe(409);
      expect((await chargeOf()).status).toBe('refunded');
      expect(await balanceOf(app.prisma, feeHold)).toBe(0);
      await moneyOk();
    });
  });
});

describe('abandoned catalogue checkouts (final review fix)', () => {
  const AFTER_CUTOFF = '2026-11-05T12:00:01Z';
  const kedaiBalance = { kind: 'shop_balance', shopId: KEDAI } as const;
  const giveKedai = (amountSen: number) =>
    withTransaction(app.deps, systemCaller('test balance'), (ctx) =>
      post(ctx, {
        from: { kind: 'partner_cash' },
        to: kedaiBalance,
        amountSen,
        kind: 'refund_cancelled',
        refs: { shopId: KEDAI },
      }),
    );
  const statusOf = async (paymentId: string) =>
    (await app.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status;
  const reservedSen = async () =>
    (
      await app.prisma.payment.aggregate({
        where: { shopId: KEDAI, status: 'pending' },
        _sum: { balanceAppliedSen: true },
      })
    )._sum.balanceAppliedSen ?? 0;
  /** Gerai pays its door basket, starts an OIL door join, then cancels all four basket lines. */
  async function pendingDoorJoinKeepsFee(opts: { deadlineAt?: string } = {}) {
    await draftWeeklyBaskets(app.deps);
    await payBasket(app, 'siti', (await basketIdOf('GERAI', WEEK))!);
    const siti = await app.as('siti');
    const oil = await join(siti, await roundIdOf('OIL'), {
      quantity: 1,
      destination: { type: 'door' },
    });
    expect(oil.body.status).toBe('pending');
    if (opts.deadlineAt) {
      await app.prisma.payment.update({
        where: { id: oil.body.paymentId },
        data: { deadlineAt: new Date(opts.deadlineAt) },
      });
      app.clock.set(opts.deadlineAt);
    }
    const parts = await app.prisma.participation.findMany({
      where: { shopId: GERAI },
      orderBy: { id: 'asc' },
    });
    const fees = [];
    for (const p of parts) {
      fees.push((await siti.post(`/api/participations/${p.id}/cancel`)).body.deliveryFeeRefundSen);
    }
    return { oil: oil.body, parts, fees };
  }

  it('voids an abandoned join after its deadline and frees the balance it reserved', async () => {
    await giveKedai(5000);
    const res = await join(ah, cmRound, { quantity: 1 });
    expect(res.body).toMatchObject({ status: 'pending', balanceAppliedSen: 5000 });
    expect(await reservedSen()).toBe(5000);

    app.clock.set(AFTER_CUTOFF);
    const report = await runDueJobs(app.deps);
    expect(report.voidedPayments).toBe(1);
    expect(await statusOf(res.body.paymentId)).toBe('voided');
    expect(await logCount('payment.voided')).toBe(1);
    expect(await reservedSen()).toBe(0);
    // Nothing moved: the balance is still the shop's.
    expect(await balanceOf(app.prisma, kedaiBalance)).toBe(5000);
    expect(await app.prisma.ledgerPosting.count({ where: { paymentId: res.body.paymentId } })).toBe(
      0,
    );
    await moneyOk();
    expect((await runDueJobs(app.deps)).voidedPayments).toBe(0);
  });

  it('does not reserve the balance for a pending payment past its deadline', async () => {
    await giveKedai(5000);
    const caller = personCaller(session('ahSeng', 'owner', { shopId: KEDAI }, 'shop'));
    const early = await withTransaction(app.deps, caller, (ctx) =>
      createPayment(ctx, {
        shopId: KEDAI,
        purpose: 'join',
        lines: [
          {
            productId: seedId('product', 'CM'),
            roundId: cmRound,
            quantity: 1,
            priceLimitSen: null,
            destination: { type: 'pickup_point', pickupPointId: seedId('pickup_point', 'PP_IPOH') },
          },
        ],
        deadlineAt: new Date('2026-11-02T00:00:00Z'),
        source: 'catalogue',
      }),
    );
    expect(early).toMatchObject({ status: 'pending', balanceAppliedSen: 5000 });
    app.clock.set('2026-11-02T00:00:00Z');
    // Before any job voids it, a new payment can already use the balance.
    const oil = await join(ah, await roundIdOf('OIL'), { quantity: 1 });
    expect(oil.body).toMatchObject({ status: 'pending', balanceAppliedSen: 5000 });
    app.clock.set('2026-11-02T00:00:01Z');
    expect((await runDueJobs(app.deps)).voidedPayments).toBe(1);
    expect(await statusOf(early.paymentId)).toBe('voided');
    await pay(ah, oil.body);
    expect(await balanceOf(app.prisma, kedaiBalance)).toBe(0);
    await moneyOk();
  });

  it('gives back a fee held only for an abandoned door join once it is voided', async () => {
    const { oil, parts, fees } = await pendingDoorJoinKeepsFee();
    expect(fees).toEqual([0, 0, 0, 0]);
    expect((await chargeOf()).status).toBe('held');

    app.clock.set(AFTER_CUTOFF);
    expect((await runDueJobs(app.deps)).voidedPayments).toBe(1);
    expect(await statusOf(oil.paymentId)).toBe('voided');
    expect((await chargeOf()).status).toBe('refunded');
    expect(await balanceOf(app.prisma, feeHold)).toBe(0);
    const total = parts.reduce((s, p) => s + p.paidSen, 0);
    expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: GERAI })).toBe(total + 1200);
    await moneyOk();
  });

  it('does not let a pending door join past its deadline keep the fee', async () => {
    const { fees } = await pendingDoorJoinKeepsFee({ deadlineAt: '2026-11-02T00:00:00Z' });
    expect(fees).toEqual([0, 0, 0, 1200]);
    expect((await chargeOf()).status).toBe('refunded');
    await moneyOk();
  });

  it('supersedes the earlier pending join for the same round when the owner joins again', async () => {
    await giveKedai(5000);
    const first = await join(ah, cmRound, { quantity: 1 });
    expect(first.body).toMatchObject({ status: 'pending', balanceAppliedSen: 5000 });
    const second = await join(ah, cmRound, { quantity: 2 });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ status: 'pending', balanceAppliedSen: 5000 });
    expect(await statusOf(first.body.paymentId)).toBe('failed');
    expect(await reservedSen()).toBe(5000);
    expect(
      await app.prisma.ledgerPosting.count({ where: { paymentId: first.body.paymentId } }),
    ).toBe(0);
    expect(await logCount('payment.failed')).toBe(1);
    // A re-tap is not a failed payment from the owner's point of view: no notice.
    expect(await app.prisma.notification.count({ where: { type: 'payment.failed' } })).toBe(0);
    // A join for another round leaves the pending one alone.
    const oil = await join(ah, await roundIdOf('OIL'), { quantity: 1 });
    expect(await statusOf(second.body.paymentId)).toBe('pending');
    expect(oil.body.balanceAppliedSen).toBe(0);
    await pay(ah, second.body);
    expect((await participationOf('KEDAI_KOPI', 'CM')).quantity).toBe(2);
    await moneyOk();
  });
});
