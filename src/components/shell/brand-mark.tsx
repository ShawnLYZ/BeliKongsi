import { cn } from '@/lib/utils';

/**
 * The BeliKongsi mark: two cartons that share a corner, one amber and one teal. Decorative, so it
 * is hidden from assistive tech; the wordmark beside it carries the name.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-7 shrink-0', className)}>
      <rect x="2" y="2" width="18" height="18" rx="4.5" fill="#f5a623" />
      <rect x="12" y="12" width="18" height="18" rx="4.5" fill="#14a094" />
      <path d="M12 16.5a4.5 4.5 0 0 1 4.5-4.5H20v3.5a4.5 4.5 0 0 1-4.5 4.5H12z" fill="#fbf5e6" />
    </svg>
  );
}

/** Mark plus wordmark, as used in every header. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <BrandMark />
      <span className="text-xl font-bold tracking-[-0.03em]">
        Beli<span className="text-accent">Kongsi</span>
      </span>
    </span>
  );
}
