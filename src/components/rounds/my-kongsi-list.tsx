import Link from 'next/link';
import type { MyKongsiLineView } from '@/lib/views/rounds';
import { BUTTON_QUIET } from '@/components/common/controls';
import { Money } from '@/components/common/money';
import { formatMyt, formatMytDate, formatUnits } from '@/lib/format';
import { CancelLineButton } from './cancel-line-button';
import { statusWords } from './status-words';

/** "My Kongsi": the shop's lines in open rounds; active ones can be cancelled before cut-off. */
export function MyKongsiList({ lines }: { lines: MyKongsiLineView[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {lines.map((p) => {
        const what = `${formatUnits(p.quantity, p.unitName)} of ${p.shortName}`;
        return (
          <li key={p.id} className="bg-card flex flex-col gap-1 rounded-2xl border p-4">
            <h2 className="text-lg leading-snug font-semibold">{p.name}</h2>
            <p className="text-base font-semibold tabular-nums">
              {formatUnits(p.quantity, p.unitName)}
            </p>
            <p className="text-base">
              <Money sen={p.startingAllInSen} /> each, paid <Money sen={p.paidSen} />
            </p>
            <p className="text-base">
              {p.destinationType === 'door' ? 'Delivery to your door' : 'Pickup point'} ·{' '}
              {formatMytDate(p.deliveryDate)}
            </p>
            <p className="text-base">
              Cut-off <time dateTime={p.cutoffAt}>{formatMyt(new Date(p.cutoffAt))}</time>
            </p>
            <p className="text-muted-foreground text-base">Status: {statusWords(p.status)}</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <Link href={`/owner/rounds/${p.roundId}`} className={`${BUTTON_QUIET} -ml-2 px-2`}>
                See round<span className="sr-only"> for {p.name}</span>
              </Link>
              {p.canCancel ? (
                <CancelLineButton
                  participationId={p.id}
                  description={what}
                  paidSen={p.paidSen}
                  door={p.destinationType === 'door'}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
