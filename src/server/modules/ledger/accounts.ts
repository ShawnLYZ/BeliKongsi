import type { AccountKind, Prisma, PrismaClient } from '@/generated/prisma/client';

export type AccountRef =
  | { kind: 'shop_balance'; shopId: string }
  | { kind: 'round_hold'; roundId: string }
  | { kind: 'delivery_fee_hold'; shopId: string; deliveryDate: string }
  | { kind: 'supplier_payable'; supplierId: string }
  | { kind: 'fee_revenue' }
  | { kind: 'logistics_payable' }
  | { kind: 'claims_expense' }
  | { kind: 'partner_cash' };

export function accountKey(ref: AccountRef): string {
  switch (ref.kind) {
    case 'shop_balance':
      return `shop_balance:${ref.shopId}`;
    case 'round_hold':
      return `round_hold:${ref.roundId}`;
    case 'delivery_fee_hold':
      return `delivery_fee_hold:${ref.shopId}:${ref.deliveryDate}`;
    case 'supplier_payable':
      return `supplier_payable:${ref.supplierId}`;
    default:
      return ref.kind;
  }
}

/** The columns a lazily created account row carries. */
export function accountColumns(ref: AccountRef): {
  kind: AccountKind;
  shopId: string | null;
  roundId: string | null;
  supplierId: string | null;
  deliveryDate: string | null;
} {
  const cols = {
    kind: ref.kind as AccountKind,
    shopId: null as string | null,
    roundId: null as string | null,
    supplierId: null as string | null,
    deliveryDate: null as string | null,
  };
  if (ref.kind === 'shop_balance') cols.shopId = ref.shopId;
  if (ref.kind === 'round_hold') cols.roundId = ref.roundId;
  if (ref.kind === 'delivery_fee_hold') {
    cols.shopId = ref.shopId;
    cols.deliveryDate = ref.deliveryDate;
  }
  if (ref.kind === 'supplier_payable') cols.supplierId = ref.supplierId;
  return cols;
}

/** Cached balance in sen; an account never posted to reads as zero. */
export async function balanceOf(
  db: Prisma.TransactionClient | PrismaClient,
  ref: AccountRef,
): Promise<number> {
  const row = await db.ledgerAccount.findUnique({
    where: { key: accountKey(ref) },
    select: { balanceSen: true },
  });
  return row ? Number(row.balanceSen) : 0;
}
