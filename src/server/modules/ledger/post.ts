import type { PostingKind } from '@/generated/prisma/client';
import { unprocessable } from '@/server/platform/errors';
import type { TxContext } from '@/server/platform/tx';
import { accountColumns, accountKey, type AccountRef } from './accounts';

export type PostingRefs = {
  roundId?: string;
  participationId?: string;
  paymentId?: string;
  claimId?: string;
  supplierOrderId?: string;
  shopId?: string;
  supplierId?: string;
};

export type PostInput = {
  from: AccountRef;
  to: AccountRef;
  amountSen: number;
  kind: PostingKind;
  refs?: PostingRefs;
  memo?: string;
};

const NON_NEGATIVE = new Set(['shop_balance', 'round_hold', 'delivery_fee_hold']);

function isCheckViolation(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; e && typeof e === 'object' && depth < 5; depth++) {
    const { code, meta, cause } = e as {
      code?: unknown;
      meta?: { code?: unknown };
      cause?: unknown;
    };
    if (code === '23514' || meta?.code === '23514') return true;
    e = cause;
  }
  return false;
}

const tooLittle = (account: string) =>
  unprocessable('BALANCE_WOULD_GO_NEGATIVE', 'There is not enough money in that account.', {
    account,
  });

/**
 * Move `amountSen` from one account to another, inside the caller's transaction.
 * Accounts are created on first use, locked in key order, updated and logged as one posting.
 */
export async function post(ctx: TxContext, p: PostInput): Promise<void> {
  if (!Number.isInteger(p.amountSen) || p.amountSen <= 0) {
    throw new RangeError(`A posting needs a positive whole number of sen, got ${p.amountSen}.`);
  }
  const fromKey = accountKey(p.from);
  const toKey = accountKey(p.to);
  if (fromKey === toKey) throw new RangeError('A posting needs two different accounts.');
  const { tx } = ctx;

  // Create missing accounts, then lock both rows in key order so concurrent posts cannot deadlock.
  for (const ref of [p.from, p.to]) {
    const c = accountColumns(ref);
    await tx.$executeRaw`
      INSERT INTO ledger_accounts (id, key, kind, shop_id, round_id, supplier_id, delivery_date, balance_sen)
      VALUES (gen_random_uuid(), ${accountKey(ref)}, ${c.kind}::"AccountKind", ${c.shopId}::uuid,
              ${c.roundId}::uuid, ${c.supplierId}::uuid, ${c.deliveryDate}, 0)
      ON CONFLICT (key) DO NOTHING`;
  }
  const locked = await tx.$queryRaw<
    { id: string; key: string; kind: string; balance_sen: bigint }[]
  >`
    SELECT id, key, kind::text AS kind, balance_sen FROM ledger_accounts
    WHERE key IN (${fromKey}, ${toKey}) ORDER BY key FOR UPDATE`;
  const from = locked.find((r) => r.key === fromKey);
  const to = locked.find((r) => r.key === toKey);
  if (!from || !to) throw new Error('Ledger account missing after creation.');

  if (NON_NEGATIVE.has(from.kind) && from.balance_sen < BigInt(p.amountSen)) {
    throw tooLittle(fromKey);
  }

  try {
    await tx.$executeRaw`UPDATE ledger_accounts SET balance_sen = balance_sen - ${p.amountSen} WHERE id = ${from.id}::uuid`;
    await tx.$executeRaw`UPDATE ledger_accounts SET balance_sen = balance_sen + ${p.amountSen} WHERE id = ${to.id}::uuid`;
  } catch (error) {
    if (isCheckViolation(error)) throw tooLittle(fromKey);
    throw error;
  }
  const r = p.refs ?? {};
  await tx.ledgerPosting.create({
    data: {
      occurredAt: ctx.now,
      fromAccountId: from.id,
      toAccountId: to.id,
      amountSen: p.amountSen,
      kind: p.kind,
      roundId: r.roundId ?? null,
      participationId: r.participationId ?? null,
      paymentId: r.paymentId ?? null,
      claimId: r.claimId ?? null,
      supplierOrderId: r.supplierOrderId ?? null,
      shopId: r.shopId ?? null,
      supplierId: r.supplierId ?? null,
      memo: p.memo ?? null,
    },
  });
}
