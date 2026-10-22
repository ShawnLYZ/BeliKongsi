import type { BalanceView, MoneyHistoryItem, PaymentView, ReceiptView } from '@/lib/views/payments';
import { balanceOf } from '@/server/modules/ledger/accounts';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { conflict, notFound } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { toPage } from '@/server/platform/pagination';
import { requireShopAccess } from '@/server/platform/permissions';
import { paymentView } from './simulate';

const METHOD_LABEL = { duitnow_qr: 'DuitNow QR', fpx: 'FPX online banking' } as const;

async function findPayment(deps: AppDeps, caller: Caller, paymentId: string) {
  if (!UUID.test(paymentId)) throw notFound('Payment');
  const p = await deps.prisma.payment.findUnique({ where: { id: paymentId } });
  if (!p) throw notFound('Payment');
  // Another shop's people get 404; this shop's staff, and Ops, get 403.
  requireShopAccess(caller, p.shopId, ['owner']);
  return p;
}

/** A payment as the owner of its shop sees it. */
export async function getPaymentForCaller(
  deps: AppDeps,
  caller: Caller,
  paymentId: string,
): Promise<PaymentView> {
  return paymentView(await findPayment(deps, caller, paymentId));
}

/** The receipt of a succeeded payment, from the unit amounts stored on its lines. */
export async function getReceipt(
  deps: AppDeps,
  caller: Caller,
  paymentId: string,
): Promise<ReceiptView> {
  const found = await findPayment(deps, caller, paymentId);
  if (found.status !== 'succeeded' || !found.method || !found.completedAt) {
    throw conflict('PAYMENT_NOT_PAID', 'There is no receipt until the payment has succeeded.');
  }
  const [shop, lines] = await Promise.all([
    deps.prisma.shop.findUniqueOrThrow({ where: { id: found.shopId }, select: { name: true } }),
    deps.prisma.paymentLine.findMany({
      where: { paymentId: found.id },
      orderBy: [{ roundId: 'asc' }, { id: 'asc' }],
    }),
  ]);
  const products = await deps.prisma.product.findMany({
    where: { id: { in: lines.map((l) => l.productId) } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(products.map((p) => [p.id, p.name]));
  return {
    paymentId: found.id,
    issuedAt: found.completedAt.toISOString(),
    shopName: shop.name,
    lines: lines.map((l) => ({
      productName: nameOf.get(l.productId) ?? 'Product',
      quantity: l.quantity,
      unitAllInSen: l.unitAllInSen,
      unitGoodsSen: l.unitGoodsSen,
      unitFeeSen: l.unitFeeSen,
      unitShippingSen: l.unitShippingSen,
      lineSen: l.lineSen,
    })),
    deliveryFeeSen: found.deliveryFeeSen,
    balanceAppliedSen: found.balanceAppliedSen,
    paidSen: found.externalSen,
    totalSen: found.totalSen,
    method: found.method,
    partnerReference: found.partnerReference,
    notice: 'Issued by BeliKongsi (simulated). Not a tax invoice.',
  };
}

type Entry = {
  id: string;
  seq: bigint;
  item: Omit<MoneyHistoryItem, 'runningBalanceSen'>;
};

const REFUND_LABEL: Record<string, (name: string) => string> = {
  refund_cancelled: (n) => `Refund: you cancelled ${n}`,
  refund_difference: (n) => `Refund: ${n} closed at a lower price`,
  refund_dropped: (n) => `Refund: ${n} was dropped because the price went above your limit`,
  refund_failed: (n) => `Refund: the ${n} Kongsi didn't reach its minimum order`,
  refund_round_cancelled: (n) => `Refund: the ${n} round was cancelled`,
  refund_shortfall: (n) => `Refund: some ${n} units didn't arrive at the hub`,
};

/**
 * The shop's balance and its money history, newest first: payments (the amount paid outside the
 * balance), balance used, refunds and claim refunds, each with the shop balance after it. Owner
 * of the shop and Ops; another shop gets 404, staff 403.
 */
export async function getBalanceView(
  deps: AppDeps,
  caller: Caller,
  shopId: string,
  page: { cursor: string | null; limit: number },
): Promise<BalanceView> {
  if (!UUID.test(shopId)) throw notFound('Shop');
  requireShopAccess(caller, shopId, ['owner', 'ops']);
  const db = deps.prisma;
  if (!(await db.shop.findUnique({ where: { id: shopId }, select: { id: true } }))) {
    throw notFound('Shop');
  }
  const key = `shop_balance:${shopId}`;
  const [balanceSen, postings, payments] = await Promise.all([
    balanceOf(db, { kind: 'shop_balance', shopId }),
    db.ledgerPosting.findMany({
      where: { OR: [{ fromAccount: { key } }, { toAccount: { key } }] },
      include: { fromAccount: { select: { key: true } } },
      orderBy: { seq: 'asc' },
    }),
    db.payment.findMany({
      where: { shopId, status: 'succeeded' },
      include: { lines: { select: { productId: true } } },
    }),
  ]);
  const paymentById = new Map(payments.map((p) => [p.id, p]));
  const products = await db.product.findMany({
    where: { id: { in: payments.flatMap((p) => p.lines.map((l) => l.productId)) } },
    select: { id: true, shortName: true },
  });
  const shortNameOf = new Map(products.map((p) => [p.id, p.shortName]));
  const parts = await db.participation.findMany({
    where: { id: { in: postings.flatMap((x) => (x.participationId ? [x.participationId] : [])) } },
    select: {
      id: true,
      outcomeReason: true,
      round: { select: { product: { select: { shortName: true } } } },
    },
  });
  const partById = new Map(parts.map((x) => [x.id, x]));

  const entries: Entry[] = [];
  const usedByPayment = new Map<string, Entry>();
  for (const x of postings) {
    const at = x.occurredAt.toISOString();
    if (x.fromAccount.key === key) {
      // Balance used: one item per payment, however many lines it was spread over.
      const groupId = x.paymentId ?? x.id;
      const prior = usedByPayment.get(groupId);
      if (prior) {
        prior.item.amountSen += x.amountSen;
        prior.item.balanceChangeSen -= x.amountSen;
        if (x.seq > prior.seq) prior.seq = x.seq;
        continue;
      }
      const lines = x.paymentId ? (paymentById.get(x.paymentId)?.lines ?? []) : [];
      const names = [...new Set(lines.map((l) => shortNameOf.get(l.productId) ?? 'an item'))];
      const what =
        names.length === 1 ? names[0] : names.length > 1 ? `${names.length} items` : 'a payment';
      const entry: Entry = {
        id: `b:${groupId}`,
        seq: x.seq,
        item: {
          at,
          kind: 'balance_used',
          label: `Balance used for ${what}`,
          amountSen: x.amountSen,
          balanceChangeSen: -x.amountSen,
          reason: null,
        },
      };
      usedByPayment.set(groupId, entry);
      entries.push(entry);
      continue;
    }
    const part = x.participationId ? partById.get(x.participationId) : undefined;
    const name = part?.round.product.shortName ?? 'your order';
    const isClaim = x.kind === 'refund_claim';
    const label = isClaim
      ? `Claim refund: ${name}`
      : x.kind === 'refund_delivery_fee'
        ? 'Refund: delivery fee no longer needed'
        : (REFUND_LABEL[x.kind]?.(name) ?? `Refund: ${name}`);
    entries.push({
      id: `r:${x.id}`,
      seq: x.seq,
      item: {
        at,
        kind: isClaim ? 'claim_refund' : 'refund',
        label,
        amountSen: x.amountSen,
        balanceChangeSen: x.amountSen,
        reason: x.memo ?? part?.outcomeReason ?? null,
      },
    });
  }

  // A payment row: what was paid outside the balance, placed at its last money-in posting.
  const paidOutside = payments.filter((p) => p.externalSen > 0 && p.completedAt);
  const moneyIn = await db.ledgerPosting.findMany({
    where: {
      paymentId: { in: paidOutside.map((p) => p.id) },
      kind: { in: ['payment_in', 'delivery_fee_in'] },
    },
    select: { paymentId: true, seq: true },
  });
  const lastIn = new Map<string, bigint>();
  for (const x of moneyIn) {
    const seen = lastIn.get(x.paymentId!);
    if (seen === undefined || x.seq > seen) lastIn.set(x.paymentId!, x.seq);
  }
  for (const p of paidOutside) {
    if (!p.method || p.method === 'balance_only') continue;
    entries.push({
      id: `p:${p.id}`,
      seq: lastIn.get(p.id) ?? BigInt(0),
      item: {
        at: p.completedAt!.toISOString(),
        kind: 'payment',
        label: `Payment (simulated) — ${METHOD_LABEL[p.method]}`,
        amountSen: p.externalSen,
        balanceChangeSen: 0,
        reason: null,
      },
    });
  }

  entries.sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : a.id < b.id ? -1 : 1));
  let running = 0;
  const newestFirst = entries
    .map((e) => {
      running += e.item.balanceChangeSen;
      return { id: e.id, item: { ...e.item, runningBalanceSen: running } };
    })
    .reverse();

  let start = 0;
  if (page.cursor !== null) {
    const at = newestFirst.findIndex((e) => e.id === page.cursor);
    // Like the activity log, a cursor that is not ours gives an empty page.
    if (at < 0) return { balanceSen, history: { items: [], nextCursor: null } };
    start = at + 1;
  }
  const p = toPage(newestFirst.slice(start, start + page.limit + 1), page.limit, (e) => e.id);
  return { balanceSen, history: { items: p.items.map((e) => e.item), nextCursor: p.nextCursor } };
}
