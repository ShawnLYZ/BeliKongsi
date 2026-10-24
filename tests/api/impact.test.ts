import { afterEach, describe, expect, it } from 'vitest';
import { nextConsignmentStep } from '@/lib/consignment-steps';
import { seedId } from '../../prisma/seed/ids';
import { SAMPLE_ORDER_TEXT } from '../../prisma/seed/sample-order';
import { createTestApp, type TestApp } from './helpers/app';
import {
  allocationOf,
  basketIdOf,
  consignmentFor,
  moveConsignment,
  paymentOfBasket,
  payBasket,
  pickupOf,
  setupKedaiKopi,
  supplierOrderOf,
  roundOf,
  toHubChecked,
  uploadPhoto,
} from './helpers/scenarios';

const KEDAI = seedId('shop', 'KEDAI_KOPI');
const p = (k: string) => seedId('product', k);
let app: TestApp;

afterEach(async () => {
  await app.close();
});

// Units expected at the delivery checks of real shops: the seeded history week's checks (28) plus
// this test's one pickup line (6 cartons of CM). Simulated (background) shops' automatic
// "All received" checks are not counted; they used to push this to 862.
const DELIVERED_UNITS = 34;

describe('the impact panel', () => {
  it('shows dashes, not errors, before any data', async () => {
    app = await createTestApp({ seed: 'reference' });
    const res = await (await app.as('nadia')).get('/api/ops/impact');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      timeToApprove: { medianMinutes: null, p90Minutes: null, samples: 0 },
      basketApprovalRate: { approved: 0, drafted: 0, rate: null },
      aiLinesAcceptedUnchanged: { accepted: 0, suggested: 0, rate: null },
      claimRate: { claimedUnits: 0, deliveredUnits: 0, rate: null },
      supplierReliability: [],
    });
  });

  it('computes the panel from a known week', async () => {
    app = await createTestApp({ seed: 'demo' });
    await setupKedaiKopi(app);
    const ah = await app.as('ahSeng');
    const parsed = await ah.post(`/api/shops/${KEDAI}/usual-list/parse`, {
      text: SAMPLE_ORDER_TEXT,
    });
    const saved = await ah.put(`/api/shops/${KEDAI}/usual-list`, {
      suggestionRunId: parsed.body.suggestionRunId,
      items: [
        { productId: p('EGG_A'), quantity: 10, usualPriceSen: 1200 },
        { productId: p('OIL'), quantity: 3, usualPriceSen: 9000 },
        { productId: p('CM'), quantity: 6, usualPriceSen: 16500 },
        { productId: p('COFFEE'), quantity: 1, usualPriceSen: 25800 },
        { productId: p('EM'), quantity: 1, usualPriceSen: 15000 },
      ],
    });
    expect(saved.status).toBe(200);

    const basketId = (await basketIdOf('KEDAI_KOPI', '2026-W45'))!;
    await payBasket(app, 'ahSeng', basketId);
    await app.prisma.weeklyBasket.update({
      where: { id: basketId },
      data: { firstOpenedAt: new Date('2026-11-01T22:10:00Z') },
    });
    const payment = await paymentOfBasket('KEDAI_KOPI');
    await app.prisma.payment.update({
      where: { id: payment.id },
      data: { completedAt: new Date('2026-11-01T22:13:00Z') },
    });

    const res = await (await app.as('nadia')).get('/api/ops/impact');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      timeToApprove: { medianMinutes: 3, p90Minutes: 3, samples: 1 },
      basketApprovalRate: { approved: 5, drafted: 5, rate: 1 },
      aiLinesAcceptedUnchanged: { accepted: 3, suggested: 5, rate: 0.6 },
    });
  });

  it('keeps the panel for Ops only', async () => {
    app = await createTestApp({ seed: 'reference' });
    const res = await (await app.as('ahSeng')).get('/api/ops/impact');
    expect(res.status).toBe(403);
  });

  it('counts a damaged carton against the units checked at delivery', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, ['CM', 'OIL', 'EGG_A', 'COFFEE', 'CUPS']);
    const PP_IPOH = seedId('pickup_point', 'PP_IPOH');
    for (const hub of ['HUB_KV', 'HUB_JOHOR']) {
      const c = await consignmentFor({
        hub,
        destinationKey: `pp:${PP_IPOH}`,
        deliveryDate: '2026-11-10',
      });
      await moveConsignment(app, c.id, 'dispatched');
      await moveConsignment(app, c.id, 'arrived');
    }
    const pickup = await pickupOf('KEDAI_KOPI', '2026-11-10');
    const rahim = await app.as('rahim');
    await rahim.post(`/api/pickups/${pickup.id}/collect`, { code: pickup.code });
    const photo = await uploadPhoto(rahim, pickup.id);
    const checked = await rahim.post(`/api/pickups/${pickup.id}/delivery-check`, {
      lines: [
        {
          allocationId: (await allocationOf('KEDAI_KOPI', 'CM')).id,
          missing: 0,
          damaged: 1,
          photoIds: [photo],
        },
      ],
    });
    expect(checked.status).toBe(200);

    const res = await (await app.as('nadia')).get('/api/ops/impact');
    expect(res.body.claimRate).toEqual({
      claimedUnits: 1,
      deliveredUnits: DELIVERED_UNITS,
      rate: 1 / DELIVERED_UNITS,
    });
  });

  it('leaves the automatic checks of simulated shops out of the claim rate', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, ['CM', 'OIL', 'EGG_A', 'COFFEE', 'CUPS']);
    const consignments = await app.prisma.consignment.findMany({ orderBy: { wave: 'asc' } });
    for (const c of consignments) {
      let next = nextConsignmentStep(c.destinationType, c.status);
      while (next) {
        await moveConsignment(app, c.id, next);
        next = nextConsignmentStep(c.destinationType, next);
      }
    }
    const background = (
      await app.prisma.shop.findMany({ where: { isBackground: true }, select: { id: true } })
    ).map((x) => x.id);
    const backgroundChecks = await app.prisma.deliveryCheckLine.aggregate({
      where: { deliveryCheck: { pickup: { shopId: { in: background } } } },
      _sum: { expected: true },
    });
    const allChecks = await app.prisma.deliveryCheckLine.aggregate({ _sum: { expected: true } });
    expect(backgroundChecks._sum.expected ?? 0).toBeGreaterThan(0);

    const res = await (await app.as('nadia')).get('/api/ops/impact');
    expect(res.body.claimRate.deliveredUnits).toBe(
      (allChecks._sum.expected ?? 0) - (backgroundChecks._sum.expected ?? 0),
    );
  });

  it('leaves the saved example out of the AI lines accepted unchanged', async () => {
    app = await createTestApp({ seed: 'demo' });
    await setupKedaiKopi(app);
    const ah = await app.as('ahSeng');
    const example = await ah.post(`/api/shops/${KEDAI}/usual-list/parse`, {
      text: SAMPLE_ORDER_TEXT,
      useSavedExample: true,
    });
    expect(example.body.source).toBe('saved_example');
    const saved = await ah.put(`/api/shops/${KEDAI}/usual-list`, {
      suggestionRunId: example.body.suggestionRunId,
      items: [{ productId: p('CM'), quantity: 6, usualPriceSen: 16500 }],
    });
    expect(saved.status).toBe(200);

    const res = await (await app.as('nadia')).get('/api/ops/impact');
    expect(res.body.aiLinesAcceptedUnchanged).toEqual({ accepted: 0, suggested: 0, rate: null });
  });

  it("reports a supplier's confirmation time and good units once the hub has checked", async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, ['CM'], { goodUnits: 1 });
    const so = await supplierOrderOf((await roundOf('CM', '2026-W45')).id);
    const created = new Date('2026-11-04T01:00:00Z');
    await app.prisma.supplierOrder.updateMany({
      where: { supplierId: so.supplierId },
      data: { createdAt: created, confirmedAt: new Date(created.getTime() + 90 * 60_000) },
    });

    const res = await (await app.as('nadia')).get('/api/ops/impact');
    // Five seeded history orders were fully good (314 of 314); this one 1 of 105: 315 of 419.
    expect(
      res.body.supplierReliability.find(
        (r: { supplierId: string }) => r.supplierId === so.supplierId,
      ),
    ).toEqual({
      supplierId: so.supplierId,
      supplierName: 'Pembekal Barang Kering Contoh',
      medianConfirmationHours: 1.5,
      goodUnitsRate: 315 / 419,
    });
  });
});
