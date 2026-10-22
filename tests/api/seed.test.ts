import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PRODUCTS } from '../../prisma/seed/catalogue';
import { seedId } from '../../prisma/seed/ids';
import { seedDemo } from '../../prisma/seed';
import { validateTiers } from '@/server/engine/tiers';
import { createTestDeps } from './helpers/app';

const ANCHOR = new Date('2026-11-01T22:05:00Z');

let t: Awaited<ReturnType<typeof createTestDeps>>;

beforeEach(async () => {
  t = await createTestDeps();
});
afterEach(async () => {
  await t.close();
});

async function sortedIds(prisma: typeof t.deps.prisma): Promise<string[]> {
  const [products, shops] = await Promise.all([
    prisma.product.findMany({ select: { id: true } }),
    prisma.shop.findMany({ select: { id: true } }),
  ]);
  return [...products, ...shops].map((r) => r.id).sort();
}

describe('seed', () => {
  it('seeds the network, catalogue, shops and people', async () => {
    await seedDemo(t.deps, { anchorMonday: ANCHOR });
    const p = t.deps.prisma;
    expect(
      await Promise.all([
        p.hub.count(),
        p.pickupPoint.count(),
        p.supplier.count(),
        p.product.count(),
        p.priceTier.count(),
        p.shop.count(),
        p.user.count(),
      ]),
    ).toEqual([2, 6, 3, 12, 36, 43, 10]);
    expect(await p.shop.count({ where: { isBackground: true } })).toBe(40);
  });

  it('gives every user exactly one membership with the key as its id', async () => {
    await seedDemo(t.deps, { anchorMonday: ANCHOR });
    const p = t.deps.prisma;
    expect(await p.membership.count()).toBe(10);
    const mei = await p.membership.findUniqueOrThrow({
      where: { id: seedId('membership', 'mei') },
    });
    expect(mei).toMatchObject({
      userId: seedId('user', 'mei'),
      shopId: seedId('shop', 'KAFE'),
      role: 'owner',
    });
  });

  it('gives every product a ladder the engine accepts', async () => {
    await seedDemo(t.deps, { anchorMonday: ANCHOR });
    const products = await t.deps.prisma.product.findMany({
      include: { tiers: { orderBy: { position: 'asc' } } },
    });
    expect(products).toHaveLength(12);
    for (const product of products) {
      const tiers = product.tiers.map((x) => ({
        minQuantity: x.minQuantity,
        unitPriceSen: x.unitPriceSen,
      }));
      expect(tiers).toHaveLength(3);
      expect(validateTiers(tiers, { buyAlonePriceSen: product.buyAlonePriceSen })).toEqual({
        ok: true,
      });
    }
  });

  it('names every business "… Contoh"', async () => {
    await seedDemo(t.deps, { anchorMonday: ANCHOR });
    const p = t.deps.prisma;
    const names = [
      ...(await p.shop.findMany({ select: { name: true } })),
      ...(await p.supplier.findMany({ select: { name: true } })),
    ].map((r) => r.name);
    expect(names).toHaveLength(46);
    for (const name of names) expect(name).toMatch(/Contoh/);
  });

  it('uses the same ids after a second seed into an empty database', async () => {
    await seedDemo(t.deps, { anchorMonday: ANCHOR });
    const first = await sortedIds(t.deps.prisma);
    const other = await createTestDeps();
    try {
      await seedDemo(other.deps, { anchorMonday: ANCHOR });
      expect(await sortedIds(other.deps.prisma)).toEqual(first);
    } finally {
      await other.close();
    }
    expect(first).toContain(seedId('product', 'CM'));
    expect(first).toContain(seedId('shop', 'BG40'));
  });

  it('anchors fortnightly products on the demo week', async () => {
    await seedDemo(t.deps, { anchorMonday: ANCHOR });
    expect(
      (await t.deps.prisma.product.findUniqueOrThrow({ where: { id: seedId('product', 'CUPS') } }))
        .scheduleAnchorWeek,
    ).toBe('2026-W45');
  });

  it('features the condensed milk round in the demo settings', async () => {
    await seedDemo(t.deps, { anchorMonday: ANCHOR });
    const settings = await t.deps.prisma.demoSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(settings.featuredProductId).toBe(seedId('product', 'CM'));
  });

  it('seeds the usual lists of Gerai and Kafe and none for Kedai Kopi', async () => {
    await seedDemo(t.deps, { anchorMonday: ANCHOR });
    const p = t.deps.prisma;
    const items = async (shop: string) =>
      (
        await p.usualListItem.findMany({
          where: { usualList: { shopId: seedId('shop', shop) } },
          include: { product: true },
        })
      )
        .map((i) => [i.product.shortName, i.quantity, i.usualPriceSen, i.priceLimitSen])
        .sort();
    expect(await items('GERAI')).toEqual(
      [
        ['condensed milk', 4, 16800, 16800],
        ['evaporated milk', 2, 15000, 15000],
        ['flour', 2, 7200, 7200],
        ['takeaway containers', 3, 9800, 9800],
      ].sort(),
    );
    expect(await items('KAFE')).toEqual(
      [
        ['condensed milk', 3, 16700, 16700],
        ['Grade B eggs', 10, 1220, 1220],
        ['coffee powder', 2, 25800, 25800],
        ['16 oz cups', 3, 13200, 13200],
      ].sort(),
    );
    expect(await p.usualList.count({ where: { shopId: seedId('shop', 'KEDAI_KOPI') } })).toBe(0);
  });

  it('spreads background shops over types, regions and door delivery', async () => {
    await seedDemo(t.deps, { anchorMonday: ANCHOR });
    const p = t.deps.prisma;
    const bg5 = await p.shop.findUniqueOrThrow({ where: { id: seedId('shop', 'BG05') } });
    expect(bg5).toMatchObject({
      name: 'Bakeri Contoh 05',
      defaultFulfilment: 'door',
      defaultPickupPointId: null,
      isBackground: true,
    });
    const bg7 = await p.shop.findUniqueOrThrow({ where: { id: seedId('shop', 'BG07') } });
    expect(bg7).toMatchObject({
      name: 'Warung Contoh 07',
      type: 'hawker',
      defaultFulfilment: 'pickup',
      defaultPickupPointId: seedId('pickup_point', 'PP_IPOH'),
      lat: 4.5975 + 0.01 * 3,
      lng: 101.0901 + 0.01 * 1,
    });
    expect(await p.shop.count({ where: { defaultFulfilment: 'door' } })).toBe(9);
  });

  it('keeps one catalogue row per product key', () => {
    expect(new Set(PRODUCTS.map((x) => x.key)).size).toBe(12);
  });
});
