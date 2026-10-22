/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are arbitrary JSON; tests assert on them */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { createTestApp, type Client, type TestApp } from './helpers/app';
import { basketIdOf, participationOf, payBasket, setupKedaiKopi } from './helpers/scenarios';

const KEDAI = seedId('shop', 'KEDAI_KOPI');
const NOTICE = 'Issued by BeliKongsi (simulated). Not a tax invoice.';

let app: TestApp;
let ah: Client;
let pid: string;

beforeEach(async () => {
  app = await createTestApp({ seed: 'demo' });
  await setupKedaiKopi(app);
  ah = await app.as('ahSeng');
  pid = (await payBasket(app, 'ahSeng', (await basketIdOf('KEDAI_KOPI', '2026-W45'))!)).paymentId;
});

afterEach(async () => {
  await app.close();
});

describe('payment views and receipts', () => {
  it('lists every line, the fee and the shipping share on the receipt (story 55)', async () => {
    const res = await ah.get(`/api/payments/${pid}/receipt`);
    expect(res.status).toBe(200);
    const r = res.body;
    expect(r.lines).toHaveLength(5);
    expect(r.lines.find((l: any) => l.productName.startsWith('Sweetened condensed milk'))).toEqual(
      expect.objectContaining({
        quantity: 6,
        unitAllInSen: 16409,
        unitGoodsSen: 15800,
        unitFeeSen: 316,
        unitShippingSen: 293,
        lineSen: 98454,
      }),
    );
    expect(r).toMatchObject({
      paymentId: pid,
      shopName: 'Kedai Kopi Contoh',
      deliveryFeeSen: 0,
      balanceAppliedSen: 0,
      paidSen: 184860,
      totalSen: 184860,
      method: 'duitnow_qr',
      notice: NOTICE,
    });
    expect(r.partnerReference).toMatch(/^SIM-PAY-[0-9A-F]{8}$/);
    const paid = await app.prisma.payment.findUniqueOrThrow({ where: { id: pid } });
    expect(r.issuedAt).toBe(paid.completedAt!.toISOString());
  });

  it('returns the payment view to its owner', async () => {
    const res = await ah.get(`/api/payments/${pid}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      paymentId: pid,
      status: 'succeeded',
      totalSen: 184860,
      shopId: KEDAI,
      purpose: 'basket',
      method: 'duitnow_qr',
    });
  });

  it('gives no receipt for a payment that has not succeeded (409)', async () => {
    const join = await ah.post(`/api/rounds/${await openRoundId('CM')}/participations`, {
      quantity: 1,
    });
    expect(join.status).toBe(200);
    expect(join.body.status).toBe('pending');
    const res = await ah.get(`/api/payments/${join.body.paymentId}/receipt`);
    expect(res.status).toBe(409);
  });

  it('hides another shop’s payment and receipt, and keeps staff and Ops out (G8)', async () => {
    const siti = await app.as('siti');
    expect((await siti.get(`/api/payments/${pid}`)).status).toBe(404);
    expect((await siti.get(`/api/payments/${pid}/receipt`)).status).toBe(404);
    const rahim = await app.as('rahim');
    expect((await rahim.get(`/api/payments/${pid}`)).status).toBe(403);
    expect((await rahim.get(`/api/payments/${pid}/receipt`)).status).toBe(403);
    expect((await ah.get('/api/payments/not-an-id')).status).toBe(404);
  });
});

const openRoundId = async (key: string) =>
  (
    await app.prisma.round.findFirstOrThrow({
      where: { productId: seedId('product', key), status: 'open' },
    })
  ).id;

describe('the money history', () => {
  it('keeps a running balance in the money history (story 56)', async () => {
    const cm = await participationOf('KEDAI_KOPI', 'CM');
    expect((await ah.post(`/api/participations/${cm.id}/cancel`)).status).toBe(200);
    // Joining 2 cartons costs 2 x 16409 = 32818, all taken from the balance.
    const join = await ah.post(`/api/rounds/${await openRoundId('CM')}/participations`, {
      quantity: 2,
    });
    expect(join.status).toBe(200);
    expect(join.body).toMatchObject({
      status: 'succeeded',
      balanceAppliedSen: 32818,
      externalSen: 0,
    });

    const res = await ah.get(`/api/shops/${KEDAI}/balance`);
    expect(res.status).toBe(200);
    expect(res.body.balanceSen).toBe(98454 - 32818);
    const items = res.body.history.items;
    expect(
      items.map((i: any) => [i.kind, i.amountSen, i.balanceChangeSen, i.runningBalanceSen]),
    ).toEqual([
      ['balance_used', 32818, -32818, 65636],
      ['refund', 98454, 98454, 98454],
      ['payment', 184860, 0, 0],
    ]);
    expect(items[0].label).toBe('Balance used for condensed milk');
    expect(items[1].label).toBe('Refund: you cancelled condensed milk');
    expect(items[2].label).toBe('Payment (simulated) — DuitNow QR');
    expect(items[2].reason).toBeNull();
    expect(res.body.history.nextCursor).toBeNull();
  });

  it('pages the history with a cursor, newest first', async () => {
    const cm = await participationOf('KEDAI_KOPI', 'CM');
    await ah.post(`/api/participations/${cm.id}/cancel`);
    const first = await ah.get(`/api/shops/${KEDAI}/balance?limit=1`);
    expect(first.body.history.items.map((i: any) => i.kind)).toEqual(['refund']);
    expect(first.body.history.nextCursor).not.toBeNull();
    const second = await ah.get(
      `/api/shops/${KEDAI}/balance?limit=1&cursor=${first.body.history.nextCursor}`,
    );
    expect(second.body.history.items.map((i: any) => i.kind)).toEqual(['payment']);
    expect(second.body.history.items[0].runningBalanceSen).toBe(0);
    expect(second.body.history.nextCursor).toBeNull();
  });

  it('hides another shop’s balance, and keeps staff out', async () => {
    const siti = await app.as('siti');
    expect((await siti.get(`/api/shops/${KEDAI}/balance`)).status).toBe(404);
    const rahim = await app.as('rahim');
    expect((await rahim.get(`/api/shops/${KEDAI}/balance`)).status).toBe(403);
    expect((await ah.get('/api/shops/not-an-id/balance')).status).toBe(404);
  });

  it('lets Ops read a shop’s money history', async () => {
    const nadia = await app.as('nadia');
    const res = await nadia.get(`/api/shops/${KEDAI}/balance`);
    expect(res.status).toBe(200);
    expect(res.body.balanceSen).toBe(0);
    expect(res.body.history.items).toHaveLength(1);
  });
});
