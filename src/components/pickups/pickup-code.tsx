import { formatPickupCode } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The 6-digit pickup code, large and spaced ("482 913"), for showing at the counter. */
export function PickupCode({
  code,
  size = 'large',
  className,
}: {
  code: string;
  size?: 'large' | 'small';
  className?: string;
}) {
  return (
    <p className={cn('flex flex-col', className)}>
      <span className="text-muted-foreground text-base font-semibold">Pickup code</span>
      <span
        className={cn(
          'font-bold tracking-wider tabular-nums',
          size === 'large' ? 'text-5xl' : 'text-2xl',
        )}
      >
        {formatPickupCode(code)}
      </span>
    </p>
  );
}
