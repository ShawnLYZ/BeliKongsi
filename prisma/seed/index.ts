import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isoWeekOf } from '@/lib/time';
import { systemCaller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { withTransaction, type TxContext } from '@/server/platform/tx';
import { openNextRound } from '@/server/modules/rounds/open';
import { CUTOFF_TIME, CUTOFF_WEEKDAY, PRODUCTS } from './catalogue';
import { seedId } from './ids';
import {
  HUBS,
  OPERATOR,
  PICKUP_OPENING_HOURS,
  PICKUP_POINTS,
  SEED_USERS,
  SUPPLIERS,
} from './network';
import { BACKGROUND_SHOPS, DEMO_SHOPS, USUAL_LISTS } from './shops';

export { SAMPLE_ORDER_TEXT, SAMPLE_USUAL_PRICES_SEN } from './sample-order';

export const SEED_VERSION = 'reference-1';
const DAY_MS = 24 * 60 * 60 * 1000;

const PRODUCT_IMAGE_DIR = 'prisma/seed/assets/products';

/** Copies the seed pictures into local storage; a missing or empty folder is fine. */
export async function seedProductImages(deps: AppDeps): Promise<void> {
  if (deps.env.STORAGE_ADAPTER !== 'local') return;
  let files: string[];
  try {
    files = (await readdir(PRODUCT_IMAGE_DIR)).filter((f) => f.endsWith('.webp'));
  } catch {
    return;
  }
  for (const file of files) {
    const bytes = await readFile(join(PRODUCT_IMAGE_DIR, file));
    await deps.storage.putObject('product-images', file, bytes, 'image/webp');
  }
}

/**
 * Inserts the reference data: network, catalogue, shops, people and usual lists. Reference rows
 * are not actions, so they write no log entries.
 */
export async function seedReferenceData(
  ctx: TxContext,
  opts: { anchorMonday: Date },
): Promise<void> {
  const { tx } = ctx;
  const anchorWeek = isoWeekOf(opts.anchorMonday);
  // Shops were set up and usual lists confirmed a week before the demo week starts.
  const setUpAt = new Date(opts.anchorMonday.getTime() - 7 * DAY_MS);

  await tx.operator.create({ data: { id: seedId('operator', OPERATOR.key), name: OPERATOR.name } });

  await tx.hub.createMany({
    data: HUBS.map((h) => ({
      id: seedId('hub', h.key),
      name: h.name,
      region: h.region,
      address: h.address,
      lat: h.lat,
      lng: h.lng,
    })),
  });

  await tx.pickupPoint.createMany({
    data: PICKUP_POINTS.map((p) => ({
      id: seedId('pickup_point', p.key),
      name: p.name,
      address: p.address,
      state: p.state,
      lat: p.lat,
      lng: p.lng,
      openingHours: PICKUP_OPENING_HOURS,
      active: true,
    })),
  });

  await tx.supplier.createMany({
    data: SUPPLIERS.map((s) => ({
      id: seedId('supplier', s.key),
      name: s.name,
      categories: s.categories,
      region: s.region,
      hubId: seedId('hub', s.hub),
      contactName: s.contactName,
      contactPhone: s.contactPhone,
      status: 'active' as const,
    })),
  });

  await tx.product.createMany({
    data: PRODUCTS.map((p) => ({
      id: seedId('product', p.key),
      supplierId: seedId('supplier', p.supplier),
      name: p.name,
      shortName: p.shortName,
      category: p.category,
      packDescription: p.packDescription,
      unitName: p.unitName,
      unitWeightGrams: p.unitWeightGrams,
      buyAlonePriceSen: p.buyAlonePriceSen,
      aliases: p.aliases,
      packConversions: p.packConversions,
      imageKey: p.imageKey ?? null,
      imageAiGenerated: p.imageKey != null,
      cadence: p.cadence,
      scheduleAnchorWeek: anchorWeek,
      cutoffWeekday: CUTOFF_WEEKDAY,
      cutoffTime: CUTOFF_TIME,
      active: true,
    })),
  });

  await tx.priceTier.createMany({
    data: PRODUCTS.flatMap((p) =>
      p.tiers.map((tier, i) => ({
        id: seedId('price_tier', `${p.key}:${i + 1}`),
        productId: seedId('product', p.key),
        position: i + 1,
        minQuantity: tier.minQuantity,
        unitPriceSen: tier.unitPriceSen,
      })),
    ),
  });

  await tx.shop.createMany({
    data: [...DEMO_SHOPS, ...BACKGROUND_SHOPS].map((s) => ({
      id: seedId('shop', s.key),
      name: s.name,
      type: s.type,
      address: s.address,
      state: s.state,
      postcode: s.postcode,
      lat: s.lat,
      lng: s.lng,
      defaultFulfilment: s.fulfilment,
      defaultPickupPointId: s.pickupPoint ? seedId('pickup_point', s.pickupPoint) : null,
      isBackground: s.isBackground,
      setupCompletedAt: s.setupDone ? setUpAt : null,
      createdAt: setUpAt,
    })),
  });

  await tx.user.createMany({
    data: SEED_USERS.map((u) => ({
      id: seedId('user', u.key),
      displayName: u.displayName,
      email: u.email,
      phone: u.phone,
      signInProvider: u.signInProvider,
      createdAt: setUpAt,
    })),
  });

  await tx.membership.createMany({
    data: SEED_USERS.map((u) => ({
      id: seedId('membership', u.key),
      userId: seedId('user', u.key),
      orgType: u.target.orgType,
      shopId: u.target.orgType === 'shop' ? seedId('shop', u.target.shop) : null,
      supplierId: u.target.orgType === 'supplier' ? seedId('supplier', u.target.supplier) : null,
      operatorId: u.target.orgType === 'operator' ? seedId('operator', OPERATOR.key) : null,
      role: u.role,
    })),
  });

  const usualShops = Object.keys(USUAL_LISTS) as (keyof typeof USUAL_LISTS)[];
  await tx.usualList.createMany({
    data: usualShops.map((shop) => ({
      id: seedId('usual_list', shop),
      shopId: seedId('shop', shop),
      confirmedAt: setUpAt,
      updatedAt: setUpAt,
    })),
  });
  await tx.usualListItem.createMany({
    data: usualShops.flatMap((shop) =>
      USUAL_LISTS[shop].map((item) => ({
        id: seedId('usual_list_item', `${shop}:${item.product}`),
        usualListId: seedId('usual_list', shop),
        productId: seedId('product', item.product),
        quantity: item.quantity,
        usualPriceSen: item.usualPriceSen,
        priceLimitSen: item.usualPriceSen,
      })),
    ),
  });

  await tx.demoSettings.update({
    where: { id: 1 },
    data: {
      featuredProductId: seedId('product', 'CM'),
      seedVersion: SEED_VERSION,
      lastResetAt: ctx.now,
    },
  });
}

/**
 * Temporary phase: opens the first round of every active product at the anchor so the dev
 * database and demo tests have open rounds. M4 replaces it with seedCurrentWeek.
 */
async function openRoundsAtAnchor(ctx: TxContext, anchor: Date): Promise<void> {
  const products = await ctx.tx.product.findMany({
    where: { active: true },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  for (const { id } of products) await openNextRound(ctx, id, anchor);
}

/** Seeds the whole demo world in one transaction. */
export async function seedDemo(deps: AppDeps, opts: { anchorMonday: Date }): Promise<void> {
  await seedProductImages(deps);
  await withTransaction(
    deps,
    systemCaller('seed demo data'),
    async (ctx) => {
      await seedReferenceData(ctx, opts);
      // Later milestones add their phases here, in this order: M9 seeds the history week, then
      // M4 seeds the current week.
      await openRoundsAtAnchor(ctx, opts.anchorMonday);
    },
    { timeoutMs: 60_000 },
  );
}
