import { formatRM } from '@/lib/format';
import { cn } from '@/lib/utils';

/** An amount in sen, shown as "RM 1,234.56" with tabular numbers. Never render it for staff. */
export function Money({ sen, className }: { sen: number; className?: string }) {
  return <span className={cn('tabular-nums', className)}>{formatRM(sen)}</span>;
}
