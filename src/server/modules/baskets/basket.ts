import type { BasketLine, Role, WeeklyBasket } from '@/generated/prisma/client';
import type { OwnerBasketLine, OwnerBasketView, StaffBasketView } from '@/lib/views/baskets';
import { addIsoWeeks, isoWeekOf, isoWeekStart } from '@/lib/time';
import { participationSavings } from '@/server/engine';
import { appendLog } from '@/server/modules/activity/log';
import { nearestPickupPoint, pointView } from '@/server/modules/directory/directory';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import { productImageUrl } from '@/server/modules/rounds/read';
import { defaultDestination, activeTotals, priceForShop } from '@/server/modules/rounds/quote';
import { cutoffForWeek } from '@/server/modules/rounds/schedule';
import { explainQuote } from '@/server/engine';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { badRequest, forbidden, notFound, unprocessable } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireShopAccess } from '@/server/platform/permissions';
import { withTransaction, type TxContext } from '@/server/platform/tx';
import { basketTotals } from './amounts';

const DAY = 86_400_000;
const MIN_QUANTITY = 1;
const MAX_QUANTITY = 999;

export type FulfilmentInput =
  { fulfilment: 'pickup'; pickupPointId: string } | { fulfilment: 'door' };

const roleOf = (caller: Caller): Role =>
  caller.kind === 'person' ? caller.session.membership.role : 'owner';
const userIdOf = (caller: Caller): string | null =>
  caller.kind === 'person' ? caller.session.userId : null;

function checkQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < MIN_QUANTITY || quantity > MAX_QUANTITY) {
    throw badRequest(`Quantity must be a whole number from ${MIN_QUANTITY} to ${MAX_QUANTITY}.`);
  }
}

async function loadBasket(
  ctx: TxContext,
  basketId: string,
  roles: readonly Role[],
): Promise<WeeklyBasket> {
  if (!UUID.test(basketId)) throw notFound('Basket');
  const basket = await ctx.tx.weeklyBasket.findUnique({ where: { id: basketId } });
  if (!basket) throw notFound('Basket');
  requireShopAccess(ctx.caller, basket.shopId, roles);
  return basket;
}

const notEditable = () =>
  unprocessable('BASKET_NOT_EDITABLE', 'This basket can no longer be changed.');

/** A basket that is not a draft any more cannot be edited. */
function requireDraft(basket: WeeklyBasket): void {
  if (basket.status !== 'draft') throw notEditable();
}

// ---------------------------------------------------------------------------------------------
// Viewing

/**
 * This week's basket for the shop as the caller sees it: the owner gets prices and savings, staff
 * get quantities only (R6). `null` when the shop has no drafted basket this week. An owner's first
 * view stamps `firstOpenedAt` (C11).
 */
export async function getCurrentBasket(
  deps: AppDeps,
  caller: Caller,
  shopId: string,
): Promise<OwnerBasketView | StaffBasketView | null> {
  requireShopAccess(caller, shopId, ['owner', 'staff']);
  if (!UUID.test(shopId)) throw notFound('Shop');
  return withTransaction(deps, caller, async (ctx) => {
    const { tx, now } = ctx;
    let basket = await tx.weeklyBasket.findUnique({
      where: { shopId_basketWeek: { shopId, basketWeek: isoWeekOf(now) } },
    });
    if (!basket || (!basket.draftedAt && basket.status === 'draft')) return null;

    if (roleOf(caller) === 'staff') return staffView(ctx, basket);

    if (caller.kind === 'person' && basket.firstOpenedAt === null) {
      basket = await tx.weeklyBasket.update({
        where: { id: basket.id },
        data: { firstOpenedAt: now },
      });
    }
    return ownerView(ctx, basket);
  });
}

/** A basket's lines, each with its product (BasketLine has no relation to Product). */
async function linesWithProducts(
  ctx: TxContext,
  basketId: string,
  where: { removed?: boolean } = {},
) {
  const lines = await ctx.tx.basketLine.findMany({ where: { basketId, ...where } });
  const products = await ctx.tx.product.findMany({
    where: { id: { in: lines.map((l) => l.productId) } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  return lines.map((l) => ({ ...l, product: byId.get(l.productId)! }));
}

async function staffView(ctx: TxContext, basket: WeeklyBasket): Promise<StaffBasketView> {
  const lines = await linesWithProducts(ctx, basket.id, { removed: false });
  const me = userIdOf(ctx.caller);
  return {
    basketId: basket.id,
    week: basket.basketWeek,
    status: basket.status,
    lines: lines
      .sort((a, b) => a.product.name.localeCompare(b.product.name) || (a.id < b.id ? -1 : 1))
      .map((l) => ({
        lineId: l.id,
        productId: l.productId,
        name: l.product.name,
        packDescription: l.product.packDescription,
        unitName: l.product.unitName,
        imageUrl: productImageUrl(ctx.deps, l.product),
        quantity: l.quantity,
        waitingForOwner: basket.status === 'draft',
        addedByMe: me !== null && l.changedByUserId === me && l.staffAddedQuantity > 0,
      })),
  };
}

async function ownerView(ctx: TxContext, basket: WeeklyBasket): Promise<OwnerBasketView> {
  const { tx, deps, now } = ctx;
  const shop = await tx.shop.findUniqueOrThrow({
    where: { id: basket.shopId },
    include: { defaultPickupPoint: true, usualList: { include: { items: true } } },
  });
  const lines = await linesWithProducts(ctx, basket.id);
  const rounds = await tx.round.findMany({
    where: { id: { in: lines.flatMap((l) => (l.roundId ? [l.roundId] : [])) } },
    include: { hub: true },
  });
  const roundById = new Map(rounds.map((r) => [r.id, r]));
  const changers = await tx.user.findMany({
    where: { id: { in: lines.flatMap((l) => (l.changedByUserId ? [l.changedByUserId] : [])) } },
  });
  const nameOf = new Map(changers.map((u) => [u.id, u.displayName]));
  const usualOf = new Map((shop.usualList?.items ?? []).map((i) => [i.productId, i.usualPriceSen]));
  const destination =
    basket.fulfilment === 'door'
      ? ({ type: 'door' } as const)
      : basket.pickupPointId
        ? ({ type: 'pickup_point', pickupPointId: basket.pickupPointId } as const)
        : undefined;

  const views: OwnerBasketLine[] = [];
  for (const l of [...lines].sort(
    (a, b) => a.product.name.localeCompare(b.product.name) || (a.id < b.id ? -1 : 1),
  )) {
    const round = l.roundId ? roundById.get(l.roundId) : undefined;
    const usual = usualOf.get(l.productId) ?? null;
    const base = {
      lineId: l.id,
      productId: l.productId,
      name: l.product.name,
      shortName: l.product.shortName,
      packDescription: l.product.packDescription,
      unitName: l.product.unitName,
      imageUrl: productImageUrl(deps, l.product),
      quantity: l.quantity,
      priceLimitSen: l.priceLimitSen,
      usualPriceSen: usual,
      source: l.source,
      changedBy:
        l.changedByUserId && l.changedByRole
          ? { name: nameOf.get(l.changedByUserId) ?? '', role: l.changedByRole }
          : null,
      staffAddedQuantity: l.staffAddedQuantity,
      removed: l.removed,
      notice: l.notice,
      roundId: l.roundId,
      cutoffAt: round ? round.cutoffAt.toISOString() : null,
      savingsBasis: usual !== null ? ('usual_price' as const) : ('buy_alone' as const),
    };
    if (!round || l.removed) {
      views.push({
        ...base,
        startingAllInSen: null,
        startingLineSen: null,
        projectedAllInSen: null,
        estimatedSavingsSen: null,
        explanation: [],
      });
      continue;
    }
    const { totalQuantity } = await activeTotals(tx, round.id);
    const q = await priceForShop(deps, round, shop, {
      ...(destination ? { destination } : {}),
      quantity: l.quantity,
      total: totalQuantity,
      priceLimitSen: l.priceLimitSen,
      unitName: l.product.unitName,
    });
    const projectedAllInSen = q.withYou.amounts?.allInSen ?? null;
    const savings =
      projectedAllInSen === null
        ? null
        : participationSavings({
            baselineSen: usual ?? round.buyAlonePriceSen,
            baselineKind: usual !== null ? 'usual' : 'buy_alone',
            finalAllInSen: projectedAllInSen,
            allocated: l.quantity,
            missing: 0,
            damaged: 0,
            verified: false,
          });
    views.push({
      ...base,
      startingAllInSen: q.starting.allInSen,
      startingLineSen: q.startingLineSen,
      projectedAllInSen,
      estimatedSavingsSen: savings?.savingSen ?? null,
      explanation: explainQuote(q, l.quantity, l.product.unitName),
    });
  }

  const point =
    basket.fulfilment === 'pickup'
      ? await tx.pickupPoint.findUnique({
          where: { id: basket.pickupPointId ?? shop.defaultPickupPointId ?? '' },
        })
      : null;
  const payment = await tx.payment.findFirst({
    where: { basketId: basket.id, status: { in: ['pending', 'succeeded'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return {
    basketId: basket.id,
    week: basket.basketWeek,
    status: basket.status,
    deadlineAt: basket.deadlineAt.toISOString(),
    fulfilment: basket.fulfilment,
    pickupPoint: point ? pointView(point, shop) : null,
    lines: views,
    totals: await basketTotals(tx, basket.id, now, deps.logistics),
    approvalRequestId: basket.approvalRequestId,
    paymentId: payment?.id ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Adding

/**
 * Adds a product to the basket, or to the draft it belongs in. A draft takes a product whose open
 * round closes in its week. Anything else (a paid basket, or a fortnightly product whose round
 * closes later) goes to the draft for the week its round closes, else next week's, and waits there
 * with no round until drafting (story 98).
 */
export async function addBasketLine(
  deps: AppDeps,
  caller: Caller,
  basketId: string,
  input: { productId: string; quantity: number },
): Promise<{ basketId: string; week: string; routedToNextWeek: boolean }> {
  checkQuantity(input.quantity);
  if (!UUID.test(input.productId)) throw notFound('Product');
  return withTransaction(deps, caller, async (ctx) => {
    const { tx, now } = ctx;
    const basket = await loadBasket(ctx, basketId, ['owner', 'staff']);
    const product = await tx.product.findUnique({ where: { id: input.productId } });
    if (!product) throw notFound('Product');
    if (!product.active)
      throw unprocessable('PRODUCT_NOT_AVAILABLE', 'That product is not available.');

    const openRounds = await tx.round.findMany({
      where: { productId: product.id, status: 'open', cutoffAt: { gt: now } },
      orderBy: [{ cutoffAt: 'asc' }, { id: 'asc' }],
    });
    const roundIn = (week: string) => openRounds.find((r) => isoWeekOf(r.cutoffAt) === week);

    const fitsHere = basket.status === 'draft' && roundIn(basket.basketWeek) !== undefined;
    let targetWeek = basket.basketWeek;
    if (!fitsHere) {
      const first = openRounds[0];
      const firstWeek = first ? isoWeekOf(first.cutoffAt) : null;
      targetWeek =
        firstWeek && firstWeek > basket.basketWeek ? firstWeek : addIsoWeeks(basket.basketWeek, 1);
    }

    let target = basket;
    if (targetWeek !== basket.basketWeek) {
      const existing = await tx.weeklyBasket.findUnique({
        where: { shopId_basketWeek: { shopId: basket.shopId, basketWeek: targetWeek } },
      });
      if (existing) {
        target = existing;
      } else {
        const shop = await tx.shop.findUniqueOrThrow({
          where: { id: basket.shopId },
          include: { defaultPickupPoint: true },
        });
        const points = await tx.pickupPoint.findMany({
          where: { active: true },
          orderBy: { id: 'asc' },
        });
        const destination = defaultDestination(shop, points);
        target = await tx.weeklyBasket.create({
          data: {
            shopId: basket.shopId,
            basketWeek: targetWeek,
            status: 'draft',
            // Drafting replaces this with the earliest cut-off among the basket's rounds.
            deadlineAt:
              cutoffForWeek(product, targetWeek) ??
              new Date(isoWeekStart(targetWeek).getTime() + 4 * DAY),
            fulfilment: shop.defaultFulfilment,
            pickupPointId: destination.type === 'pickup_point' ? destination.pickupPointId : null,
          },
        });
      }
    }
    requireDraft(target);

    const roundId = target.draftedAt ? (roundIn(targetWeek)?.id ?? null) : null;
    const staff = roleOf(caller) === 'staff';
    const changer = {
      changedByUserId: userIdOf(caller),
      changedByRole: caller.kind === 'person' ? caller.session.membership.role : null,
    };
    const existingLine = await tx.basketLine.findUnique({
      where: { basketId_productId: { basketId: target.id, productId: product.id } },
    });
    let line: BasketLine;
    if (existingLine) {
      const fresh = existingLine.removed;
      line = await tx.basketLine.update({
        where: { id: existingLine.id },
        data: {
          quantity: (fresh ? 0 : existingLine.quantity) + input.quantity,
          staffAddedQuantity: staff
            ? (fresh ? 0 : existingLine.staffAddedQuantity) + input.quantity
            : existingLine.staffAddedQuantity,
          removed: false,
          roundId: existingLine.roundId ?? roundId,
          ...changer,
        },
      });
    } else {
      line = await tx.basketLine.create({
        data: {
          basketId: target.id,
          productId: product.id,
          roundId,
          quantity: input.quantity,
          source: staff ? 'staff' : 'owner',
          staffAddedQuantity: staff ? input.quantity : 0,
          removed: false,
          ...changer,
        },
      });
    }

    const routedToNextWeek = targetWeek !== basket.basketWeek;
    await appendLog(ctx, {
      action: staff ? 'basket.line_added_by_staff' : 'basket.line_changed',
      subjectType: 'weekly_basket',
      subjectId: target.id,
      scope: { shopId: basket.shopId },
      before: existingLine ? snapshot(existingLine) : {},
      after: { ...snapshot(line), addedQuantity: input.quantity, week: targetWeek },
    });
    if (staff) {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userIdOf(caller)! } });
      await notify(ctx, {
        type: 'basket.staff_added',
        audience: { shopId: basket.shopId, roles: ['owner'] },
        link: '/owner/basket',
        message: TEMPLATES['basket.staff_added']({
          staffName: user.displayName,
          quantity: input.quantity,
          unitName: product.unitName,
          shortName: product.shortName,
          when: routedToNextWeek ? 'next' : 'this',
        }),
      });
    }
    return { basketId: target.id, week: targetWeek, routedToNextWeek };
  });
}

const snapshot = (l: BasketLine) => ({
  productId: l.productId,
  quantity: l.quantity,
  priceLimitSen: l.priceLimitSen,
  removed: l.removed,
});

// ---------------------------------------------------------------------------------------------
// Changing

export type LineChange = { quantity?: number; priceLimitSen?: number | null; removed?: boolean };

/** Owner: quantity, limit, removal. Staff: quantity only; anything else is 403. */
export async function changeBasketLine(
  deps: AppDeps,
  caller: Caller,
  basketId: string,
  lineId: string,
  input: LineChange,
): Promise<{ lineId: string; quantity: number; priceLimitSen: number | null; removed: boolean }> {
  const staff = roleOf(caller) === 'staff';
  return withTransaction(deps, caller, async (ctx) => {
    const { tx } = ctx;
    const basket = await loadBasket(ctx, basketId, ['owner', 'staff']);
    if (staff && (input.priceLimitSen !== undefined || input.removed !== undefined)) {
      throw forbidden('Staff can only change quantities.');
    }
    if (
      input.quantity === undefined &&
      input.priceLimitSen === undefined &&
      input.removed === undefined
    ) {
      throw badRequest('Nothing to change.');
    }
    if (input.quantity !== undefined) checkQuantity(input.quantity);
    if (
      input.priceLimitSen != null &&
      (!Number.isInteger(input.priceLimitSen) || input.priceLimitSen <= 0)
    ) {
      throw badRequest('The price limit must be a positive amount, or empty.');
    }
    if (!UUID.test(lineId)) throw notFound('Line');
    const line = await tx.basketLine.findFirst({ where: { id: lineId, basketId: basket.id } });
    if (!line || (staff && line.removed)) throw notFound('Line');
    requireDraft(basket);

    const quantity = input.quantity ?? line.quantity;
    const updated = await tx.basketLine.update({
      where: { id: line.id },
      data: {
        quantity,
        ...(input.priceLimitSen !== undefined ? { priceLimitSen: input.priceLimitSen } : {}),
        ...(input.removed !== undefined ? { removed: input.removed } : {}),
        staffAddedQuantity: Math.min(line.staffAddedQuantity, quantity),
        changedByUserId: userIdOf(caller),
        changedByRole: caller.kind === 'person' ? caller.session.membership.role : null,
      },
    });
    await appendLog(ctx, {
      action: 'basket.line_changed',
      subjectType: 'basket_line',
      subjectId: line.id,
      scope: { shopId: basket.shopId },
      before: snapshot(line),
      after: snapshot(updated),
    });
    return {
      lineId: updated.id,
      quantity: updated.quantity,
      priceLimitSen: updated.priceLimitSen,
      removed: updated.removed,
    };
  });
}

/** Owner only. Door delivery is refused when the shop is too far from a pickup point. */
export async function setBasketFulfilment(
  deps: AppDeps,
  caller: Caller,
  basketId: string,
  input: FulfilmentInput,
): Promise<{ basketId: string; fulfilment: 'pickup' | 'door'; pickupPointId: string | null }> {
  return withTransaction(deps, caller, async (ctx) => {
    const { tx } = ctx;
    const basket = await loadBasket(ctx, basketId, ['owner']);
    requireDraft(basket);
    const points = await tx.pickupPoint.findMany({
      where: { active: true },
      orderBy: { id: 'asc' },
    });
    let pickupPointId: string | null = null;
    if (input.fulfilment === 'pickup') {
      if (!points.some((p) => p.id === input.pickupPointId)) {
        throw badRequest('That pickup point does not exist.', {
          fieldErrors: { pickupPointId: ['Choose one of the listed pickup points.'] },
        });
      }
      pickupPointId = input.pickupPointId;
    } else {
      const shop = await tx.shop.findUniqueOrThrow({ where: { id: basket.shopId } });
      const nearest = nearestPickupPoint(points, shop);
      const fee = nearest ? deps.logistics.quoteDeliveryFee({ pickupPoint: nearest, shop }) : null;
      if (!fee || fee.feeSen === null) {
        throw unprocessable(
          'DOOR_TOO_FAR',
          "Your shop is more than 20 km from the nearest pickup point, so door delivery isn't available. Choose a pickup point instead.",
          fee ? { distanceKm: fee.distanceKm } : undefined,
        );
      }
    }
    await tx.weeklyBasket.update({
      where: { id: basket.id },
      data: { fulfilment: input.fulfilment, pickupPointId },
    });
    await appendLog(ctx, {
      action: 'basket.fulfilment_changed',
      subjectType: 'weekly_basket',
      subjectId: basket.id,
      scope: { shopId: basket.shopId },
      before: { fulfilment: basket.fulfilment, pickupPointId: basket.pickupPointId },
      after: { fulfilment: input.fulfilment, pickupPointId },
    });
    return { basketId: basket.id, fulfilment: input.fulfilment, pickupPointId };
  });
}
