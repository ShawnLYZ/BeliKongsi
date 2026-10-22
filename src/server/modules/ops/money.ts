import type { MoneyOverview } from '@/lib/views/ops';
import { runMoneyChecks } from '@/server/modules/ledger/checks';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { requireOps } from '@/server/platform/permissions';

export async function moneyOverview(deps: AppDeps, caller: Caller): Promise<MoneyOverview> {
  requireOps(caller);
  const db = deps.prisma;

  const holds = await db.$queryRaw<{ round_id: string; product_name: string; held: bigint }[]>`
    SELECT a.round_id, p.name AS product_name, a.balance_sen AS held
    FROM ledger_accounts a
    JOIN rounds r ON r.id = a.round_id
    JOIN products p ON p.id = r.product_id
    WHERE a.kind = 'round_hold' AND a.balance_sen <> 0
    ORDER BY p.name, a.round_id`;

  const kinds = await db.$queryRaw<{ kind: string; total: bigint }[]>`
    SELECT kind::text AS kind, SUM(amount_sen)::bigint AS total FROM ledger_postings
    WHERE kind::text LIKE 'refund%' OR kind::text = 'supplier_payout'
    GROUP BY kind ORDER BY kind`;
  const refundsByKind: Record<string, number> = {};
  let supplierPayoutsSen = 0;
  for (const k of kinds) {
    if (k.kind === 'supplier_payout') supplierPayoutsSen = Number(k.total);
    else refundsByKind[k.kind] = Number(k.total);
  }

  const balances = await db.$queryRaw<{ kind: string; total: bigint }[]>`
    SELECT kind::text AS kind, COALESCE(SUM(balance_sen), 0)::bigint AS total
    FROM ledger_accounts
    WHERE kind::text IN ('fee_revenue', 'logistics_payable', 'delivery_fee_hold', 'claims_expense', 'partner_cash')
    GROUP BY kind`;
  const bal = (kind: string) => Number(balances.find((b) => b.kind === kind)?.total ?? 0);

  const report = await runMoneyChecks(db);
  return {
    heldPerOpenRound: holds.map((h) => ({
      roundId: h.round_id,
      productName: h.product_name,
      heldSen: Number(h.held),
    })),
    refundsByKind,
    supplierPayoutsSen,
    feeRevenueSen: bal('fee_revenue'),
    logisticsPayableSen: bal('logistics_payable'),
    deliveryFeesHeldSen: bal('delivery_fee_hold'),
    claimsExpenseSen: bal('claims_expense'),
    partnerCashSen: bal('partner_cash'),
    checks: report.checks.map((c) => ({
      ...c,
      failures: c.failures.map((f) => ({
        ...f,
        ...(f.roundId ? { link: `/ops/rounds/${f.roundId}` } : {}),
      })),
    })),
  };
}
