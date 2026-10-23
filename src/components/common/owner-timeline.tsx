import type { LogEntryView } from '@/server/modules/activity/query';
import { actionLabel } from '@/components/common/timeline';
import { formatMyt, formatRM } from '@/lib/format';

/** Plain-English names for the steps an owner sees (PRD §22). Others fall back to `actionLabel`. */
const OWNER_LABELS: Record<string, string> = {
  'basket.drafted': 'Basket drafted',
  'basket.approved': 'Basket approved',
  'basket.skipped': 'Week skipped',
  'basket.expired': 'Basket deadline passed',
  'payment.succeeded': 'Payment received',
  'payment.failed': 'Payment failed',
  'balance.applied': 'Balance used',
  'participation.joined': 'You joined the round',
  'participation.cancelled': 'You cancelled this line',
  'participation.dropped_price_limit': 'Dropped: the price went over your limit',
  'round.closed': 'Round closed, final price set',
  'refund.issued': 'Refund to your balance',
  'supplier_order.dispatched': 'Supplier sent the goods',
  'fulfilment.pickup_ready': 'Your goods are ready',
  'fulfilment.pickup_collected': 'Collected',
  'fulfilment.delivered': 'Delivered to your door',
  'check.delivery_check_submitted': 'Delivery checked',
  'claim.submitted': 'Claim opened',
  'claim.approved': 'Claim approved',
  'claim.rejected': 'Claim not approved',
};

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** One short readable line about what happened, or null when the label says it all. */
function summary(item: LogEntryView): string | null {
  const after = record(item.after);
  const sen = (v: unknown) => (typeof v === 'number' ? formatRM(v) : null);
  switch (item.action) {
    case 'participation.joined':
      return typeof after.quantity === 'number' ? `${after.quantity} ordered` : null;
    case 'refund.issued':
      return sen(after.amountSen);
    case 'claim.submitted':
      return sen(after.totalRefundSen) && `You asked for ${sen(after.totalRefundSen)}`;
    case 'claim.approved':
      return sen(after.refundSen) && `${sen(after.refundSen)} refunded`;
    case 'check.delivery_check_submitted':
      return after.result === 'issues' ? 'A problem was reported' : 'Everything arrived';
    default:
      return null;
  }
}

/** The owner's timeline: plain labels, a short summary, no ids or raw data. Oldest first. */
export function OwnerTimeline({ items }: { items: LogEntryView[] }) {
  return (
    <ol className="border-border relative flex flex-col gap-3 border-l-2 pl-5">
      {items.map((item) => {
        const text = summary(item);
        return (
          <li key={item.seq} className="bg-card relative rounded-xl border p-4">
            <span
              aria-hidden
              className="border-card bg-primary absolute top-5 -left-[1.95rem] size-3 rounded-full border-2"
            />
            <p className="text-base font-semibold">
              {OWNER_LABELS[item.action] ?? actionLabel(item.action)}
            </p>
            {text ? <p className="text-base tabular-nums">{text}</p> : null}
            {item.reason ? <p className="text-base">{item.reason}</p> : null}
            <p className="text-muted-foreground text-base tabular-nums">
              <time dateTime={item.occurredAt}>{formatMyt(new Date(item.occurredAt))}</time>
            </p>
          </li>
        );
      })}
    </ol>
  );
}
