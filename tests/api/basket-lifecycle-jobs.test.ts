import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import {
  expireBasketIn,
  expireBaskets,
  sendBasketReminders,
} from '@/server/modules/baskets/lifecycle';
import { runDueJobs } from '@/server/modules/jobs/run';
import { voidOverduePayments } from '@/server/modules/payments/overdue';
import { withTransaction } from '@/server/platform/tx';
import { systemCaller } from '@/server/platform/caller';
import { createTestApp, type Client, type TestApp } from './helpers/app';
import { callRoute } from './helpers/route';
import { basketIdOf, payBasket, setupKedaiKopi } from './helpers/scenarios';

// Failure injection: a shop or payment named here makes the real function throw.
const fail = vi.hoisted(() => ({
  notifyShop: null as string | null,
  voidPayment: null as string | null,
}));
vi.mock('@/server/modules/notifications/notify', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/modules/notifications/notify')>();
  return {
    ...real,
    notify: (ctx: never, input: { audience: { shopId?: string } }) => {
      if (fail.notifyShop && input.audience.shopId === fail.notifyShop) {
        throw new Error('injected notify failure');
      }
      return real.notify(ctx, input as never);
    },
  };
});
vi.mock('@/server/modules/payments/complete', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/modules/payments/complete')>();
  return {
    ...real,
    voidPayment: (ctx: never, id: string) => {
      if (fail.voidPayment === id) throw new Error('injected void failure');
      return real.voidPayment(ctx, id);
    },
  };
});

const WEEK = '2026-W45';
const CRON = 'a-cron-secret-1234';

let app: TestApp;
let ah: Client;
let basketId: string;

beforeEach(async () => {
  fail.notifyShop = null;
  fail.voidPayment = null;
  app = await createTestApp({ seed: 'demo' });
  await setupKedaiKopi(app);
  ah = await app.as('ahSeng');
  basketId = (await basketIdOf('KEDAI_KOPI', WEEK))!;
});

afterEach(async () => {
  await app.close();
});

const logCount = (action: string) =>
  app.prisma.activityLogEntry.count({ where: { action: action as never } });

describe('basket lifecycle', () => {
  it('skips this week without charging (story 36)', async () => {
    const res = await ah.post(`/api/baskets/${basketId}/skip`, {});
    expect(res.status).toBe(200);
    const basket = await app.prisma.weeklyBasket.findUniqueOrThrow({ where: { id: basketId } });
    expect(basket.status).toBe('skipped');
    expect(await app.prisma.payment.count({ where: { basketId } })).toBe(0);
    const approval = await app.prisma.approvalRequest.findUniqueOrThrow({
      where: { id: basket.approvalRequestId! },
    });
    expect(approval.status).toBe('rejected');
    expect(approval.decidedAt).not.toBeNull();
    expect(await logCount('basket.skipped')).toBe(1);
    // Cannot be skipped twice, and staff cannot skip.
    expect((await ah.post(`/api/baskets/${basketId}/skip`, {})).status).toBe(422);
  });

  it('keeps a reason when one is given, and refuses staff', async () => {
    const rahim = await app.as('rahim');
    expect((await rahim.post(`/api/baskets/${basketId}/skip`, {})).status).toBe(403);
    expect((await ah.post(`/api/baskets/${basketId}/skip`, { reason: 'Away' })).status).toBe(200);
    const basket = await app.prisma.weeklyBasket.findUniqueOrThrow({ where: { id: basketId } });
    expect(basket.skipReason).toBe('Away');
  });

  const reminderTexts = async () =>
    (
      await app.prisma.notification.findMany({
        where: { type: 'basket.reminder', userId: seedId('user', 'ahSeng') },
        orderBy: { createdAt: 'asc' },
      })
    ).map((n) => n.whatsappText);

  it('reminds an undecided owner 24 h and 3 h before cut-off, once each (story 37)', async () => {
    app.clock.set('2026-11-04T12:00:00Z');
    await sendBasketReminders(app.deps);
    await sendBasketReminders(app.deps);
    app.clock.set('2026-11-05T09:00:00Z');
    await sendBasketReminders(app.deps);
    await sendBasketReminders(app.deps);
    expect(await reminderTexts()).toEqual([
      'Reminder: your Kongsi basket closes tomorrow at 8 pm.',
      'Reminder: your Kongsi basket closes today at 8 pm.',
    ]);
  });

  it('sends only the 3 h reminder when the first run is late, and none after cut-off', async () => {
    app.clock.set('2026-11-05T10:00:00Z');
    expect((await sendBasketReminders(app.deps)).sent).toBe(1);
    expect(await reminderTexts()).toEqual(['Reminder: your Kongsi basket closes today at 8 pm.']);
    app.clock.set('2026-11-05T12:00:01Z');
    expect((await sendBasketReminders(app.deps)).sent).toBe(0);
  });

  it('does not remind an owner who has decided', async () => {
    await ah.post(`/api/baskets/${basketId}/skip`, {});
    app.clock.set('2026-11-05T10:00:00Z');
    expect((await sendBasketReminders(app.deps)).sent).toBe(0);
  });

  it('expires an unapproved basket at cut-off without charging (story 38)', async () => {
    const approved = await ah.post(`/api/baskets/${basketId}/approve`, undefined, {
      'idempotency-key': 'k1',
    });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('pending');
    const postings = await app.prisma.ledgerPosting.count();

    // The deadline is the cut-off, 12:00: still open a second before, expired exactly at it (as
    // payments are voided at their deadline and rounds close at their cut-off).
    app.clock.set('2026-11-05T11:59:59Z');
    expect((await expireBaskets(app.deps)).expired).toBe(0);

    app.clock.set('2026-11-05T12:00:00Z');
    expect((await expireBaskets(app.deps)).expired).toBe(1);
    const basket = await app.prisma.weeklyBasket.findUniqueOrThrow({ where: { id: basketId } });
    expect(basket.status).toBe('expired');
    const payment = await app.prisma.payment.findUniqueOrThrow({
      where: { id: approved.body.paymentId },
    });
    expect(payment.status).toBe('voided');
    expect(
      (
        await app.prisma.approvalRequest.findUniqueOrThrow({
          where: { id: basket.approvalRequestId! },
        })
      ).status,
    ).toBe('expired');
    expect(await app.prisma.ledgerPosting.count()).toBe(postings);
    expect(await logCount('payment.voided')).toBe(1);
    expect(await logCount('basket.expired')).toBe(1);
  });

  it('refuses to approve a basket exactly at its deadline', async () => {
    app.clock.set('2026-11-05T11:59:59Z');
    expect(
      (await app.prisma.weeklyBasket.findUniqueOrThrow({ where: { id: basketId } })).deadlineAt,
    ).toEqual(new Date('2026-11-05T12:00:00Z'));
    app.clock.set('2026-11-05T12:00:00Z');
    const res = await ah.post(`/api/baskets/${basketId}/approve`, undefined, {
      'idempotency-key': 'k-deadline',
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BASKET_CLOSED');
  });

  it('leaves a paid basket alone at cut-off', async () => {
    await payBasket(app, 'ahSeng', basketId);
    app.clock.set('2026-11-05T12:00:01Z');
    await expireBaskets(app.deps);
    const basket = await app.prisma.weeklyBasket.findUniqueOrThrow({ where: { id: basketId } });
    expect(basket.status).toBe('paid');
  });
});

describe('jobs runner', () => {
  it('needs the cron secret to run jobs', async () => {
    expect((await callRoute('GET', '/api/jobs/run')).status).toBe(401);
    expect(
      (await callRoute('GET', '/api/jobs/run', { headers: { authorization: 'Bearer nope' } }))
        .status,
    ).toBe(401);
    expect(
      (await callRoute('POST', '/api/jobs/run', { headers: { authorization: `Basic ${CRON}` } }))
        .status,
    ).toBe(401);
    for (const method of ['GET', 'POST']) {
      const res = await callRoute(method, '/api/jobs/run', {
        headers: { authorization: `Bearer ${CRON}` },
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        openedRounds: 0,
        draftedBaskets: 0,
        reminders: 0,
        voidedPayments: 0,
        closedRounds: 0,
        failedRounds: 0,
        expiredBaskets: 0,
      });
    }
  });

  it('changes nothing when the jobs run twice', async () => {
    app.clock.set('2026-11-05T10:00:00Z');
    const first = await runDueJobs(app.deps);
    expect(first.reminders).toBe(1);
    app.clock.set('2026-11-05T12:00:01Z');
    const second = await runDueJobs(app.deps);
    expect(second.expiredBaskets).toBe(1);
    expect(second.closedRounds).toBe(12);
    expect(await runDueJobs(app.deps)).toEqual({
      openedRounds: 0,
      draftedBaskets: 0,
      reminders: 0,
      voidedPayments: 0,
      closedRounds: 0,
      failedRounds: 0,
      expiredBaskets: 0,
    });
  });
});

describe('basket lifecycle, edge cases', () => {
  it('does not expire a basket whose payment succeeded after the expiry read it', async () => {
    const summary = await payBasket(app, 'ahSeng', basketId);
    // The row as the expiry job read it, before the result landed.
    const stale = {
      ...(await app.prisma.weeklyBasket.findUniqueOrThrow({ where: { id: basketId } })),
      status: 'payment_pending' as const,
    };
    const postings = await app.prisma.ledgerPosting.count();
    app.clock.set('2026-11-05T12:00:01Z');
    const done = await withTransaction(app.deps, systemCaller('test'), (ctx) =>
      expireBasketIn(ctx, stale),
    );
    expect(done).toBe(false);
    const basket = await app.prisma.weeklyBasket.findUniqueOrThrow({ where: { id: basketId } });
    expect(basket.status).toBe('paid');
    expect(
      (await app.prisma.payment.findUniqueOrThrow({ where: { id: summary.paymentId } })).status,
    ).toBe('succeeded');
    expect(await logCount('payment.voided')).toBe(0);
    expect(await logCount('basket.expired')).toBe(0);
    expect(await app.prisma.ledgerPosting.count()).toBe(postings);
  });

  // Gerai's demo and history-week baskets are already paid, so an undecided basket for another
  // week is built by hand.
  const extraBasket = async (week: string, deadlineAt: string, withApproval: boolean) => {
    const shopId = seedId('shop', 'GERAI');
    const base = {
      shopId,
      basketWeek: week,
      status: 'draft' as const,
      deadlineAt: new Date(deadlineAt),
      fulfilment: 'door' as const,
      draftedAt: new Date('2026-11-01T22:00:00Z'),
    };
    const basket = await app.prisma.weeklyBasket.create({ data: base });
    if (withApproval) {
      const approval = await app.prisma.approvalRequest.create({
        data: {
          type: 'weekly_basket',
          subjectType: 'weekly_basket',
          subjectId: basket.id,
          shopId,
          assigneeRole: 'owner',
          summary: 'Test basket',
          whyNeeded: 'Test',
          evidence: {},
          proposedByType: 'system',
          status: 'pending',
        },
      });
      await app.prisma.weeklyBasket.update({
        where: { id: basket.id },
        data: { approvalRequestId: approval.id },
      });
    }
    return basket.id;
  };

  it('keeps expiring the other baskets when one fails', async () => {
    const other = await extraBasket('2026-W43', '2026-11-05T11:00:00Z', false);
    const approved = await ah.post(`/api/baskets/${basketId}/approve`, undefined, {
      'idempotency-key': 'a',
    });
    expect(approved.status).toBe(200);
    fail.voidPayment = approved.body.paymentId;
    app.clock.set('2026-11-05T12:00:01Z');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await expireBaskets(app.deps);
    expect(res).toEqual({ expired: 1, failed: 1 });
    expect(errors).toHaveBeenCalledWith(expect.stringContaining(basketId), expect.any(String));
    errors.mockRestore();
    const status = async (id: string) =>
      (await app.prisma.weeklyBasket.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(other)).toBe('expired');
    // The failed basket rolled back completely and is retried by the next run.
    expect(await status(basketId)).toBe('payment_pending');
    fail.voidPayment = null;
    expect(await expireBaskets(app.deps)).toEqual({ expired: 1, failed: 0 });
    expect(await status(basketId)).toBe('expired');
  });

  it('keeps voiding the other overdue payments when one fails', async () => {
    const approved = await ah.post(`/api/baskets/${basketId}/approve`, undefined, {
      'idempotency-key': 'a',
    });
    const cm = await app.prisma.round.findFirstOrThrow({
      where: { productId: seedId('product', 'CM'), status: 'open' },
    });
    const joined = await ah.post(`/api/rounds/${cm.id}/participations`, { quantity: 1 });
    expect(joined.body.status).toBe('pending');
    fail.voidPayment = approved.body.paymentId;
    app.clock.set('2026-11-05T12:00:01Z');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await voidOverduePayments(app.deps)).toEqual({ voided: 1, failed: 1 });
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining(approved.body.paymentId),
      expect.any(String),
    );
    errors.mockRestore();
    const status = async (id: string) =>
      (await app.prisma.payment.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(joined.body.paymentId)).toBe('voided');
    expect(await status(approved.body.paymentId)).toBe('pending');
    fail.voidPayment = null;
    expect(await voidOverduePayments(app.deps)).toEqual({ voided: 1, failed: 0 });
    expect(await status(approved.body.paymentId)).toBe('voided');
  });

  it('keeps reminding the other owners when one reminder fails', async () => {
    await extraBasket('2026-W43', '2026-11-05T12:00:00Z', true);
    fail.notifyShop = seedId('shop', 'KEDAI_KOPI');
    app.clock.set('2026-11-05T10:00:00Z');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await sendBasketReminders(app.deps);
    errors.mockRestore();
    expect(res).toEqual({ sent: 1, failed: 1 });
    expect(await reminderTextsFor('siti')).toEqual([
      'Reminder: your Kongsi basket closes today at 8 pm.',
    ]);
    expect(await reminderTextsFor('ahSeng')).toEqual([]);
  });
});

const reminderTextsFor = async (user: 'siti' | 'ahSeng') =>
  (
    await app.prisma.notification.findMany({
      where: { type: 'basket.reminder', userId: seedId('user', user) },
    })
  ).map((n) => n.whatsappText);
