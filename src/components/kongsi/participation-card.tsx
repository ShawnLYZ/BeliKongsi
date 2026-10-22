import Link from 'next/link';
import type { ParticipationView } from '@/lib/views/participations';
import { BUTTON_QUIET } from '@/components/common/controls';
import { Money } from '@/components/common/money';
import { CancelLineButton } from '@/components/rounds/cancel-line-button';
import { CLOSING_TEXT, isClosing, statusWords } from '@/components/rounds/status-words';
import { formatMyt, formatMytDate, formatUnits } from '@/lib/format';

/** Statuses whose goods are still coming (or came): the ready date means something. */
const GOODS_COMING = new Set(['active', 'kept', 'allocated', 'shorted', 'received']);

/**
 * One of the shop's Kongsi lines on "My Kongsi": its outcome sentence, what was paid, what came
 * back and when the goods are ready. An active line can be cancelled until its cut-off.
 */
export function ParticipationCard({ p, serverNow }: { p: ParticipationView; serverNow: string }) {
  const active = p.status === 'active';
  const closing = active && isClosing(p.cutoffAt, serverNow);
  const what = `${formatUnits(p.quantity, p.unitName)} of ${p.shortName}`;
  const outcome = active
    ? closing
      ? CLOSING_TEXT
      : statusWords(p.status)
    : (p.outcomeReason ?? statusWords(p.status));

  return (
    <article
      aria-labelledby={`line-${p.participationId}`}
      className="bg-card flex flex-col gap-2 rounded-2xl border p-4"
    >
      <div>
        <h2 id={`line-${p.participationId}`} className="text-lg leading-snug font-semibold">
          {p.productName}
        </h2>
        <p className="text-base font-semibold tabular-nums">
          {formatUnits(p.quantity, p.unitName)}
        </p>
      </div>
      <p className={active ? 'text-base' : 'bg-muted rounded-xl p-3 text-base tabular-nums'}>
        {outcome}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-base">
        <dt>Paid</dt>
        <dd className="text-right">
          <Money sen={p.paidSen} />
        </dd>
        {active ? null : (
          <>
            <dt>Back in your balance</dt>
            <dd className="text-right">
              <Money sen={p.refundSen} />
            </dd>
          </>
        )}
        {active ? (
          <>
            <dt>Cut-off</dt>
            <dd className="text-right">
              <time dateTime={p.cutoffAt}>{formatMyt(new Date(p.cutoffAt))}</time>
            </dd>
          </>
        ) : null}
        {GOODS_COMING.has(p.status) ? (
          <>
            <dt>Ready from</dt>
            <dd className="text-right">
              <time dateTime={p.expectedReadyAt}>{formatMytDate(new Date(p.expectedReadyAt))}</time>
            </dd>
          </>
        ) : null}
      </dl>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <Link href={`/owner/rounds/${p.roundId}`} className={`${BUTTON_QUIET} -ml-2 px-2`}>
          See round<span className="sr-only"> for {p.productName}</span>
        </Link>
        {active && !closing ? (
          <CancelLineButton
            participationId={p.participationId}
            description={what}
            paidSen={p.paidSen}
            door={p.destinationType === 'door'}
          />
        ) : null}
      </div>
    </article>
  );
}
