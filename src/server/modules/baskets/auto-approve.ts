import { appendLog } from '@/server/modules/activity/log';
import { formatRM } from '@/lib/format';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import { AutoDebitDeclined, createPayment } from '@/server/modules/payments/create';
import { activeTotals, defaultDestination, priceForShop } from '@/server/modules/rounds/quote';
import type { DestinationInput } from '@/server/modules/rounds/quote';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { forbidden, notFound, unprocessable } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireShopAccess } from '@/server/platform/permissions';
import { withTransaction, type TxContext } from '@/server/platform/tx';
import { basketTotals } from './amounts';

export const DEFAULT_CAP_SEN = 50000;

export type AutoApproveRuleView = {
  enabled: boolean;
  capSen: number;
  requireBelowUsual: boolean;
  mandateReference: string | null;
  mandateAgreedAt: string | null;
};

export type AutoApproveInput = {
  enabled: boolean;
  capSen?: number;
  requireBelowUsual?: boolean;
  agreeToMandate?: boolean;
};

type RuleRow = {
  enabled: boolean;
  capSen: number;
  requireBelowUsual: boolean;
  mandateReference: string | null;
  mandateAgreedAt: Date | null;
};

const viewOf = (r: RuleRow | null): AutoApproveRuleView => ({
  enabled: r?.enabled ?? false,
  capSen: r?.capSen ?? DEFAULT_CAP_SEN,
  requireBelowUsual: r?.requireBelowUsual ?? true,
  mandateReference: r?.mandateReference ?? null,
  mandateAgreedAt: r?.mandateAgreedAt?.toISOString() ?? null,
});

/** The shop's auto-approve rule (owner only); off with the default cap until it is first set. */
export async function getAutoApproveRule(
  deps: AppDeps,
  caller: Caller,
  shopId: string,
): Promise<AutoApproveRuleView> {
  requireShopAccess(caller, shopId, ['owner']);
  if (!UUID.test(shopId)) throw notFound('Shop');
  return viewOf(await deps.prisma.autoApproveRule.findUnique({ where: { shopId } }));
}

/**
 * Owner only. Switching the rule on needs a mandate: the owner agrees once (`agreeToMandate`), the
 * partner sets it up, and only its reference is kept. Logged with before and after.
 */
export async function setAutoApproveRule(
  deps: AppDeps,
  caller: Caller,
  shopId: string,
  input: AutoApproveInput,
): Promise<AutoApproveRuleView> {
  requireShopAccess(caller, shopId, ['owner']);
  if (caller.kind !== 'person') throw forbidden();
  if (!UUID.test(shopId)) throw notFound('Shop');
  if (input.capSen !== undefined && (!Number.isInteger(input.capSen) || input.capSen <= 0)) {
    throw unprocessable('INVALID_CAP', 'The limit must be a positive amount.');
  }
  return withTransaction(deps, caller, async (ctx) => {
    const { tx, now } = ctx;
    if (!(await tx.shop.findUnique({ where: { id: shopId }, select: { id: true } }))) {
      throw notFound('Shop');
    }
    const before = await tx.autoApproveRule.findUnique({ where: { shopId } });
    let mandateReference = before?.mandateReference ?? null;
    let mandateAgreedAt = before?.mandateAgreedAt ?? null;
    if (input.enabled && !mandateReference) {
      if (input.agreeToMandate !== true) {
        throw unprocessable(
          'MANDATE_REQUIRED',
          'Agree to the DuitNow AutoDebit mandate to switch auto-approve on.',
        );
      }
      mandateReference = (await deps.payments.createMandate(shopId)).reference;
      mandateAgreedAt = now;
    }
    const data = {
      enabled: input.enabled,
      capSen: input.capSen ?? before?.capSen ?? DEFAULT_CAP_SEN,
      requireBelowUsual: input.requireBelowUsual ?? before?.requireBelowUsual ?? true,
      mandateReference,
      mandateAgreedAt,
      updatedAt: now,
    };
    const saved = await tx.autoApproveRule.upsert({
      where: { shopId },
      create: { shopId, ...data },
      update: data,
    });
    const snapshot = (r: RuleRow | null) => ({
      enabled: r?.enabled ?? false,
      capSen: r?.capSen ?? DEFAULT_CAP_SEN,
      requireBelowUsual: r?.requireBelowUsual ?? true,
    });
    await appendLog(ctx, {
      action: input.enabled ? 'auto_approve.enabled' : 'auto_approve.disabled',
      subjectType: 'shop',
      subjectId: shopId,
      scope: { shopId },
      before: snapshot(before),
      after: snapshot(saved),
    });
    return viewOf(saved);
  });
}

/**
 * Called inside the transaction that drafted `basketId`. When the shop's rule is on and the basket
 * is within the cap (and every line is below its usual price, if the rule asks), the basket is
 * approved and paid at once: balance first, the rest by the simulated AutoDebit. A declined debit
 * writes nothing (`createPayment` takes the debit before any payment state), so the basket stays
 * the draft it was, and the owner is told to pay by hand.
 */
export async function evaluateAutoApprove(
  ctx: TxContext,
  basketId: string,
): Promise<'approved' | 'not_eligible' | 'debit_failed'> {
  const { tx, now, deps } = ctx;
  const basket = await tx.weeklyBasket.findUniqueOrThrow({
    where: { id: basketId },
    include: { lines: { where: { removed: false, roundId: { not: null } } } },
  });
  if (basket.status !== 'draft' || basket.lines.length === 0) return 'not_eligible';
  const rule = await tx.autoApproveRule.findUnique({ where: { shopId: basket.shopId } });
  if (!rule?.enabled || !rule.mandateReference) return 'not_eligible';

  const totals = await basketTotals(tx, basketId, now, deps.logistics);
  if (totals.totalNowSen <= 0 || totals.totalNowSen > rule.capSen) return 'not_eligible';

  const shop = await tx.shop.findUniqueOrThrow({
    where: { id: basket.shopId },
    include: { defaultPickupPoint: true, usualList: { include: { items: true } } },
  });
  const points = await tx.pickupPoint.findMany({ where: { active: true }, orderBy: { id: 'asc' } });
  let destination: DestinationInput;
  if (basket.fulfilment === 'door') destination = { type: 'door' };
  else if (basket.pickupPointId) {
    destination = { type: 'pickup_point', pickupPointId: basket.pickupPointId };
  } else destination = defaultDestination({ ...shop, defaultFulfilment: 'pickup' }, points);

  if (rule.requireBelowUsual) {
    const usualPrice = new Map(
      (shop.usualList?.items ?? []).map((i) => [i.productId, i.usualPriceSen]),
    );
    for (const line of basket.lines) {
      const usual = usualPrice.get(line.productId) ?? null;
      if (usual === null) return 'not_eligible';
      const round = await tx.round.findUniqueOrThrow({
        where: { id: line.roundId! },
        include: { hub: true, product: true },
      });
      const { totalQuantity } = await activeTotals(tx, round.id);
      const q = await priceForShop(deps, round, shop, {
        destination,
        quantity: line.quantity,
        total: totalQuantity,
        priceLimitSen: line.priceLimitSen,
        unitName: round.product.unitName,
        points,
      });
      if (q.starting.allInSen >= usual) return 'not_eligible';
    }
  }

  const reason = `Auto-approve rule: total within ${formatRM(rule.capSen)}${rule.requireBelowUsual ? ' and every item below your usual price' : ''}`;
  try {
    const summary = await createPayment(ctx, {
      shopId: basket.shopId,
      purpose: 'basket',
      basketId,
      lines: basket.lines.map((l) => ({
        productId: l.productId,
        roundId: l.roundId!,
        basketLineId: l.id,
        quantity: l.quantity,
        priceLimitSen: l.priceLimitSen,
        destination,
      })),
      deadlineAt: basket.deadlineAt,
      source: 'weekly_basket',
      settleImmediatelyWith: 'auto_debit',
      mandateReference: rule.mandateReference,
      reason,
    });
    await notify(ctx, {
      type: 'basket.auto_approved',
      audience: { shopId: basket.shopId, roles: ['owner'] },
      link: '/owner/basket',
      message: TEMPLATES['basket.auto_approved']({
        itemCount: basket.lines.length,
        totalSen: summary.totalSen,
        balanceAppliedSen: summary.balanceAppliedSen,
        externalSen: summary.externalSen,
        deadline: basket.deadlineAt,
      }),
      dedupeKey: `basket.auto_approved:${basketId}`,
    });
    return 'approved';
  } catch (error) {
    if (!(error instanceof AutoDebitDeclined)) throw error;
    await notify(ctx, {
      type: 'basket.auto_approve_failed',
      audience: { shopId: basket.shopId, roles: ['owner'] },
      link: '/owner/basket',
      message: TEMPLATES['basket.auto_approve_failed']({ deadline: basket.deadlineAt }),
      dedupeKey: `basket.auto_approve_failed:${basketId}`,
    });
    return 'debit_failed';
  }
}
