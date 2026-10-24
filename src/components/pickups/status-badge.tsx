import type { PickupView } from '@/lib/views/pickups';
import { cn } from '@/lib/utils';
import { canHandOver, isHandedOver } from './steps';

/** The pickup's story 71 label as a pill: teal when ready, muted once handed over. */
export function PickupStatusBadge({ pickup }: { pickup: PickupView }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-lg px-2 py-0.5 text-base font-semibold',
        canHandOver(pickup)
          ? 'bg-primary text-primary-foreground'
          : isHandedOver(pickup)
            ? 'bg-muted text-foreground'
            : 'bg-accent/30 text-foreground',
      )}
    >
      {pickup.status === 'partly_ready' ? 'Part of your goods is ready' : pickup.statusLabel}
    </span>
  );
}
