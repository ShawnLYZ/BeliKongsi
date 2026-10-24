import type { Prisma, PrismaClient } from '@/generated/prisma/client';

export type MoneyCheckId =
  | 'balances_sum_to_zero'
  | 'no_negative_balances'
  | 'cached_balances_match_postings'
  | 'round_holds_match_participations'
  | 'participation_paid_equals_refunds_plus_allocated'
  | 'kept_within_limits'
  | 'final_not_above_starting'
  | 'delivery_fee_holds_match_charges';

type Failure = { roundId?: string; participationId?: string; detail: string };
export type MoneyCheck = { id: MoneyCheckId; label: string; passed: boolean; failures: Failure[] };
export type MoneyReport = { allPassed: boolean; checks: MoneyCheck[] };
type Db = Prisma.TransactionClient | PrismaClient;

const sen = (n: bigint | number) => `${n} sen`;

async function sumToZero(db: Db): Promise<Failure[]> {
  const [row] = await db.$queryRaw<{ total: bigint }[]>`
    SELECT COALESCE(SUM(balance_sen), 0)::bigint AS total FROM ledger_accounts`;
  return row && row.total !== 0n
    ? [{ detail: `All account balances add up to ${sen(row.total)}, not zero.` }]
    : [];
}

async function noNegative(db: Db): Promise<Failure[]> {
  const rows = await db.$queryRaw<
    { key: string; kind: string; balance_sen: bigint; round_id: string | null }[]
  >`
    SELECT key, kind::text AS kind, balance_sen, round_id FROM ledger_accounts
    WHERE kind IN ('shop_balance', 'round_hold', 'delivery_fee_hold') AND balance_sen < 0
    ORDER BY key`;
  return rows.map((r) => ({
    ...(r.round_id ? { roundId: r.round_id } : {}),
    detail: `${r.kind} account ${r.key} is negative: ${sen(r.balance_sen)}.`,
  }));
}

async function cachedMatchesPostings(db: Db): Promise<Failure[]> {
  const rows = await db.$queryRaw<
    { key: string; round_id: string | null; cached: bigint; computed: bigint }[]
  >`
    SELECT a.key, a.round_id, a.balance_sen AS cached,
           (COALESCE(i.total, 0) - COALESCE(o.total, 0))::bigint AS computed
    FROM ledger_accounts a
    LEFT JOIN (SELECT to_account_id AS id, SUM(amount_sen) AS total FROM ledger_postings GROUP BY 1) i ON i.id = a.id
    LEFT JOIN (SELECT from_account_id AS id, SUM(amount_sen) AS total FROM ledger_postings GROUP BY 1) o ON o.id = a.id
    WHERE a.balance_sen <> COALESCE(i.total, 0) - COALESCE(o.total, 0)
    ORDER BY a.key`;
  return rows.map((r) => ({
    ...(r.round_id ? { roundId: r.round_id } : {}),
    detail: `Account ${r.key} says ${sen(r.cached)} but its postings add up to ${sen(r.computed)}.`,
  }));
}

/**
 * Expected hold per round status (PRD 6.11): open = paid by active participations;
 * formed..dispatched = kept final lines (final all-in x quantity of kept participations);
 * every other status = 0. A hold whose round no longer exists is expected to be 0.
 */
async function holdsMatch(db: Db): Promise<Failure[]> {
  const rows = await db.$queryRaw<
    { round_id: string; status: string | null; held: bigint; expected: bigint }[]
  >`
    WITH ids AS (
      SELECT id AS round_id FROM rounds
      UNION SELECT round_id FROM ledger_accounts WHERE kind = 'round_hold' AND round_id IS NOT NULL
    ),
    r AS (
      SELECT ids.round_id, rd.status::text AS status,
        COALESCE((SELECT balance_sen FROM ledger_accounts a WHERE a.key = 'round_hold:' || ids.round_id::text), 0)::bigint AS held
      FROM ids LEFT JOIN rounds rd ON rd.id = ids.round_id
    ),
    e AS (
      SELECT r.round_id, r.status, r.held,
        (CASE
          WHEN r.status = 'open' THEN COALESCE((SELECT SUM(p.paid_sen) FROM participations p
            WHERE p.round_id = r.round_id AND p.status = 'active'), 0)
          WHEN r.status IN ('formed', 'ordered', 'confirmed', 'dispatched')
            THEN COALESCE((SELECT SUM(p.final_all_in_sen::bigint * p.quantity)
              FROM participations p WHERE p.round_id = r.round_id AND p.status = 'kept'), 0)
          ELSE 0
        END)::bigint AS expected
      FROM r
    )
    SELECT round_id, status, held, expected FROM e WHERE held <> expected ORDER BY round_id`;
  return rows.map((r) => ({
    roundId: r.round_id,
    detail: `Round (${r.status ?? 'missing'}) holds ${sen(r.held)} but should hold ${sen(r.expected)}.`,
  }));
}

/**
 * paid = refunds paid out of the round hold + what the participation still has in the round:
 * active = its payment; kept = its final line; allocated/received/closed = allocated units x final
 * all-in; cancelled, dropped, refunded and shorted = nothing.
 */
async function paidEqualsRefundsPlusAllocated(db: Db): Promise<Failure[]> {
  const rows = await db.$queryRaw<
    {
      id: string;
      round_id: string;
      status: string;
      paid: number;
      refunds: bigint;
      retained: bigint;
    }[]
  >`
    SELECT id, round_id, status, paid, refunds, retained FROM (
      SELECT p.id, p.round_id, p.status::text AS status, p.paid_sen AS paid,
        COALESCE((SELECT SUM(lp.amount_sen) FROM ledger_postings lp
          JOIN ledger_accounts h ON h.id = lp.from_account_id
          WHERE lp.participation_id = p.id AND h.key = 'round_hold:' || p.round_id::text
            AND lp.kind::text LIKE 'refund\_%'), 0)::bigint
          -- A late cancellation after the hub check is paid from claims expense, like a claim.
          + COALESCE((SELECT SUM(lp.amount_sen) FROM ledger_postings lp
          JOIN ledger_accounts c ON c.id = lp.from_account_id
          WHERE lp.participation_id = p.id AND c.key = 'claims_expense'
            AND lp.kind::text = 'refund_late'), 0)::bigint AS refunds,
        (CASE
          WHEN p.status = 'active' THEN p.paid_sen::bigint
          WHEN p.status = 'kept' THEN COALESCE(p.final_all_in_sen, 0)::bigint * p.quantity
          WHEN p.status IN ('allocated', 'received', 'closed')
            THEN COALESCE(p.final_all_in_sen, 0)::bigint * COALESCE(al.allocated, 0)
          ELSE 0
        END)::bigint AS retained
      FROM participations p LEFT JOIN allocations al ON al.participation_id = p.id
    ) x
    WHERE paid <> refunds + retained
    ORDER BY id`;
  return rows.map((r) => ({
    roundId: r.round_id,
    participationId: r.id,
    detail: `Participation (${r.status}) paid ${sen(r.paid)}, but refunds ${sen(r.refunds)} plus kept ${sen(r.retained)} do not add up to it.`,
  }));
}

async function keptWithinLimits(db: Db): Promise<Failure[]> {
  const rows = await db.$queryRaw<{ id: string; round_id: string; final: number; lim: number }[]>`
    SELECT id, round_id, final_all_in_sen AS final, price_limit_sen AS lim FROM participations
    WHERE status IN ('kept', 'allocated', 'shorted', 'received', 'closed', 'cancelled_late')
      AND price_limit_sen IS NOT NULL AND final_all_in_sen > price_limit_sen
    ORDER BY id`;
  return rows.map((r) => ({
    roundId: r.round_id,
    participationId: r.id,
    detail: `Kept at ${sen(r.final)} per unit, above the price limit of ${sen(r.lim)}.`,
  }));
}

async function finalNotAboveStarting(db: Db): Promise<Failure[]> {
  const rows = await db.$queryRaw<{ id: string; round_id: string; final: number; start: number }[]>`
    SELECT id, round_id, final_all_in_sen AS final, starting_all_in_sen AS start FROM participations
    WHERE final_all_in_sen IS NOT NULL AND final_all_in_sen > starting_all_in_sen
    ORDER BY id`;
  return rows.map((r) => ({
    roundId: r.round_id,
    participationId: r.id,
    detail: `Final price ${sen(r.final)} per unit is above the starting price ${sen(r.start)}.`,
  }));
}

/**
 * Each delivery fee hold (one shop, one door delivery date) holds exactly its `held` charge, and
 * nothing when the charge is missing, refunded or passed to the partner (PRD 6.9).
 */
async function feeHoldsMatchCharges(db: Db): Promise<Failure[]> {
  const rows = await db.$queryRaw<
    { shop_id: string; delivery_date: string; held: bigint; expected: bigint }[]
  >`
    WITH ids AS (
      SELECT shop_id, delivery_date FROM ledger_accounts
      WHERE kind = 'delivery_fee_hold' AND shop_id IS NOT NULL AND delivery_date IS NOT NULL
      UNION SELECT shop_id, delivery_date FROM delivery_fee_charges
    )
    SELECT ids.shop_id, ids.delivery_date,
      COALESCE((SELECT a.balance_sen FROM ledger_accounts a WHERE a.kind = 'delivery_fee_hold'
        AND a.shop_id = ids.shop_id AND a.delivery_date = ids.delivery_date), 0)::bigint AS held,
      COALESCE((SELECT c.amount_sen FROM delivery_fee_charges c WHERE c.shop_id = ids.shop_id
        AND c.delivery_date = ids.delivery_date AND c.status = 'held'), 0)::bigint AS expected
    FROM ids
    ORDER BY ids.shop_id, ids.delivery_date`;
  return rows
    .filter((r) => r.held !== r.expected)
    .map((r) => ({
      detail: `The delivery fee hold for shop ${r.shop_id} on ${r.delivery_date} holds ${sen(r.held)} but its charge says ${sen(r.expected)}.`,
    }));
}

export async function runMoneyChecks(db: Db): Promise<MoneyReport> {
  const defs: [MoneyCheckId, string, (db: Db) => Promise<Failure[]>][] = [
    ['balances_sum_to_zero', 'All account balances add up to zero', sumToZero],
    [
      'no_negative_balances',
      'No shop balance, round hold or delivery fee hold is negative',
      noNegative,
    ],
    ['cached_balances_match_postings', 'Every balance matches its postings', cachedMatchesPostings],
    ['round_holds_match_participations', 'Every round hold matches its participations', holdsMatch],
    [
      'participation_paid_equals_refunds_plus_allocated',
      'Each participation paid = refunds + allocated units at the final price',
      paidEqualsRefundsPlusAllocated,
    ],
    ['kept_within_limits', 'Kept shops never pay above their price limit', keptWithinLimits],
    [
      'final_not_above_starting',
      'The final price is never above the starting price',
      finalNotAboveStarting,
    ],
    [
      'delivery_fee_holds_match_charges',
      'Every delivery fee hold matches its held charge',
      feeHoldsMatchCharges,
    ],
  ];
  const checks: MoneyCheck[] = [];
  for (const [id, label, run] of defs) {
    const failures = await run(db);
    checks.push({ id, label, passed: failures.length === 0, failures });
  }
  return { allPassed: checks.every((c) => c.passed), checks };
}
