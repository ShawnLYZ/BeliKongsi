import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { decideApproval } from '@/server/modules/approvals/approvals';
import { approveBasket } from '@/server/modules/baskets/approve';
import { draftWeeklyBaskets } from '@/server/modules/baskets/draft';
import { balanceOf } from '@/server/modules/ledger/accounts';
import { runMoneyChecks } from '@/server/modules/ledger/checks';
import { post } from '@/server/modules/ledger/post';
import { createPayment } from '@/server/modules/payments/create';
import { simulatePaymentResult } from '@/server/modules/payments/simulate';
import { openDueRounds } from '@/server/modules/rounds/open';
import { personCaller, systemCaller } from '@/server/platform/caller';
import { withTransaction } from '@/server/platform/tx';
import { createTestApp, type Client, type TestApp } from './helpers/app';
import {
  basketIdOf,
  basketOf,
  participationOf,
  payBasket,
  setupKedaiKopi,
} from './helpers/scenarios';
import { session } from './helpers/sessions';

const KEDAI = seedId('shop', 'KEDAI_KOPI');
const MONDAY_0610 = '2026-11-01T22:10:00Z';
/** Thu 5 Nov 20:00:01 MYT, one second after every round's cut-off. */
const AFTER_CUTOFF = '2026-11-05T12:00:01Z';
const REMOVED_NOTICE = 'Removed: this round closed before you paid.';

// Kedai Kopi Contoh's basket at Ipoh at starting prices (tier 1, fee and shipping included).
// CM 6 x 16409; OIL 2 x (10800 + 216 + 270); EGG_A 10 x (1230 + 25 + 57); COFFEE 25148; CUPS 2 x 12783.
const LINE_SEN = { CM: 98454, OIL: 22572, EGG_A: 13120, COFFEE: 25148, CUPS: 25566 } as const;
const KEDAI_TOTAL = 184860;
/** Kedai Kopi is about 1.3 km from the Ipoh pickup point: the 0–5 km door fee. */
const KEDAI_DOOR_FEE = 800;

let app: TestApp;
let ah: Client;
let kedaiBasket: string;
let cmRound: string;

const roundIdOf = async (key: string) =>
  (
    await app.prisma.round.findFirstOrThrow({
      where: { productId: seedId('product', key), status: 'open' },
    })
  ).id;
const approve = (key = 'k1', client = ah) =>
  client.post(`/api/baskets/${kedaiBasket}/approve`, undefined, { 'idempotency-key': key });
const simulate = (paymentId: string, outcome: 'succeeded' | 'failed', method = 'duitnow_qr') =>
  ah.post(`/api/payments/${paymentId}/simulate`, { outcome, method });
const giveBalance = (amountSen: number) =>
  withTransaction(app.deps, systemCaller('test balance'), (ctx) =>
    post(ctx, {
      from: { kind: 'partner_cash' },
      to: { kind: 'shop_balance', shopId: KEDAI },
      amountSen,
      kind: 'refund_cancelled',
      refs: { shopId: KEDAI },
    }),
  );
const postingsOf = (paymentId: string) =>
  app.prisma.ledgerPosting.findMany({
    where: { paymentId },
    include: { fromAccount: true, toAccount: true },
    orderBy: { seq: 'asc' },
  });
const ahSengSession = () => session('ahSeng', 'owner', { shopId: KEDAI }, 'shop');
/** A catalogue-style payment for `quantity` cartons of CM, made through `createPayment`. */
const payForCm = (quantity: number, destination: 'door' | 'pickup' = 'pickup') =>
  withTransaction(app.deps, personCaller(ahSengSession()), (ctx) =>
    createPayment(ctx, {
      shopId: KEDAI,
      purpose: 'join',
      lines: [
        {
          productId: seedId('product', 'CM'),
          roundId: cmRound,
          quantity,
          priceLimitSen: null,
          destination:
            destination === 'door'
              ? { type: 'door' }
              : { type: 'pickup_point', pickupPointId: seedId('pickup_point', 'PP_IPOH') },
        },
      ],
      deadlineAt: new Date('2026-11-05T12:00:00Z'),
      source: 'catalogue',
    }),
  );

beforeEach(async () => {
  app = await createTestApp({ seed: 'reference' });
  await openDueRounds(app.deps);
  app.clock.set(MONDAY_0610);
  await setupKedaiKopi(app);
  await draftWeeklyBaskets(app.deps);
  kedaiBasket = (await basketIdOf('KEDAI_KOPI', '2026-W45'))!;
  cmRound = await roundIdOf('CM');
  ah = await app.as('ahSeng');
});

afterEach(async () => {
  await app.close();
});

describe('approving and paying a basket', () => {
  it('pays Kedai Kopi Contoh’s basket on the simulated checkout (stories 35, 52)', async () => {
    const res = await approve();
    expect(res.status).toBe(200);
    const s = res.body;
    expect(s).toEqual({
      paymentId: expect.any(String),
      status: 'pending',
      linesTotalSen: KEDAI_TOTAL,
      deliveryFeeSen: 0,
      totalSen: KEDAI_TOTAL,
      balanceAppliedSen: 0,
      externalSen: KEDAI_TOTAL,
      checkoutUrl: `/checkout/${s.paymentId}`,
    });
    expect((await basketOf('KEDAI_KOPI', '2026-W45')).status).toBe('payment_pending');

    const view = (await simulate(s.paymentId, 'succeeded')).body;
    expect(view).toMatchObject({
      paymentId: s.paymentId,
      status: 'succeeded',
      method: 'duitnow_qr',
      purpose: 'basket',
      basketId: kedaiBasket,
      shopId: KEDAI,
      totalSen: KEDAI_TOTAL,
      checkoutUrl: null,
    });
    expect(view.partnerReference).toMatch(/^SIM-PAY-[0-9A-F]{8}$/);

    expect(await participationOf('KEDAI_KOPI', 'CM')).toMatchObject({
      quantity: 6,
      paidSen: 98454,
      startingAllInSen: 16409,
      unitShippingSen: 293,
      baselineSen: 16500,
      baselineKind: 'usual',
      status: 'active',
      source: 'weekly_basket',
      destinationType: 'pickup_point',
      pickupPointId: seedId('pickup_point', 'PP_IPOH'),
      deliveryDate: '2026-11-10',
      joinedAt: new Date(MONDAY_0610),
    });
    for (const [key, sen] of Object.entries(LINE_SEN)) {
      expect((await participationOf('KEDAI_KOPI', key)).paidSen).toBe(sen);
      expect(
        await balanceOf(app.prisma, { kind: 'round_hold', roundId: await roundIdOf(key) }),
      ).toBe(sen);
    }
    expect(await balanceOf(app.prisma, { kind: 'round_hold', roundId: cmRound })).toBe(98454);

    // Partner cash pays each line into its round hold; nothing comes from the empty balance.
    const postings = await postingsOf(s.paymentId);
    expect(postings.map((p) => p.kind)).toEqual(Array(5).fill('payment_in'));
    expect(postings.every((p) => p.fromAccount.kind === 'partner_cash')).toBe(true);
    expect(postings.reduce((sum, p) => sum + p.amountSen, 0)).toBe(KEDAI_TOTAL);

    const basket = await basketOf('KEDAI_KOPI', '2026-W45');
    expect(basket).toMatchObject({
      status: 'paid',
      approvedAt: new Date(MONDAY_0610),
      approvedByUserId: seedId('user', 'ahSeng'),
    });
    expect(
      await app.prisma.approvalRequest.findUniqueOrThrow({
        where: { id: basket.approvalRequestId! },
      }),
    ).toMatchObject({
      status: 'approved',
      decidedByUserId: seedId('user', 'ahSeng'),
      amountSen: KEDAI_TOTAL,
    });

    const actions = (
      await app.prisma.activityLogEntry.findMany({
        where: { action: { startsWith: 'p' } },
        orderBy: { seq: 'asc' },
      })
    ).map((l) => l.action);
    expect(actions).toEqual([
      'payment.created',
      'payment.succeeded',
      ...Array(5).fill('participation.joined'),
    ]);
    expect(await app.prisma.activityLogEntry.count({ where: { action: 'basket.approved' } })).toBe(
      1,
    );
    expect(await app.prisma.activityLogEntry.count({ where: { action: 'balance.applied' } })).toBe(
      0,
    );

    const approved = await app.prisma.integrationEvent.findFirstOrThrow({
      where: { type: 'basket.approved' },
    });
    expect(approved.data).toEqual({
      basketId: kedaiBasket,
      shopId: KEDAI,
      week: '2026-W45',
      lineCount: 5,
      amountSen: KEDAI_TOTAL,
    });
    const joined = await app.prisma.integrationEvent.findMany({
      where: { type: 'participation.joined' },
    });
    expect(joined).toHaveLength(5);
    expect(joined.map((e) => e.data)).toContainEqual({
      participationId: (await participationOf('KEDAI_KOPI', 'CM')).id,
      roundId: cmRound,
      shopId: KEDAI,
      quantity: 6,
      outcome: 'active',
    });

    const note = await app.prisma.notification.findFirstOrThrow({
      where: { type: 'payment.succeeded' },
    });
    expect(note).toMatchObject({
      userId: seedId('user', 'ahSeng'),
      body: "Payment received (simulated). You're in 5 Kongsi rounds this week.",
    });
    expect(await app.prisma.notification.count({ where: { type: 'payment.succeeded' } })).toBe(1);
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });

  it('returns the same pending payment when approve is tapped twice', async () => {
    const first = (await approve('k1')).body;
    const replay = (await approve('k1')).body;
    const second = (await approve('k2')).body;
    expect(replay).toEqual(first);
    expect(second).toEqual(first);
    expect(await app.prisma.payment.count()).toBe(1);
    expect(await app.prisma.paymentLine.count()).toBe(5);
  });

  it('shows the basket’s pending, then succeeded, payment on the owner’s basket view', async () => {
    const current = async () => (await ah.get(`/api/shops/${KEDAI}/baskets/current`)).body;
    expect((await current()).paymentId).toBeNull();
    const { paymentId } = (await approve()).body;
    expect(await current()).toMatchObject({ status: 'payment_pending', paymentId });
    await simulate(paymentId, 'succeeded');
    expect(await current()).toMatchObject({ status: 'paid', paymentId });
  });

  it('repeats a simulated result without new postings', async () => {
    const { paymentId } = (await approve()).body;
    await simulate(paymentId, 'succeeded');
    const postings = await app.prisma.ledgerPosting.count();
    const again = await simulate(paymentId, 'succeeded');
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ paymentId, status: 'succeeded', method: 'duitnow_qr' });
    const failedLater = await simulate(paymentId, 'failed');
    expect(failedLater.body.status).toBe('succeeded');
    expect(await app.prisma.ledgerPosting.count()).toBe(postings);
    expect(await app.prisma.participation.count()).toBe(5);
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });

  it('keeps the basket unpaid after a failure and lets the owner retry (story 54)', async () => {
    const { paymentId } = (await approve('k1')).body;
    const failed = (await simulate(paymentId, 'failed', 'fpx')).body;
    expect(failed).toMatchObject({ paymentId, status: 'failed', checkoutUrl: null });
    expect((await basketOf('KEDAI_KOPI', '2026-W45')).status).toBe('draft');
    expect(await app.prisma.ledgerPosting.count({ where: { paymentId } })).toBe(0);
    expect(await app.prisma.participation.count()).toBe(0);
    expect(await app.prisma.activityLogEntry.count({ where: { action: 'payment.failed' } })).toBe(
      1,
    );
    expect(
      (await app.prisma.notification.findFirstOrThrow({ where: { type: 'payment.failed' } })).body,
    ).toBe('Payment failed (simulated). Your basket is unchanged. Tap to try again.');

    const retry = (await approve('k2')).body;
    expect(retry.paymentId).not.toBe(paymentId);
    expect(retry).toMatchObject({ status: 'pending', totalSen: KEDAI_TOTAL });
    await simulate(retry.paymentId, 'succeeded', 'fpx');
    expect((await basketOf('KEDAI_KOPI', '2026-W45')).status).toBe('paid');
    expect((await participationOf('KEDAI_KOPI', 'CM')).paymentId).toBe(retry.paymentId);
    expect(await balanceOf(app.prisma, { kind: 'round_hold', roundId: cmRound })).toBe(98454);
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });

  it('voids a result that arrives after the deadline', async () => {
    const { paymentId: pid } = (await approve()).body;
    app.clock.set(AFTER_CUTOFF);
    const res = await ah.post(`/api/payments/${pid}/simulate`, {
      outcome: 'succeeded',
      method: 'fpx',
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PAYMENT_VOIDED');
    expect(await app.prisma.participation.count({ where: { paymentId: pid } })).toBe(0);
    expect(await app.prisma.ledgerPosting.count({ where: { paymentId: pid } })).toBe(0);
    // The void is committed, with its log entry, even though the call answered 409.
    expect((await app.prisma.payment.findUniqueOrThrow({ where: { id: pid } })).status).toBe(
      'voided',
    );
    expect(await app.prisma.activityLogEntry.count({ where: { action: 'payment.voided' } })).toBe(
      1,
    );
    // A later result is answered with the voided payment and still moves no money.
    const later = await simulate(pid, 'succeeded');
    expect(later.body).toMatchObject({ paymentId: pid, status: 'voided' });
    expect(await app.prisma.ledgerPosting.count({ where: { paymentId: pid } })).toBe(0);
  });

  it('reserves the balance a pending payment plans to use', async () => {
    await giveBalance(50000);
    const basket = (await approve()).body;
    expect(basket).toMatchObject({ status: 'pending', balanceAppliedSen: 50000 });
    // A second payment from the same shop finds the balance spoken for: it is not balance-only.
    const join = await payForCm(1);
    expect(join).toMatchObject({
      status: 'pending',
      totalSen: 16409,
      balanceAppliedSen: 0,
      externalSen: 16409,
    });
    const paid = await simulate(basket.paymentId, 'succeeded');
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe('succeeded');
    expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KEDAI })).toBe(0);
    expect((await simulate(join.paymentId, 'succeeded')).body.status).toBe('succeeded');
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });

  it('never lets two concurrent payments plan the same balance', async () => {
    await giveBalance(20000);
    const [a, b] = await Promise.all([payForCm(1), payForCm(1)]);
    expect(a!.balanceAppliedSen + b!.balanceAppliedSen).toBe(20000);
    expect([a!.balanceAppliedSen, b!.balanceAppliedSen].sort((x, y) => x - y)).toEqual([
      20000 - 16409,
      16409,
    ]);
    for (const p of [a!, b!]) {
      if (p.status === 'pending') await simulate(p.paymentId, 'succeeded');
    }
    expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KEDAI })).toBe(0);
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });

  it('uses the balance first and splits postings exactly (story 53)', async () => {
    await giveBalance(50000);
    const s = (await approve()).body;
    expect(s).toMatchObject({
      status: 'pending',
      totalSen: KEDAI_TOTAL,
      balanceAppliedSen: 50000,
      externalSen: KEDAI_TOTAL - 50000,
    });
    await simulate(s.paymentId, 'succeeded');
    expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KEDAI })).toBe(0);

    // Line by line in round id order: the balance covers the first lines, partner cash the rest.
    const lines = await app.prisma.paymentLine.findMany({
      where: { paymentId: s.paymentId },
      orderBy: [{ roundId: 'asc' }, { id: 'asc' }],
    });
    let left = 50000;
    const expected = lines.flatMap((l) => {
      const fromBalance = Math.min(left, l.lineSen);
      left -= fromBalance;
      return [
        ...(fromBalance > 0
          ? [{ roundId: l.roundId, kind: 'balance_applied', amountSen: fromBalance }]
          : []),
        ...(l.lineSen - fromBalance > 0
          ? [{ roundId: l.roundId, kind: 'payment_in', amountSen: l.lineSen - fromBalance }]
          : []),
      ];
    });
    const postings = await postingsOf(s.paymentId);
    expect(
      postings.map((p) => ({ roundId: p.roundId, kind: p.kind, amountSen: p.amountSen })),
    ).toEqual(expected);
    const sum = (kind: string) =>
      postings.filter((p) => p.kind === kind).reduce((n, p) => n + p.amountSen, 0);
    expect(sum('balance_applied')).toBe(50000);
    expect(sum('payment_in')).toBe(KEDAI_TOTAL - 50000);
    for (const l of lines) {
      expect(await balanceOf(app.prisma, { kind: 'round_hold', roundId: l.roundId })).toBe(
        l.lineSen,
      );
    }
    expect(await app.prisma.activityLogEntry.count({ where: { action: 'balance.applied' } })).toBe(
      1,
    );
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });

  it('skips the checkout when the balance covers everything', async () => {
    await giveBalance(200000);
    const res = await approve();
    expect(res.body).toEqual({
      paymentId: expect.any(String),
      status: 'succeeded',
      linesTotalSen: KEDAI_TOTAL,
      deliveryFeeSen: 0,
      totalSen: KEDAI_TOTAL,
      balanceAppliedSen: KEDAI_TOTAL,
      externalSen: 0,
      checkoutUrl: null,
    });
    const payment = await app.prisma.payment.findUniqueOrThrow({
      where: { id: res.body.paymentId },
    });
    expect(payment).toMatchObject({
      status: 'succeeded',
      method: 'balance_only',
      partnerReference: null,
    });
    expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KEDAI })).toBe(
      200000 - KEDAI_TOTAL,
    );
    const postings = await postingsOf(res.body.paymentId);
    expect(postings.every((p) => p.kind === 'balance_applied')).toBe(true);
    expect(postings.reduce((n, p) => n + p.amountSen, 0)).toBe(KEDAI_TOTAL);
    expect((await basketOf('KEDAI_KOPI', '2026-W45')).status).toBe('paid');
    // Tapping again returns the same succeeded payment.
    expect((await approve('k2')).body).toEqual(res.body);
    expect(await app.prisma.payment.count()).toBe(1);
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });

  it('removes a line whose round has closed before approval, with a notice', async () => {
    await app.prisma.round.update({
      where: { id: await roundIdOf('OIL') },
      data: { status: 'formed' },
    });
    const s = (await approve()).body;
    expect(s).toMatchObject({
      status: 'pending',
      linesTotalSen: KEDAI_TOTAL - LINE_SEN.OIL,
      totalSen: KEDAI_TOTAL - LINE_SEN.OIL,
    });
    const oil = (await basketOf('KEDAI_KOPI', '2026-W45')).lines.find(
      (l) => l.productKey === 'OIL',
    )!;
    expect(oil).toMatchObject({ removed: true, notice: REMOVED_NOTICE });
    expect(await app.prisma.paymentLine.count({ where: { paymentId: s.paymentId } })).toBe(4);
    await simulate(s.paymentId, 'succeeded');
    expect(await app.prisma.participation.count()).toBe(4);
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });

  it('refuses an empty basket and keeps the removal notices', async () => {
    await app.prisma.round.updateMany({ where: { status: 'open' }, data: { status: 'formed' } });
    const res = await approve();
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('BASKET_EMPTY');
    const lines = (await basketOf('KEDAI_KOPI', '2026-W45')).lines;
    expect(lines.every((l) => l.removed && l.notice === REMOVED_NOTICE)).toBe(true);
    expect(await app.prisma.payment.count()).toBe(0);
  });

  it('lets only the owner approve and pay', async () => {
    const rahim = await app.as('rahim');
    expect((await approve('r1', rahim)).status).toBe(403);
    const siti = await app.as('siti');
    expect((await approve('s1', siti)).status).toBe(404);
    const { paymentId } = (await approve()).body;
    const body = { outcome: 'succeeded', method: 'fpx' };
    expect((await siti.post(`/api/payments/${paymentId}/simulate`, body)).status).toBe(404);
    expect((await rahim.post(`/api/payments/${paymentId}/simulate`, body)).status).toBe(403);
    expect(
      (await (await app.as('nadia')).post(`/api/payments/${paymentId}/simulate`, body)).status,
    ).toBe(403);
    expect(
      (await ah.post(`/api/payments/${paymentId}/simulate`, { outcome: 'maybe' })).status,
    ).toBe(400);
    expect(await app.prisma.ledgerPosting.count({ where: { paymentId } })).toBe(0);
  });

  it('turns basket approvals in the inbox away, and skips the basket on reject', async () => {
    const basket = await basketOf('KEDAI_KOPI', '2026-W45');
    const caller = personCaller(ahSengSession());
    await expect(
      decideApproval(app.deps, caller, basket.approvalRequestId!, { decision: 'approve' }),
    ).rejects.toMatchObject({ status: 422, code: 'USE_BASKET_SCREEN' });
    const view = await decideApproval(app.deps, caller, basket.approvalRequestId!, {
      decision: 'reject',
      reason: 'Closed for Deepavali',
    });
    expect(view.status).toBe('rejected');
    expect(await basketOf('KEDAI_KOPI', '2026-W45')).toMatchObject({
      status: 'skipped',
      skipReason: 'Closed for Deepavali',
    });
    expect(await app.prisma.integrationEvent.count({ where: { type: 'basket.skipped' } })).toBe(1);
  });

  it('pays through the services inside an outer transaction (the seed’s path)', async () => {
    const caller = personCaller(ahSengSession());
    const view = await withTransaction(app.deps, systemCaller('outer'), async () => {
      const s = await approveBasket(app.deps, caller, kedaiBasket);
      return simulatePaymentResult(app.deps, caller, s.paymentId, {
        outcome: 'succeeded',
        method: 'duitnow_qr',
      });
    });
    expect(view).toMatchObject({ status: 'succeeded', totalSen: KEDAI_TOTAL });
    expect(await balanceOf(app.prisma, { kind: 'round_hold', roundId: cmRound })).toBe(98454);
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });

  it('settles at once with settleImmediatelyWith, inside the caller’s transaction', async () => {
    const shop = await app.prisma.shop.findUniqueOrThrow({ where: { id: KEDAI } });
    const summary = await withTransaction(app.deps, systemCaller('seed'), (ctx) =>
      createPayment(ctx, {
        shopId: KEDAI,
        purpose: 'join',
        lines: [
          {
            productId: seedId('product', 'CM'),
            roundId: cmRound,
            quantity: 2,
            priceLimitSen: null,
            destination: { type: 'pickup_point', pickupPointId: shop.defaultPickupPointId! },
          },
        ],
        deadlineAt: new Date(AFTER_CUTOFF),
        source: 'background_seed',
        settleImmediatelyWith: 'fpx',
      }),
    );
    expect(summary).toMatchObject({
      status: 'succeeded',
      totalSen: 2 * 16409,
      externalSen: 2 * 16409,
      checkoutUrl: null,
    });
    expect(await participationOf('KEDAI_KOPI', 'CM')).toMatchObject({
      source: 'background_seed',
      quantity: 2,
      paidSen: 32818,
    });
    const payment = await app.prisma.payment.findUniqueOrThrow({
      where: { id: summary.paymentId },
    });
    expect(payment.method).toBe('fpx');
    expect(payment.partnerReference).toMatch(/^SIM-PAY-[0-9A-F]{8}$/);
    expect(
      (await app.prisma.notification.findFirstOrThrow({ where: { type: 'payment.succeeded' } }))
        .body,
    ).toBe("Payment received (simulated). You're in the condensed milk Kongsi.");
  });
});

describe('the door delivery fee', () => {
  beforeEach(async () => {
    await app.prisma.shop.update({ where: { id: KEDAI }, data: { defaultFulfilment: 'door' } });
    await app.prisma.weeklyBasket.update({
      where: { id: kedaiBasket },
      data: { fulfilment: 'door', pickupPointId: null },
    });
  });

  it('charges one fee per door delivery date and holds it (PRD 6.9)', async () => {
    const s = (await approve()).body;
    expect(s.deliveryFeeSen).toBe(KEDAI_DOOR_FEE);
    expect(s).toMatchObject({ linesTotalSen: KEDAI_TOTAL, totalSen: KEDAI_TOTAL + KEDAI_DOOR_FEE });
    await simulate(s.paymentId, 'succeeded');
    expect(
      await app.prisma.deliveryFeeCharge.findUniqueOrThrow({
        where: { shopId_deliveryDate: { shopId: KEDAI, deliveryDate: '2026-11-10' } },
      }),
    ).toMatchObject({ amountSen: s.deliveryFeeSen, status: 'held', paymentId: s.paymentId });
    expect(
      await balanceOf(app.prisma, {
        kind: 'delivery_fee_hold',
        shopId: KEDAI,
        deliveryDate: '2026-11-10',
      }),
    ).toBe(s.deliveryFeeSen);
    const fee = (await postingsOf(s.paymentId)).filter(
      (p) => p.toAccount.kind === 'delivery_fee_hold',
    );
    expect(fee.map((p) => [p.kind, p.amountSen])).toEqual([['delivery_fee_in', s.deliveryFeeSen]]);
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });

  it('pays the fee from the balance after every line', async () => {
    const lines = (await approve('probe')).body;
    await simulate(lines.paymentId, 'failed');
    await giveBalance(lines.totalSen);
    const s = (await approve('k2')).body;
    expect(s).toMatchObject({ status: 'succeeded', balanceAppliedSen: s.totalSen, externalSen: 0 });
    const fee = (await postingsOf(s.paymentId)).at(-1)!;
    expect(fee).toMatchObject({ kind: 'balance_applied', amountSen: s.deliveryFeeSen });
    expect(fee.toAccount.kind).toBe('delivery_fee_hold');
    expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KEDAI })).toBe(0);
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });

  it('refunds a duplicate fee when another payment already holds it', async () => {
    const s = (await approve()).body;
    const feeSen = s.deliveryFeeSen;
    // Another payment for the same date succeeds first and holds the fee.
    await withTransaction(app.deps, systemCaller('test'), async (ctx) => {
      await post(ctx, {
        from: { kind: 'partner_cash' },
        to: { kind: 'delivery_fee_hold', shopId: KEDAI, deliveryDate: '2026-11-10' },
        amountSen: feeSen,
        kind: 'delivery_fee_in',
      });
      await ctx.tx.deliveryFeeCharge.create({
        data: {
          shopId: KEDAI,
          deliveryDate: '2026-11-10',
          amountSen: feeSen,
          paymentId: seedId('shop', 'GERAI'),
          status: 'held',
        },
      });
    });
    await simulate(s.paymentId, 'succeeded');
    const refund = (await postingsOf(s.paymentId)).at(-1)!;
    expect(refund).toMatchObject({ kind: 'refund_delivery_fee', amountSen: feeSen });
    expect(refund.toAccount.kind).toBe('shop_balance');
    expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KEDAI })).toBe(feeSen);
    expect(
      await app.prisma.deliveryFeeCharge.findUniqueOrThrow({
        where: { shopId_deliveryDate: { shopId: KEDAI, deliveryDate: '2026-11-10' } },
      }),
    ).toMatchObject({ paymentId: seedId('shop', 'GERAI'), status: 'held' });
  });

  it('holds the fee again on a charge left refunded', async () => {
    await app.prisma.deliveryFeeCharge.create({
      data: {
        shopId: KEDAI,
        deliveryDate: '2026-11-10',
        amountSen: 1,
        paymentId: seedId('shop', 'GERAI'),
        status: 'refunded',
      },
    });
    const s = (await approve()).body;
    expect(s.deliveryFeeSen).toBe(KEDAI_DOOR_FEE);
    await simulate(s.paymentId, 'succeeded');
    expect(await app.prisma.deliveryFeeCharge.count()).toBe(1);
    expect(
      await app.prisma.deliveryFeeCharge.findUniqueOrThrow({
        where: { shopId_deliveryDate: { shopId: KEDAI, deliveryDate: '2026-11-10' } },
      }),
    ).toMatchObject({ paymentId: s.paymentId, status: 'held', amountSen: s.deliveryFeeSen });
  });

  it('keeps the date’s fee when the first carrier fails and the second succeeds (PRD 6.9)', async () => {
    const a = (await approve()).body;
    const b = await payForCm(1, 'door');
    // Both pending payments carry the fee for 10 Nov: neither knows which will succeed.
    expect(a.deliveryFeeSen).toBe(KEDAI_DOOR_FEE);
    expect(b).toMatchObject({ deliveryFeeSen: KEDAI_DOOR_FEE, totalSen: 16409 + KEDAI_DOOR_FEE });
    await simulate(a.paymentId, 'failed');
    await simulate(b.paymentId, 'succeeded');
    expect(
      await app.prisma.deliveryFeeCharge.findUniqueOrThrow({
        where: { shopId_deliveryDate: { shopId: KEDAI, deliveryDate: '2026-11-10' } },
      }),
    ).toMatchObject({ paymentId: b.paymentId, amountSen: KEDAI_DOOR_FEE, status: 'held' });
    expect(
      await balanceOf(app.prisma, {
        kind: 'delivery_fee_hold',
        shopId: KEDAI,
        deliveryDate: '2026-11-10',
      }),
    ).toBe(KEDAI_DOOR_FEE);
    expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KEDAI })).toBe(0);
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });

  it('refunds the second fee to the balance when both carriers succeed', async () => {
    const a = (await approve()).body;
    const b = await payForCm(1, 'door');
    await simulate(a.paymentId, 'succeeded');
    await simulate(b.paymentId, 'succeeded');
    expect(
      await app.prisma.deliveryFeeCharge.findUniqueOrThrow({
        where: { shopId_deliveryDate: { shopId: KEDAI, deliveryDate: '2026-11-10' } },
      }),
    ).toMatchObject({ paymentId: a.paymentId, amountSen: KEDAI_DOOR_FEE, status: 'held' });
    const refund = (await postingsOf(b.paymentId)).at(-1)!;
    expect(refund).toMatchObject({ kind: 'refund_delivery_fee', amountSen: KEDAI_DOOR_FEE });
    expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KEDAI })).toBe(
      KEDAI_DOOR_FEE,
    );
    expect(
      await balanceOf(app.prisma, {
        kind: 'delivery_fee_hold',
        shopId: KEDAI,
        deliveryDate: '2026-11-10',
      }),
    ).toBe(KEDAI_DOOR_FEE);
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });
});

describe('payBasket', () => {
  it('approves and pays a basket in one step', async () => {
    const s = await payBasket(app, 'ahSeng', kedaiBasket);
    expect(s).toMatchObject({ status: 'succeeded', totalSen: KEDAI_TOTAL });
    expect((await basketOf('KEDAI_KOPI', '2026-W45')).status).toBe('paid');
  });
});
