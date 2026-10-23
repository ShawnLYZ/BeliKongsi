import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { BUTTON_SECONDARY } from '@/components/common/controls';
import { Money } from '@/components/common/money';

/** Owner home: this month's verified savings, with the not-yet-checked part labelled Estimated. */
export function SavingsCard({
  verifiedSen,
  estimatedSen,
}: {
  verifiedSen: number;
  estimatedSen: number;
}) {
  return (
    <section
      aria-labelledby="savings-card"
      className="bg-card flex flex-col gap-2 rounded-2xl border p-5"
    >
      <h2 id="savings-card" className="text-lg font-semibold">
        Savings this month
      </h2>
      <p className="text-2xl font-bold">
        <Money sen={verifiedSen} className={verifiedSen < 0 ? 'text-destructive' : undefined} />{' '}
        <span className="text-base font-semibold">verified</span>
      </p>
      <p className="text-base tabular-nums">
        <span className="font-semibold">Estimated:</span>{' '}
        <Money sen={estimatedSen} className={estimatedSen < 0 ? 'text-destructive' : undefined} />{' '}
        more once your goods are checked
      </p>
      <Link href="/owner/savings" className={`${BUTTON_SECONDARY} mt-1`}>
        See the details
        <ChevronRight aria-hidden="true" className="size-5" />
      </Link>
    </section>
  );
}
