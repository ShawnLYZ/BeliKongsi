/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are arbitrary JSON; tests assert on them */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { roundProgress } from '@/server/modules/rounds/read';
import { openNextRound } from '@/server/modules/rounds/open';
import { systemCaller } from '@/server/platform/caller';
import { withTransaction } from '@/server/platform/tx';
import { createTestApp, type TestApp } from './helpers/app';
import { insertParticipation } from './helpers/builders';
import { expectNoMoneyFields } from './helpers/scans';

let app: TestApp;
let cmRound: string;
beforeEach(async () => {
  app = await createTestApp();
  cmRound = (
    await app.prisma.round.findFirstOrThrow({
      where: { productId: seedId('product', 'CM'), status: 'open' },
    })
  ).id;
});
afterEach(async () => {
  await app.close();
});

describe('bad ids and roles (G8)', () => {
  const notFoundBody = { code: 'NOT_FOUND', message: expect.any(String) };

  it('404s a malformed round id', async () => {
    const res = await (await app.as('ahSeng')).get('/api/rounds/abc');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject(notFoundBody);
  });

  it('404s a quote for a malformed round id', async () => {
    const res = await (await app.as('ahSeng')).get('/api/rounds/abc/quote?quantity=1');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject(notFoundBody);
  });

  it('403s a supplier on the catalogue', async () => {
    const res = await (await app.as('farid')).get('/api/catalogue');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'FORBIDDEN', message: expect.any(String) });
  });
});

describe('catalogue search', () => {
  it.each(['炼奶', 'susu pekat', 'SKM', 'ＳＫＭ ', 'Susu  Pekat'])(
    'finds condensed milk for "%s"',
    async (q) => {
      const res = await (await app.as('ahSeng')).get(`/api/catalogue?q=${encodeURIComponent(q)}`);
      expect(res.body.items[0].productId).toBe(seedId('product', 'CM'));
    },
  );

  it('gives seeded products an AI-generated picture served from storage', async () => {
    const res = await (await app.as('rahim')).get('/api/catalogue');
    const cm = res.body.items.find((i: any) => i.productId === seedId('product', 'CM'));
    expect(cm.imageUrl).toMatch(/\/api\/storage\/local\/product-images\/cm\.webp$/);
    expect(cm.imageAiGenerated).toBe(true);
  });

  it('shows staff names and pictures but no prices', async () => {
    const res = await (await app.as('rahim')).get('/api/catalogue');
    expect(res.body.items).toHaveLength(12);
    expectNoMoneyFields(res.body);
  });

  it('shows owners the tiers and the buy-alone price', async () => {
    const cm = (await (await app.as('ahSeng')).get('/api/catalogue?q=SKM')).body.items[0];
    expect(cm).toMatchObject({
      buyAlonePriceSen: 16800,
      tiers: [
        { position: 1, minQuantity: 20, unitPriceSen: 15800 },
        { position: 2 },
        { position: 3 },
      ],
      imageUrl: expect.stringMatching(/cm.webp$/),
      // The seeded week: 6 background shops, Gerai and Kafe (index §5.7).
      openRound: { roundId: cmRound, totalQuantity: 99, shopCount: 8, currentTier: 2 },
    });
  });

  it('lists every item for an empty search', async () => {
    const res = await (await app.as('ahSeng')).get('/api/catalogue');
    expect(res.body.items).toHaveLength(12);
  });
});

describe('round progress', () => {
  it('counts active units and shops for round progress', async () => {
    // The seeded week leaves the KRAFT round empty (index §5.7); its tiers are 10, 25 and 50.
    const kraftRound = (
      await app.prisma.round.findFirstOrThrow({
        where: { productId: seedId('product', 'KRAFT'), status: 'open' },
      })
    ).id;
    const shops = await app.prisma.shop.findMany({ take: 8, orderBy: { id: 'asc' } });
    expect(shops).toHaveLength(8);
    // Eight shops with 5 cartons each, one of them with a second row of 5 (45 in all).
    for (const shop of shops) {
      await insertParticipation(app.prisma, {
        roundId: kraftRound,
        shopId: shop.id,
        quantity: 5,
        unitShippingSen: 293,
      });
    }
    await insertParticipation(app.prisma, {
      roundId: kraftRound,
      shopId: shops[7]!.id,
      quantity: 5,
      unitShippingSen: 293,
    });
    await insertParticipation(app.prisma, {
      roundId: kraftRound,
      shopId: shops[0]!.id,
      quantity: 50,
      unitShippingSen: 293,
      status: 'cancelled',
    });
    expect(await roundProgress(app.prisma, kraftRound)).toEqual({
      totalQuantity: 45,
      shopCount: 8,
      currentTier: 2,
      unitsToNextTier: 5,
      nextTierUnitPriceSen: 10000,
    });
  });
});

describe('round detail', () => {
  it("never shows owners other shops' names or quantities (stories 44, 145)", async () => {
    const gerai = seedId('shop', 'GERAI');
    await insertParticipation(app.prisma, {
      roundId: cmRound,
      shopId: seedId('shop', 'KAFE'),
      quantity: 7,
      unitShippingSen: 300,
    });
    await insertParticipation(app.prisma, {
      roundId: cmRound,
      shopId: seedId('shop', 'KEDAI_KOPI'),
      quantity: 13,
      unitShippingSen: 293,
    });
    // Gerai's own CM line (4 cartons) and the background shops' lines come from the seeded week.
    const res = await (await app.as('siti')).get(`/api/rounds/${cmRound}`);
    expect(res.status).toBe(200);
    const s = JSON.stringify(res.body);
    expect(s).not.toMatch(/Kafe Contoh|Kedai Kopi Contoh|Kopitiam Contoh/);
    expect(res.body.myParticipations).toHaveLength(1);
    expect(res.body.myParticipations.every((p: any) => p.shopId === gerai)).toBe(true);
    expect(res.body.progress).toMatchObject({ totalQuantity: 119, shopCount: 9 });
  });

  it('says when the next round closes after a missed cut-off (story 50)', async () => {
    await app.prisma.round.update({ where: { id: cmRound }, data: { status: 'failed' } });
    const next = await withTransaction(app.deps, systemCaller('test'), (ctx) =>
      openNextRound(ctx, seedId('product', 'CM'), app.clock.now()),
    );
    const res = await (await app.as('ahSeng')).get(`/api/rounds/${cmRound}`);
    expect(res.body.status).toBe('failed');
    expect(res.body.nextRoundCutoffAt).toBe(next.cutoffAt.toISOString());
    const open = await (await app.as('ahSeng')).get(`/api/rounds/${next.id}`);
    expect(open.body.nextRoundCutoffAt).toBeNull();
  });

  it('lists open rounds with the shop price at its own destination', async () => {
    const res = await (await app.as('ahSeng')).get('/api/rounds');
    expect(res.body.items).toHaveLength(12);
    const cm = res.body.items.find((r: any) => r.roundId === cmRound);
    expect(cm.myPrice).toMatchObject({
      unitShippingSen: 293,
      startingAllInSen: 16409,
      // The seeded 99 cartons put the round at tier 2: 15200 + 304 + 293.
      projectedAllInSen: 15797,
    });
    const staff = await (await app.as('rahim')).get('/api/rounds');
    expect(staff.body.items).toHaveLength(12);
    expectNoMoneyFields(staff.body);
  });
});

describe('quotes', () => {
  it('quotes Kedai Kopi Contoh at the Ipoh pickup point', async () => {
    const res = await (
      await app.as('ahSeng')
    ).get(
      `/api/rounds/${cmRound}/quote?quantity=6&destination=pickup:${seedId('pickup_point', 'PP_IPOH')}`,
    );
    expect(res.body).toMatchObject({
      unitShippingSen: 293,
      starting: { allInSen: 16409 },
      startingLineSen: 98454,
      deliveryFeeSen: null,
    });
  });

  it('quotes door delivery with the delivery fee', async () => {
    const res = await (
      await app.as('siti')
    ).get(`/api/rounds/${cmRound}/quote?quantity=4&destination=door`);
    expect(res.body).toMatchObject({ unitShippingSen: 429, deliveryFeeSen: 1200 });
  });

  it("uses the shop's default destination when none is given", async () => {
    const res = await (await app.as('ahSeng')).get(`/api/rounds/${cmRound}/quote?quantity=1`);
    expect(res.body).toMatchObject({ unitShippingSen: 293, deliveryFeeSen: null });
  });

  it('refuses door delivery beyond 20 km', async () => {
    await app.prisma.shop.update({
      where: { id: seedId('shop', 'KEDAI_KOPI') },
      data: { lat: 6.1, lng: 102.2 },
    });
    const res = await (
      await app.as('ahSeng')
    ).get(`/api/rounds/${cmRound}/quote?quantity=1&destination=door`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('DOOR_TOO_FAR');
  });

  it('keeps staff out of quotes and rejects a bad destination', async () => {
    const staff = await (await app.as('rahim')).get(`/api/rounds/${cmRound}/quote?quantity=1`);
    expect(staff.status).toBe(403);
    const bad = await (
      await app.as('ahSeng')
    ).get(`/api/rounds/${cmRound}/quote?quantity=1&destination=moon`);
    expect(bad.status).toBe(400);
  });
});
