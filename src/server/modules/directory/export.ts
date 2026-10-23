import { strToU8, zipSync } from 'fflate';
import { mytDate, mytParts } from '@/lib/time';
import { resolveClock } from '@/server/adapters/clock';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { forbidden, notFound } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireShopAccess } from '@/server/platform/permissions';
import { withTransaction } from '@/server/platform/tx';
import { appendLog } from '../activity/log';
import { REFUND_KINDS } from '../ledger/refund-kinds';
import { getBalanceView } from '../payments/views';
import { monthlySavings } from '../savings/savings';

type Cell = string | number | null | undefined;

const BOM = '﻿';
const PAGE_SIZE = 100;

function cell(value: Cell): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One CSV record (RFC 4180): fields containing a comma, a quote or a line break are quoted. */
export function toCsvRow(values: Cell[]): string {
  return values.map(cell).join(',');
}

/** A CSV file: CRLF after every record, UTF-8 with a byte order mark so spreadsheets read it right. */
export function toCsv(rows: Cell[][]): string {
  return BOM + rows.map((r) => toCsvRow(r) + '\r\n').join('');
}

/** Sen as a plain ringgit decimal (`1392.20`), which spreadsheets read as a number. */
function rm(sen: number): string {
  const abs = Math.abs(sen);
  return `${sen < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

const README = `BeliKongsi data export

This ZIP holds your shop's records as CSV files (UTF-8, comma separated). Times are ISO 8601 in UTC.
Amounts ending in _sen are whole sen (100 sen = RM 1); amounts ending in _rm are plain ringgit
decimals such as 1392.20.

orders.csv         One row per line you joined: the round, product, quantity, status, what you
                   paid, the final all-in price per unit once the round closed, and any refund
                   (in sen) given back on the line.
payments.csv       Every payment for your shop: purpose, method, the total, how much came from your
                   balance, how much was paid outside it, and its status.
money-history.csv  Your balance history, oldest first: payments, balance used, refunds, claim
                   refunds and withdrawals, with the balance after each.
savings.csv        The savings on each line in every month with data: whether the figure is
                   verified (after the delivery check) or estimated, what it is based on, and the
                   saving in sen.

This is a demonstration: the data is synthetic and the payments are simulated. No real money moved.
`;

/** The calendar months (YYYY-MM, Malaysia time) from `from` to `to`, both included. */
function monthsBetween(from: Date, to: Date): string[] {
  const a = mytParts(from);
  const b = mytParts(to);
  const months: string[] = [];
  for (let y = a.year, m = a.month; y < b.year || (y === b.year && m <= b.month);) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

/**
 * The shop's orders, payments, money history and savings as one ZIP of CSV files (story 88).
 * Owner only; another shop's owner gets 404. The export is logged.
 */
export async function exportShopData(
  deps: AppDeps,
  caller: Caller,
  shopId: string,
): Promise<{ filename: string; bytes: Uint8Array }> {
  if (!UUID.test(shopId)) throw notFound('Shop');
  requireShopAccess(caller, shopId, ['owner']);
  if (caller.kind !== 'person') throw forbidden();
  const { prisma } = deps;
  const now = (await resolveClock(deps)).now();

  const [participations, refunds, payments] = await Promise.all([
    prisma.participation.findMany({
      where: { shopId },
      include: { round: { select: { cycleLabel: true, product: { select: { name: true } } } } },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.ledgerPosting.groupBy({
      by: ['participationId'],
      where: { shopId, kind: { in: [...REFUND_KINDS] }, participationId: { not: null } },
      _sum: { amountSen: true },
    }),
    prisma.payment.findMany({ where: { shopId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
  ]);
  const refundOf = new Map(refunds.map((r) => [r.participationId, r._sum.amountSen ?? 0]));

  const orders: Cell[][] = participations.map((p) => [
    p.id,
    p.round.cycleLabel,
    p.round.product.name,
    p.quantity,
    p.status,
    p.joinedAt.toISOString(),
    p.paidSen,
    rm(p.paidSen),
    p.finalAllInSen,
    refundOf.get(p.id) ?? 0,
  ]);

  const paymentRows: Cell[][] = payments.map((p) => [
    p.id,
    p.createdAt.toISOString(),
    p.purpose,
    p.method,
    p.totalSen,
    p.balanceAppliedSen,
    p.externalSen,
    p.status,
  ]);

  // The view pages newest first; the file reads oldest first.
  const history: Cell[][] = [];
  let cursor: string | null = null;
  do {
    const view = await getBalanceView(deps, caller, shopId, { cursor, limit: PAGE_SIZE });
    for (const i of view.history.items) {
      history.push([
        i.at,
        i.kind,
        i.label,
        i.amountSen,
        rm(i.amountSen),
        i.balanceChangeSen,
        i.runningBalanceSen,
        i.reason,
      ]);
    }
    cursor = view.history.nextCursor;
  } while (cursor);
  history.reverse();

  const savings: Cell[][] = [];
  const first = participations[0]?.joinedAt;
  for (const month of first ? monthsBetween(first, now) : []) {
    for (const i of (await monthlySavings(deps, caller, shopId, month)).items) {
      savings.push([i.participationId, i.productName, i.status, i.basis, i.savingSen]);
    }
  }

  const files: Record<string, { header: string[]; rows: Cell[][] }> = {
    'orders.csv': {
      header: [
        'participation_id',
        'round_cycle',
        'product',
        'quantity',
        'status',
        'joined_at',
        'paid_sen',
        'paid_rm',
        'final_all_in_sen',
        'refund_sen',
      ],
      rows: orders,
    },
    'payments.csv': {
      header: [
        'payment_id',
        'created_at',
        'purpose',
        'method',
        'total_sen',
        'balance_applied_sen',
        'paid_sen',
        'status',
      ],
      rows: paymentRows,
    },
    'money-history.csv': {
      header: [
        'at',
        'kind',
        'label',
        'amount_sen',
        'amount_rm',
        'balance_change_sen',
        'running_balance_sen',
        'reason',
      ],
      rows: history,
    },
    'savings.csv': {
      header: ['participation_id', 'product', 'status', 'basis', 'saving_sen'],
      rows: savings,
    },
  };
  const bytes = zipSync({
    'README.txt': strToU8(README),
    ...Object.fromEntries(
      Object.entries(files).map(([name, f]) => [name, strToU8(toCsv([f.header, ...f.rows]))]),
    ),
  });

  await withTransaction(deps, caller, async (ctx) => {
    await appendLog(ctx, {
      action: 'data.exported',
      subjectType: 'shop',
      subjectId: shopId,
      scope: { shopId },
      after: {
        orders: orders.length,
        payments: paymentRows.length,
        moneyHistory: history.length,
        savings: savings.length,
      },
    });
  });
  return { filename: `belikongsi-export-${mytDate(now)}.zip`, bytes };
}
