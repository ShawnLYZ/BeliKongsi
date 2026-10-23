import type { Round } from '@/generated/prisma/client';
import { isoWeekOf, isoWeekStart } from '@/lib/time';
import { appendLog } from '@/server/modules/activity/log';
import { createApproval } from '@/server/modules/approvals/approvals';
import { defaultDestination } from '@/server/modules/rounds/quote';
import { emitEvent } from '@/server/modules/integration/events';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import { systemCaller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { inTransaction, withTransaction, type TxContext } from '@/server/platform/tx';
import { basketTotals } from './amounts';
import { evaluateAutoApprove } from './auto-approve';

const HOUR = 3_600_000;
/** Baskets are drafted from Monday 06:00 Malaysia time. */
const DRAFT_AFTER_WEEK_START_MS = 6 * HOUR;

/**
 * Drafts the shop's basket for `basketWeek` from its usual list, merging into a draft that already
 * holds staff additions. Returns `basketId: null` when there is nothing to put in it; `created` is
 * true only when this call drafted the basket. A basket already drafted, paid, skipped or expired
 * is left alone. The owner's auto-approve rule is checked only when `autoApprove` is set, which
 * only the weekly job (`draftWeeklyBaskets`) does: a list saved mid-week leaves a plain draft.
 */
export async function draftBasketForShop(
  ctx: TxContext,
  shopId: string,
  basketWeek: string,
  opts: { autoApprove?: boolean } = {},
): Promise<{ basketId: string | null; created: boolean }> {
  const { tx, now } = ctx;
  const existing = await tx.weeklyBasket.findUnique({
    where: { shopId_basketWeek: { shopId, basketWeek } },
    include: { lines: true },
  });
  if (existing && (existing.draftedAt || existing.status !== 'draft')) {
    return { basketId: existing.id, created: false };
  }

  // The open round of each product that closes inside the basket week.
  const openRounds = await tx.round.findMany({
    where: { status: 'open' },
    orderBy: [{ cutoffAt: 'asc' }, { id: 'asc' }],
  });
  const roundOf = new Map<string, Round>();
  for (const r of openRounds) {
    if (isoWeekOf(r.cutoffAt) === basketWeek && !roundOf.has(r.productId)) {
      roundOf.set(r.productId, r);
    }
  }

  const list = await tx.usualList.findUnique({
    where: { shopId },
    include: { items: { orderBy: { id: 'asc' } } },
  });
  const usual = (list?.items ?? []).filter((i) => roundOf.has(i.productId));
  const staffLines = (existing?.lines ?? []).filter((l) => !l.removed);
  const staffResolvable = staffLines.filter((l) => l.roundId || roundOf.has(l.productId));
  if (usual.length === 0 && staffResolvable.length === 0) return { basketId: null, created: false };

  const shop = await tx.shop.findUniqueOrThrow({
    where: { id: shopId },
    include: { defaultPickupPoint: true },
  });
  const points = await tx.pickupPoint.findMany({ where: { active: true }, orderBy: { id: 'asc' } });
  const destination = defaultDestination(shop, points);

  let basket = existing;
  if (!basket) {
    basket = {
      ...(await tx.weeklyBasket.create({
        data: {
          shopId,
          basketWeek,
          status: 'draft',
          deadlineAt: now,
          fulfilment: shop.defaultFulfilment,
          pickupPointId: destination.type === 'pickup_point' ? destination.pickupPointId : null,
        },
      })),
      lines: [],
    };
  }
  const basketId = basket.id;

  const byProduct = new Map(basket.lines.map((l) => [l.productId, l]));
  for (const item of usual) {
    const round = roundOf.get(item.productId)!;
    const line = byProduct.get(item.productId);
    if (!line) {
      await tx.basketLine.create({
        data: {
          basketId,
          productId: item.productId,
          roundId: round.id,
          quantity: item.quantity,
          priceLimitSen: item.priceLimitSen,
          source: 'usual_list',
          removed: false,
        },
      });
      continue;
    }
    // A line staff added first keeps its highlight: the usual quantity plus what staff added.
    await tx.basketLine.update({
      where: { id: line.id },
      data: {
        roundId: round.id,
        quantity: item.quantity + line.staffAddedQuantity,
        priceLimitSen: item.priceLimitSen,
        removed: false,
      },
    });
  }
  // Staff-added lines that no usual-list item covers take this week's round when there is one.
  const covered = new Set(usual.map((i) => i.productId));
  for (const line of staffLines) {
    const round = roundOf.get(line.productId);
    if (!line.roundId && round && !covered.has(line.productId)) {
      await tx.basketLine.update({ where: { id: line.id }, data: { roundId: round.id } });
    }
  }

  const lines = await tx.basketLine.findMany({
    where: { basketId, removed: false, roundId: { not: null } },
  });
  const roundById = new Map(openRounds.map((r) => [r.id, r]));
  const cutoffs = lines.flatMap((l) => {
    const r = roundById.get(l.roundId!);
    return r ? [r.cutoffAt.getTime()] : [];
  });
  const deadlineAt = cutoffs.length ? new Date(Math.min(...cutoffs)) : basket.deadlineAt;

  const totals = await basketTotals(tx, basketId, now, ctx.deps.logistics);
  const approval = await createApproval(ctx, {
    type: 'weekly_basket',
    subjectType: 'weekly_basket',
    subjectId: basketId,
    shopId,
    assigneeRole: 'owner',
    amountSen: totals.totalNowSen,
    summary: `Weekly basket for ${basketWeek}: ${lines.length} items`,
    whyNeeded:
      'Your usual list is ready as this week’s basket. Approve and pay to join the rounds.',
    evidence: { basketWeek, lineCount: lines.length, totalNowSen: totals.totalNowSen },
  });
  await tx.weeklyBasket.update({
    where: { id: basketId },
    data: { deadlineAt, draftedAt: now, approvalRequestId: approval.id },
  });

  await appendLog(ctx, {
    action: 'basket.drafted',
    subjectType: 'weekly_basket',
    subjectId: basketId,
    scope: { shopId },
    after: { basketWeek, lineCount: lines.length, totalNowSen: totals.totalNowSen },
  });
  await emitEvent(ctx, 'basket.drafted', {
    basketId,
    shopId,
    week: basketWeek,
    lineCount: lines.length,
  });
  await notify(ctx, {
    type: 'basket.ready',
    audience: { shopId, roles: ['owner'] },
    link: '/owner/basket',
    message: TEMPLATES['basket.ready']({
      itemCount: lines.length,
      nowSen: totals.totalNowSen,
      afterCutoffSen: totals.estimatedAfterCutoffSen,
      deadline: deadlineAt,
    }),
    dedupeKey: `basket.ready:${basketId}`,
  });
  // On the weekly job, the owner's auto-approve rule may approve and pay this basket now.
  if (opts.autoApprove) await evaluateAutoApprove(ctx, basketId);
  return { basketId, created: true };
}

/**
 * Drafts this week's basket for every shop with a usual list. From Monday 06:00 Malaysia time, or
 * at any time for the named shops (the setup trigger). Background shops are left out. Each shop has
 * its own transaction; one that fails (say its door is too far from every pickup point) is logged
 * and counted in `failed`, and the rest are still drafted. Inside a caller's transaction (the
 * seed) a shop's failure is not isolated: it is thrown, so the caller's transaction rolls back.
 */
export async function draftWeeklyBaskets(
  deps: AppDeps,
  opts: { shopIds?: string[] } = {},
): Promise<{ drafted: number; failed: number }> {
  const caller = systemCaller('draft weekly baskets');
  const due = await withTransaction(deps, caller, async (ctx) => {
    const week = isoWeekOf(ctx.now);
    if (
      !opts.shopIds &&
      ctx.now.getTime() < isoWeekStart(week).getTime() + DRAFT_AFTER_WEEK_START_MS
    ) {
      return null;
    }
    const shops = await ctx.tx.shop.findMany({
      where: {
        isBackground: false,
        usualList: { isNot: null },
        ...(opts.shopIds ? { id: { in: opts.shopIds } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return { week, shopIds: shops.map((s) => s.id) };
  });
  if (!due) return { drafted: 0, failed: 0 };

  const isolated = !inTransaction();
  let drafted = 0;
  let failed = 0;
  for (const id of due.shopIds) {
    try {
      const res = await withTransaction(deps, caller, (ctx) =>
        draftBasketForShop(ctx, id, due.week, { autoApprove: true }),
      );
      if (res.created) drafted += 1;
    } catch (error) {
      if (!isolated) throw error;
      failed += 1;
      console.error(
        `Drafting the basket for shop ${id} failed:`,
        error instanceof Error ? error.message : 'unknown error',
      );
    }
  }
  return { drafted, failed };
}
