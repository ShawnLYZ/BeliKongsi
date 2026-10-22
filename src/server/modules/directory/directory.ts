import type { PickupPoint, Shop } from '@/generated/prisma/client';
import type {
  PickupPointView,
  ShopSettingsView,
  StaffShopSettingsView,
} from '@/lib/views/directory';
import { distanceKm, type LatLng } from '@/server/adapters/logistics';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { badRequest, forbidden, notFound, unprocessable } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireShopAccess } from '@/server/platform/permissions';
import { withTransaction } from '@/server/platform/tx';
import { appendLog } from '../activity/log';
import { isStaff } from '../rounds/read';

export type SettingsInput =
  { defaultFulfilment: 'pickup'; pickupPointId: string } | { defaultFulfilment: 'door' };

const DOOR_TOO_FAR_MESSAGE =
  "Your shop is more than 20 km from the nearest pickup point, so door delivery isn't available. Choose a pickup point instead.";

/** The pickup point closest to a place; ties go to the lower id so the answer is stable. */
export function nearestPickupPoint<P extends LatLng & { id: string }>(
  points: readonly P[],
  at: LatLng,
): P | undefined {
  return [...points].sort(
    (a, b) => distanceKm(a, at) - distanceKm(b, at) || (a.id < b.id ? -1 : 1),
  )[0];
}

function pointView(p: PickupPoint, from: LatLng | null): PickupPointView {
  return {
    id: p.id,
    name: p.name,
    address: p.address,
    state: p.state,
    lat: p.lat,
    lng: p.lng,
    openingHours: p.openingHours,
    distanceKm: from ? distanceKm(p, from) : null,
  };
}

const activePoints = (db: Pick<AppDeps['prisma'], 'pickupPoint'>) =>
  db.pickupPoint.findMany({ where: { active: true }, orderBy: { id: 'asc' } });

/** Owners and staff see points nearest their shop first; everyone else sees them by name. */
export async function listPickupPointsForShop(
  deps: AppDeps,
  caller: Caller,
): Promise<PickupPointView[]> {
  const points = await activePoints(deps.prisma);
  const shopId = caller.kind === 'person' ? caller.session.membership.shopId : undefined;
  const shop = shopId ? await deps.prisma.shop.findUnique({ where: { id: shopId } }) : null;
  if (!shop) {
    return points.sort((a, b) => a.name.localeCompare(b.name)).map((p) => pointView(p, null));
  }
  return points
    .map((p) => pointView(p, shop))
    .sort((a, b) => a.distanceKm! - b.distanceKm! || (a.id < b.id ? -1 : 1));
}

function settingsView(
  deps: AppDeps,
  caller: Caller,
  shop: Shop,
  points: PickupPoint[],
): ShopSettingsView | StaffShopSettingsView {
  const nearest = nearestPickupPoint(points, shop);
  if (!nearest) throw unprocessable('NO_PICKUP_POINT', 'There is no pickup point to ship to.');
  const fee = deps.logistics.quoteDeliveryFee({ pickupPoint: nearest, shop });
  const chosen = shop.defaultPickupPointId
    ? points.find((p) => p.id === shop.defaultPickupPointId)
    : undefined;
  const view: ShopSettingsView = {
    defaultFulfilment: shop.defaultFulfilment,
    pickupPoint: chosen ? pointView(chosen, shop) : null,
    door: {
      nearestPickupPoint: pointView(nearest, shop),
      distanceKm: fee.distanceKm,
      feeSen: fee.feeSen,
      available: fee.feeSen !== null,
    },
    setupCompleted: shop.setupCompletedAt !== null,
  };
  if (!isStaff(caller)) return view;
  const { feeSen: _feeSen, ...door } = view.door;
  void _feeSen;
  return { ...view, door };
}

export async function getShopSettings(
  deps: AppDeps,
  caller: Caller,
  shopId: string,
): Promise<ShopSettingsView | StaffShopSettingsView> {
  requireShopAccess(caller, shopId);
  if (!UUID.test(shopId)) throw notFound('Shop');
  const shop = await deps.prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw notFound('Shop');
  return settingsView(deps, caller, shop, await activePoints(deps.prisma));
}

/** Owner only. Unknown or inactive pickup points are a 400 (bad input), not a 404. */
export async function updateShopSettings(
  deps: AppDeps,
  caller: Caller,
  shopId: string,
  input: SettingsInput,
): Promise<ShopSettingsView | StaffShopSettingsView> {
  requireShopAccess(caller, shopId, ['owner']);
  if (caller.kind !== 'person') throw forbidden();
  if (!UUID.test(shopId)) throw notFound('Shop');
  return withTransaction(deps, caller, async (ctx) => {
    const { tx } = ctx;
    const shop = await tx.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw notFound('Shop');
    const points = await activePoints(tx);

    let pickupPointId: string | null = null;
    if (input.defaultFulfilment === 'pickup') {
      if (!points.some((p) => p.id === input.pickupPointId)) {
        throw badRequest('That pickup point does not exist.', {
          fieldErrors: { pickupPointId: ['Choose one of the listed pickup points.'] },
        });
      }
      pickupPointId = input.pickupPointId;
    } else {
      const nearest = nearestPickupPoint(points, shop);
      const fee = nearest ? deps.logistics.quoteDeliveryFee({ pickupPoint: nearest, shop }) : null;
      if (!fee || fee.feeSen === null) {
        throw unprocessable(
          'DOOR_TOO_FAR',
          DOOR_TOO_FAR_MESSAGE,
          fee ? { distanceKm: fee.distanceKm } : undefined,
        );
      }
    }

    const hasUsualList = (await tx.usualList.count({ where: { shopId } })) > 0;
    const completing = hasUsualList && shop.setupCompletedAt === null;
    const updated = await tx.shop.update({
      where: { id: shopId },
      data: {
        defaultFulfilment: input.defaultFulfilment,
        defaultPickupPointId: pickupPointId,
        ...(completing ? { setupCompletedAt: ctx.now } : {}),
      },
    });
    await appendLog(ctx, {
      action: 'shop.settings_changed',
      subjectType: 'shop',
      subjectId: shopId,
      scope: { shopId },
      before: {
        defaultFulfilment: shop.defaultFulfilment,
        pickupPointId: shop.defaultPickupPointId,
      },
      after: { defaultFulfilment: input.defaultFulfilment, pickupPointId },
    });
    if (completing) {
      await appendLog(ctx, {
        action: 'shop.setup_completed',
        subjectType: 'shop',
        subjectId: shopId,
        scope: { shopId },
      });
    }
    return settingsView(deps, caller, updated, points);
  });
}
