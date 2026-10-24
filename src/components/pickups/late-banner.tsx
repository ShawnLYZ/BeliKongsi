import { Clock } from 'lucide-react';
import type { PickupView } from '@/lib/views/pickups';
import { formatMyt } from '@/lib/format';

/**
 * Tells owner and staff that goods are late (P1-7, story 74): the new date Ops set and why. When
 * `showCancelNote` is set (owner), it also says when a late item can be cancelled. No money.
 */
export function LateBanner({
  pickup,
  showCancelNote,
}: {
  pickup: PickupView;
  showCancelNote?: boolean;
}) {
  const late = pickup.late;
  if (!late) return null;
  return (
    <section
      aria-labelledby="late-title"
      className="border-destructive/50 bg-destructive/10 flex flex-col gap-1 rounded-2xl border-2 p-5"
    >
      <h2 id="late-title" className="flex items-center gap-2 text-lg font-bold">
        <Clock aria-hidden="true" className="size-6 shrink-0" />
        {pickup.collections.length > 0 ? 'The rest of your goods is late' : 'Your goods are late'}
      </h2>
      <p className="text-base">
        They were due{' '}
        <time dateTime={late.originalExpectedAt}>
          {formatMyt(new Date(late.originalExpectedAt))}
        </time>
        .
      </p>
      {late.newExpectedAt ? (
        <p className="text-base font-semibold">
          New date:{' '}
          <time dateTime={late.newExpectedAt}>{formatMyt(new Date(late.newExpectedAt))}</time>
        </p>
      ) : (
        <p className="text-base">We do not have a new date yet.</p>
      )}
      {late.reason ? <p className="text-base">Reason: {late.reason}</p> : null}
      {showCancelNote ? (
        late.canCancelNow ? (
          <p className="text-base">You can cancel a late item below for a full refund.</p>
        ) : (
          <p className="text-base">
            If it is still late, you can cancel an item from{' '}
            <time dateTime={late.cancelFrom}>{formatMyt(new Date(late.cancelFrom))}</time>.
          </p>
        )
      ) : null}
    </section>
  );
}
