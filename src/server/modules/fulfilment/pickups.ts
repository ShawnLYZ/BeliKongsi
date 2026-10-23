import type { ConsignmentStatus, Pickup, RoundStatus } from '@/generated/prisma/client';
import type { PickupLineView, PickupStatusLabel, PickupView } from '@/lib/views/pickups';
import { lockShop } from '@/server/modules/payments/fee';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { AppError, conflict, notFound, unprocessable } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireShopAccess } from '@/server/platform/permissions';
import { withTransaction } from '@/server/platform/tx';
import { productImageUrl } from '@/server/modules/rounds/read';
import { HANDED_OVER, handOverPickup, handoverFrom } from './handover';
import { destinationKeyOf, lockDestinations } from './plan';

const SHOP_ROLES = ['owner', 'staff'] as const;

/** Consignment statuses at which a waiting pickup's goods have left the hub (Ruling C). */
const LEFT_HUB: ConsignmentStatus[] = [
  'dispatched',
  'arrived',
  'out_for_delivery',
  'delivered',
  'completed',
];

/** Round statuses at which the supplier has sent the goods to the hub. */
const LEFT_SUPPLIER: RoundStatus[] = ['dispatched', 'at_hub', 'completed'];

/**
 * The shop's owner or staff hand a pickup over with its code (PRD §10, story 76): a ready
 * pickup-point pickup becomes `collected`, a door pickup out for delivery becomes `delivered`.
 * Another shop's pickup is 404, a code that does not match is 422 `WRONG_CODE` (the pickup is
 * unchanged), and a pickup in any other state is 409 `NOT_READY`. Takes the shop lock, then the
 * destination's, so it never races a status move, readiness or a second collect.
 */
export async function collectPickup(
  deps: AppDeps,
  caller: Caller,
  pickupId: string,
  input: { code: string },
): Promise<PickupView> {
  if (!UUID.test(pickupId)) throw notFound('Pickup');
  const shopId = await withTransaction(deps, caller, async (ctx) => {
    const { tx } = ctx;
    const head = await tx.pickup.findUnique({
      where: { id: pickupId },
      select: { shopId: true, destinationKey: true },
    });
    if (!head) throw notFound('Pickup');
    try {
      requireShopAccess(caller, head.shopId, SHOP_ROLES);
    } catch (error) {
      // Another shop's pickup is not visible at all.
      if (error instanceof AppError && error.status === 404) throw notFound('Pickup');
      throw error;
    }
    await lockShop(ctx, head.shopId);
    await lockDestinations(ctx, [head.destinationKey]);
    const pickup = await tx.pickup.findUniqueOrThrow({ where: { id: pickupId } });

    if (input.code.replace(/\s+/g, '') !== pickup.code) {
      throw unprocessable('WRONG_CODE', 'That code does not match this pickup. Please check it.');
    }
    if (pickup.status !== handoverFrom(pickup) || !(await handOverPickup(ctx, pickup))) {
      throw conflict(
        'NOT_READY',
        pickup.destinationType === 'door'
          ? 'These goods are not out for delivery.'
          : 'These goods are not ready for pickup.',
      );
    }
    return pickup.shopId;
  });
  const views = await pickupViews(deps, shopId);
  return views.find((v) => v.pickupId === pickupId)!;
}

/**
 * A shop's pickup tracker for owner and staff (stories 71, 99, 100), without money (R6).
 * `upcoming` holds what is not handed over yet, including goods of kept rounds not yet planned
 * into a pickup (their own group per place and date, beside any pickup there); `past` holds what
 * was collected or delivered.
 * Without a status, both: upcoming first (soonest date first), then past (latest first).
 */
export async function listShopPickups(
  deps: AppDeps,
  caller: Caller,
  shopId: string,
  filter: { status?: 'upcoming' | 'past' },
): Promise<{ items: PickupView[] }> {
  requireShopAccess(caller, shopId, SHOP_ROLES);
  if (!UUID.test(shopId)) throw notFound('Shop');
  const views = await pickupViews(deps, shopId);
  const isPast = (v: PickupView) => HANDED_OVER.includes(v.status);
  const upcoming = views.filter((v) => !isPast(v));
  const past = views.filter(isPast).reverse();
  if (filter.status === 'upcoming') return { items: upcoming };
  if (filter.status === 'past') return { items: past };
  return { items: [...upcoming, ...past] };
}

type Part = {
  id: string;
  quantity: number;
  destinationType: 'pickup_point' | 'door';
  pickupPointId: string | null;
  shopId: string;
  deliveryDate: string;
  round: {
    status: RoundStatus;
    product: {
      name: string;
      unitName: string;
      category: string;
      imageKey: string | null;
      imageAiGenerated: boolean;
    };
  };
};

/** Every pickup and not-yet-planned group of a shop, by delivery date (soonest first). */
async function pickupViews(deps: AppDeps, shopId: string): Promise<PickupView[]> {
  const db = deps.prisma;
  const roundSelect = {
    select: {
      status: true,
      product: {
        select: {
          name: true,
          unitName: true,
          category: true,
          imageKey: true,
          imageAiGenerated: true,
        },
      },
    },
  } as const;
  const [pickups, kept, shop] = await Promise.all([
    db.pickup.findMany({ where: { shopId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    db.participation.findMany({
      where: { shopId, status: 'kept' },
      include: { round: roundSelect },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    }),
    db.shop.findUniqueOrThrow({ where: { id: shopId }, select: { address: true } }),
  ]);
  const allocations = await db.allocation.findMany({
    where: { pickupId: { in: pickups.map((p) => p.id) }, allocated: { gt: 0 } },
  });
  const claims = await db.claim.findMany({
    where: { deliveryCheck: { pickupId: { in: pickups.map((p) => p.id) } } },
    select: { id: true, deliveryCheck: { select: { pickupId: true } } },
  });
  const claimOf = new Map(claims.map((c) => [c.deliveryCheck.pickupId, c.id]));
  const pictureOf = (product: Part['round']['product']) => ({
    category: product.category,
    imageUrl: productImageUrl(deps, product),
    imageAiGenerated: product.imageAiGenerated,
  });
  const [allocated, consignments] = await Promise.all([
    db.participation.findMany({
      where: { id: { in: allocations.map((a) => a.participationId) } },
      include: { round: roundSelect },
    }),
    db.consignment.findMany({
      where: { id: { in: allocations.flatMap((a) => (a.consignmentId ? [a.consignmentId] : [])) } },
      select: { id: true, status: true },
    }),
  ]);
  const partOf = new Map(allocated.map((p) => [p.id, p]));
  const consignmentStatus = new Map(consignments.map((c) => [c.id, c.status]));

  // Kept lines (rounds not hub-checked yet) form their own group per place and date (Ruling C).
  const keyOf = (destinationKey: string, date: string) => `${destinationKey}|${date}`;
  const keptOf = new Map<string, Part[]>();
  for (const part of kept) {
    const key = keyOf(destinationKeyOf(part), part.deliveryDate);
    keptOf.set(key, [...(keptOf.get(key) ?? []), part]);
  }

  const pointIds = [
    ...pickups.flatMap((p) => (p.pickupPointId ? [p.pickupPointId] : [])),
    ...kept.flatMap((p) => (p.pickupPointId ? [p.pickupPointId] : [])),
  ];
  const points = await db.pickupPoint.findMany({ where: { id: { in: pointIds } } });
  const pointOf = new Map(points.map((p) => [p.id, p]));
  const place = (destinationType: 'pickup_point' | 'door', pickupPointId: string | null) => {
    if (destinationType === 'door') {
      return { placeName: null, address: shop.address, openingHours: null };
    }
    const point = pointOf.get(pickupPointId!)!;
    return { placeName: point.name, address: point.address, openingHours: point.openingHours };
  };
  const keptLine = (p: Part): PickupLineView => ({
    allocationId: null,
    productName: p.round.product.name,
    unitName: p.round.product.unitName,
    quantity: p.quantity,
    ...pictureOf(p.round.product),
  });
  const byName = (a: PickupLineView, b: PickupLineView) =>
    a.productName.localeCompare(b.productName);

  const views: PickupView[] = pickups.map((p) => {
    const own = allocations.filter((a) => a.pickupId === p.id);
    const lines: PickupLineView[] = own.map((a) => {
      const part = partOf.get(a.participationId)!;
      return {
        allocationId: a.id,
        productName: part.round.product.name,
        unitName: part.round.product.unitName,
        quantity: a.allocated,
        ...pictureOf(part.round.product),
      };
    });
    const leftHub = own.some((a) => {
      const status = a.consignmentId ? consignmentStatus.get(a.consignmentId) : undefined;
      return status !== undefined && LEFT_HUB.includes(status);
    });
    return {
      pickupId: p.id,
      destinationType: p.destinationType,
      ...place(p.destinationType, p.pickupPointId),
      deliveryDate: p.deliveryDate,
      status: p.status,
      statusLabel: labelOf(p, leftHub),
      code: p.code,
      claimId: claimOf.get(p.id) ?? null,
      lines: lines.sort(byName),
    };
  });

  for (const parts of keptOf.values()) {
    const first = parts[0]!;
    const allSent = parts.every((p) => LEFT_SUPPLIER.includes(p.round.status));
    views.push({
      pickupId: null,
      destinationType: first.destinationType,
      ...place(first.destinationType, first.pickupPointId),
      deliveryDate: first.deliveryDate,
      status: 'waiting',
      statusLabel: allSent ? 'On its way to the hub' : 'Waiting for supplier',
      code: null,
      claimId: null,
      lines: parts.map(keptLine).sort(byName),
    });
  }

  // Stable: pickups (by creation) before groups on the same date.
  return views.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
}

/** Story 71's label for a planned pickup (Ruling C). */
function labelOf(p: Pickup, leftHub: boolean): PickupStatusLabel {
  switch (p.status) {
    case 'waiting':
      return leftHub ? 'On the way' : 'At the hub';
    case 'ready':
      return 'Ready for pickup';
    case 'out_for_delivery':
      return 'Out for delivery';
    default:
      return p.destinationType === 'door' ? 'Delivered' : 'Collected';
  }
}
