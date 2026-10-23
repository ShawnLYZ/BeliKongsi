import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { MonthlySavingsView } from '@/lib/views/savings';
import { Money } from '@/components/common/money';
import { SavingsAmount } from './savings-label';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "2026-11" -> "November 2026" */
export function monthTitle(month: string): string {
  const [year, m] = month.split('-');
  return `${MONTHS[Number(m) - 1]} ${year}`;
}

/** The `YYYY-MM` before or after `month`. */
export function shiftMonth(month: string, by: 1 | -1): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const index = year * 12 + (m - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

const ARROW =
  'focus-visible:ring-ring/60 hover:bg-muted border-input/50 bg-card inline-flex size-12 items-center justify-center rounded-xl border-2 outline-none focus-visible:ring-3';

/** Previous and next month links; the next one is off for the current month. */
export function MonthSwitcher({ month, current }: { month: string; current: string }) {
  const next = shiftMonth(month, 1);
  return (
    <nav aria-label="Month" className="flex items-center justify-between gap-3">
      <Link href={`/owner/savings?month=${shiftMonth(month, -1)}`} className={ARROW}>
        <ChevronLeft aria-hidden="true" className="size-6" />
        <span className="sr-only">Previous month</span>
      </Link>
      <h2 className="text-xl font-bold">{monthTitle(month)}</h2>
      {next <= current ? (
        <Link href={`/owner/savings?month=${next}`} className={ARROW}>
          <ChevronRight aria-hidden="true" className="size-6" />
          <span className="sr-only">Next month</span>
        </Link>
      ) : (
        <span aria-hidden="true" className="size-12" />
      )}
    </nav>
  );
}

/** One month's figures and a row for each round that counts in it (PRD §22 "Savings"). */
export function SavingsMonth({ view }: { view: MonthlySavingsView }) {
  const rows: [string, ReactNode][] = [
    ['Rounds joined', view.roundsJoined],
    ['Units bought', view.unitsBought],
    ['Refunds to your balance', <Money key="r" sen={view.refundsSen} />],
    ['Fees paid', <Money key="f" sen={view.feesPaidSen} />],
    ['Delivery fees', <Money key="d" sen={view.deliveryFeesSen} />],
  ];
  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby="month-saved"
        className="bg-card flex flex-col gap-1 rounded-2xl border p-5"
      >
        <h3 id="month-saved" className="text-lg font-semibold">
          Saved this month
        </h3>
        <p className="text-3xl font-bold">
          <Money
            sen={view.verifiedSavingsSen}
            className={view.verifiedSavingsSen < 0 ? 'text-destructive' : undefined}
          />{' '}
          <span className="text-base font-semibold">verified</span>
        </p>
        <p className="text-base tabular-nums">
          {view.percentSaved === null
            ? 'The percentage appears once a delivery has been checked on goods with a usual price. Buying alone is not counted in it.'
            : `${view.percentSaved}% less than your usual prices, before delivery fees`}
        </p>
        <p className="text-base tabular-nums">
          <span className="font-semibold">Estimated:</span>{' '}
          <Money
            sen={view.estimatedSavingsSen}
            className={view.estimatedSavingsSen < 0 ? 'text-destructive' : undefined}
          />{' '}
          more once your goods are checked
        </p>
        <p className="text-muted-foreground text-base">
          The amount saved is after the delivery fees of the pickups checked this month. The
          percentage is before those fees.
        </p>
      </section>
      <dl className="bg-card grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 rounded-2xl border p-5 text-base tabular-nums">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt>{label}</dt>
            <dd className="text-right font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      {view.items.length > 0 ? (
        <section aria-labelledby="month-rounds" className="flex flex-col gap-2">
          <h3 id="month-rounds" className="text-lg font-semibold">
            Each round
          </h3>
          <ul className="bg-card flex flex-col divide-y rounded-2xl border">
            {view.items.map((item) => (
              <li
                key={item.participationId}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 p-4 text-base"
              >
                <span className="font-medium">{item.productName}</span>
                <SavingsAmount savingSen={item.savingSen} status={item.status} basis={item.basis} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
