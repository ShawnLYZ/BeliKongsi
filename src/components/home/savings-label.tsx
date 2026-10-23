import type { SavingsView } from '@/lib/views/savings';
import { Money } from '@/components/common/money';
import { cn } from '@/lib/utils';

/** "Estimated" until the delivery check, then "Verified"; a buy-alone baseline says so (PRD §6.10). */
export function savingsLabel({ status, basis }: Pick<SavingsView, 'status' | 'basis'>): string {
  if (basis === 'buy_alone') return 'estimated vs buying alone';
  return status === 'verified' ? 'Verified' : 'Estimated';
}

/** One line's saving with its honesty label. A negative saving stays negative. */
export function SavingsAmount({
  savingSen,
  status,
  basis,
}: Pick<SavingsView, 'savingSen' | 'status' | 'basis'>) {
  return (
    <span className="inline-flex flex-wrap items-baseline justify-end gap-x-2">
      <Money
        sen={savingSen}
        className={cn('font-semibold', savingSen < 0 ? 'text-destructive' : 'text-primary')}
      />
      <span className="text-muted-foreground text-base">{savingsLabel({ status, basis })}</span>
    </span>
  );
}
