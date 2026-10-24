/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are arbitrary JSON; tests assert on them */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { closeDueRounds } from '@/server/modules/rounds/close';
import { createTestApp, type TestApp } from './helpers/app';
import {
  lastWhatsapp,
  openRoundOf,
  opsApprovalOf,
  round,
  SUP_DRY,
  supplierOrderOf,
  toFormed,
} from './helpers/scenarios';

const CM = seedId('product', 'CM');
const CM_TIERS_SNAPSHOT = [
  { minQuantity: 20, unitPriceSen: 15800 },
  { minQuantity: 50, unitPriceSen: 15200 },
  { minQuantity: 100, unitPriceSen: 14600 },
];

const NEW_PRODUCT = {
  name: 'Palm cooking oil 5 kg',
  shortName: 'palm oil',
  category: 'oil',
  packDescription: 'carton of 4 x 5 kg bottles',
  unitName: 'carton',
  unitWeightGrams: 20000,
  buyAlonePriceSen: 12000,
  aliases: ['minyak masak'],
  cadence: 'weekly',
  cutoffWeekday: 4,
  cutoffTime: '20:00',
  tiers: [
    { minQuantity: 10, unitPriceSen: 11500 },
    { minQuantity: 30, unitPriceSen: 11000 },
  ],
};

let app: TestApp;
let cmRound: string;
beforeEach(async () => {
  app = await createTestApp();
  cmRound = (await openRoundOf('CM')).id;
});
afterEach(async () => {
  await app.close();
});

describe('Supplier self-service products', () => {
  it('keeps the open round frozen and uses new tiers from the next round (stories 113, 115)', async () => {
    const farid = await app.as('farid');
    const ah = await app.as('ahSeng');
    const patched = await farid.patch(`/api/suppliers/${SUP_DRY}/products/${CM}`, {
      tiers: [
        { minQuantity: 20, unitPriceSen: 15700 },
        { minQuantity: 50, unitPriceSen: 15100 },
        { minQuantity: 100, unitPriceSen: 14500 },
      ],
    });
    expect(patched.status).toBe(200);
    expect(patched.body.tiers).toHaveLength(3);
    expect((await round(cmRound)).tiersSnapshot).toEqual(CM_TIERS_SNAPSHOT);
    const before = await ah.get(`/api/rounds/${cmRound}/quote?quantity=6`);
    expect(before.status).toBe(200);
    expect(before.body.starting.allInSen).toBe(16409);
    app.clock.set('2026-11-05T12:00:00Z');
    await closeDueRounds(app.deps);
    expect((await openRoundOf('CM')).tiersSnapshot).toMatchObject([
      { minQuantity: 20, unitPriceSen: 15700 },
      { minQuantity: 50, unitPriceSen: 15100 },
      { minQuantity: 100, unitPriceSen: 14500 },
    ]);
  });

  it('keeps the open round in the unit and pack it opened with (story 115)', async () => {
    const farid = await app.as('farid');
    const ah = await app.as('ahSeng');
    const OLD = { unitName: 'carton', packDescription: 'carton of 48 × 390 g tins' };
    const NEW = { unitName: 'tin', packDescription: 'tin of 390 g' };
    const patched = await farid.patch(`/api/suppliers/${SUP_DRY}/products/${CM}`, NEW);
    expect(patched).toMatchObject({ status: 200, body: NEW });

    // Owners: the open round, the open-round list and the catalogue entry it shows.
    expect((await ah.get(`/api/rounds/${cmRound}`)).body).toMatchObject(OLD);
    const listed = (await ah.get('/api/rounds?status=open')).body.items;
    expect(listed.find((r: any) => r.roundId === cmRound)).toMatchObject(OLD);
    const catalogue = (await ah.get('/api/catalogue')).body.items;
    expect(catalogue.find((p: any) => p.productId === CM)).toMatchObject(OLD);
    // The supplier: its open-round totals.
    const supplierRounds = (await farid.get(`/api/suppliers/${SUP_DRY}/rounds?status=open`)).body;
    expect(supplierRounds.items.find((r: any) => r.roundId === cmRound)).toMatchObject({
      unitName: 'carton',
    });

    // At the cut-off the round's order, message and portal entry are still in cartons.
    await toFormed(app);
    const orderId = (await supplierOrderOf(cmRound)).id;
    const nadia = await app.as('nadia');
    const approved = await nadia.post(`/api/approvals/${await opsApprovalOf(orderId)}/approve`, {});
    expect(approved.status).toBe(200);
    expect(await lastWhatsapp('farid', 'supplier.new_order', 'condensed milk')).toMatch(
      /^New BeliKongsi order: \d+ cartons of condensed milk/,
    );
    const orders = (await farid.get(`/api/suppliers/${SUP_DRY}/orders`)).body.items;
    expect(orders.find((o: any) => o.supplierOrderId === orderId)).toMatchObject(OLD);

    // The next round opens with the new unit and pack.
    const next = await openRoundOf('CM');
    expect(next.id).not.toBe(cmRound);
    expect((await ah.get(`/api/rounds/${next.id}`)).body).toMatchObject(NEW);
  });

  it('says which round a change reaches first: the one after the open round', async () => {
    const res = await (await app.as('farid')).get(`/api/suppliers/${SUP_DRY}/products`);
    const cm = res.body.items.find((p: any) => p.productId === CM);
    // The open round closes Thu 5 Nov 8:00 pm MYT, so a change reaches the Thu 12 Nov round.
    expect((await round(cmRound)).cutoffAt.toISOString()).toBe('2026-11-05T12:00:00.000Z');
    expect(cm.nextRoundCutoffAt).toBe('2026-11-12T12:00:00.000Z');
    const off = await (
      await app.as('farid')
    ).patch(`/api/suppliers/${SUP_DRY}/products/${CM}`, { active: false });
    expect(off.body.nextRoundCutoffAt).toBeNull();
  });

  it('refuses a ladder that does not strictly improve, naming the positions', async () => {
    const r = await (
      await app.as('farid')
    ).patch(`/api/suppliers/${SUP_DRY}/products/${CM}`, {
      tiers: [
        { minQuantity: 20, unitPriceSen: 15800 },
        { minQuantity: 20, unitPriceSen: 15900 },
      ],
    });
    expect(r).toMatchObject({ status: 422, body: { code: 'INVALID_TIERS' } });
    expect(r.body.details.errors.map((e: any) => [e.code, e.position])).toEqual([
      ['MIN_QUANTITY_NOT_INCREASING', 2],
      ['PRICE_NOT_DECREASING', 2],
    ]);
  });

  it('checks the ladder against the new buy-alone price when both change', async () => {
    const farid = await app.as('farid');
    const url = `/api/suppliers/${SUP_DRY}/products/${CM}`;
    const r = await farid.patch(url, { buyAlonePriceSen: 15000 });
    expect(r).toMatchObject({ status: 422, body: { code: 'INVALID_TIERS' } });
    const ok = await farid.patch(url, {
      buyAlonePriceSen: 15000,
      tiers: [{ minQuantity: 20, unitPriceSen: 14000 }],
    });
    expect(ok.status).toBe(200);
    expect(ok.body.buyAlonePriceSen).toBe(15000);
  });

  it.each([
    ['24:00', 4],
    ['20:00', 8],
    ['20:00', 0],
    ['7pm', 4],
  ])('refuses cut-off %s on weekday %s', async (cutoffTime, cutoffWeekday) => {
    const farid = await app.as('farid');
    const r = await farid.patch(`/api/suppliers/${SUP_DRY}/products/${CM}`, {
      cutoffTime,
      cutoffWeekday,
    });
    expect(r.status).toBe(400);
  });

  it('refuses fields it does not know', async () => {
    const farid = await app.as('farid');
    const r = await farid.patch(`/api/suppliers/${SUP_DRY}/products/${CM}`, { colour: 'red' });
    expect(r.status).toBe(400);
  });

  it('opens the first round of a new product straight away', async () => {
    const farid = await app.as('farid');
    const created = await farid.post(`/api/suppliers/${SUP_DRY}/products`, NEW_PRODUCT);
    expect(created.status).toBe(201);
    const productId = created.body.productId as string;
    expect(created.body).toMatchObject({ name: 'Palm cooking oil 5 kg', active: true });
    const rounds = await app.prisma.round.findMany({ where: { productId } });
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({ status: 'open', supplierId: SUP_DRY });
    // Now is Monday 2 Nov 2026, 6:05 am in Malaysia: the cut-off is Thursday 5 Nov, 8:00 pm.
    expect(rounds[0]!.cutoffAt.toISOString()).toBe('2026-11-05T12:00:00.000Z');
    expect(rounds[0]!.tiersSnapshot).toEqual(NEW_PRODUCT.tiers);
    const product = await app.prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.imageAiGenerated).toBe(false);
    const log = await app.prisma.activityLogEntry.findMany({
      where: { action: 'product.created' },
    });
    expect(log).toHaveLength(1);
  });

  it('refuses a new product with a broken ladder and creates nothing', async () => {
    const farid = await app.as('farid');
    const r = await farid.post(`/api/suppliers/${SUP_DRY}/products`, {
      ...NEW_PRODUCT,
      tiers: [{ minQuantity: 10, unitPriceSen: 12000 }],
    });
    expect(r).toMatchObject({ status: 422, body: { code: 'INVALID_TIERS' } });
    expect(await app.prisma.product.count({ where: { name: NEW_PRODUCT.name } })).toBe(0);
  });

  it('lets an open round finish when a product is deactivated', async () => {
    const farid = await app.as('farid');
    const r = await farid.patch(`/api/suppliers/${SUP_DRY}/products/${CM}`, { active: false });
    expect(r.body.active).toBe(false);
    expect((await round(cmRound)).status).toBe('open');
    app.clock.set('2026-11-05T12:00:00Z');
    await closeDueRounds(app.deps);
    expect((await round(cmRound)).status).not.toBe('open');
    expect(await app.prisma.round.count({ where: { productId: CM, status: 'open' } })).toBe(0);
  });

  it('logs an update with before and after', async () => {
    const farid = await app.as('farid');
    await farid.patch(`/api/suppliers/${SUP_DRY}/products/${CM}`, { shortName: 'SKM tin' });
    const log = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'product.updated' },
    });
    expect(log.before).toMatchObject({ shortName: 'condensed milk' });
    expect(log.after).toMatchObject({ shortName: 'SKM tin' });
  });

  it("hides another supplier's products", async () => {
    const lim = await app.as('lim');
    const r = await lim.patch(`/api/suppliers/${SUP_DRY}/products/${CM}`, { active: false });
    expect(r.status).toBe(404);
    expect((await lim.post(`/api/suppliers/${SUP_DRY}/products`, NEW_PRODUCT)).status).toBe(404);
    expect((await app.prisma.product.findUniqueOrThrow({ where: { id: CM } })).active).toBe(true);
  });

  it('keeps owners out', async () => {
    const ah = await app.as('ahSeng');
    expect(
      (await ah.patch(`/api/suppliers/${SUP_DRY}/products/${CM}`, { active: false })).status,
    ).toBe(403);
  });
});
