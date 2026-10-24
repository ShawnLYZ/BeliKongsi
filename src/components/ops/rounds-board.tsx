import Link from 'next/link';
import type { OpsRoundsBoard } from '@/lib/views/ops';
import { Money } from '@/components/common/money';
import { statusWords } from '@/components/rounds/status-words';
import { formatMyt } from '@/lib/format';
import { LINK, orderStatusLabel, percent } from './labels';

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-card rounded-2xl border p-4">
      <dt className="text-muted-foreground text-base font-semibold">{label}</dt>
      <dd className="mt-1 text-3xl font-bold tracking-[-0.02em] tabular-nums">{value}</dd>
      <dd className="text-muted-foreground text-base">{note}</dd>
    </div>
  );
}

/** Every round in a column for its status, with the success rate, average tier and shops (story 129). */
export function RoundsBoard({ board }: { board: OpsRoundsBoard }) {
  const { stats } = board;
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Success rate"
          value={percent(stats.successRate)}
          note="Rounds that went ahead, of rounds that closed with orders"
        />
        <Stat
          label="Average tier"
          value={stats.averageTier === null ? '—' : stats.averageTier.toFixed(1)}
          note="Over rounds that went ahead"
        />
        <Stat
          label="Shops per round"
          value={stats.averageShopsPerRound === null ? '—' : stats.averageShopsPerRound.toFixed(1)}
          note="Average, over rounds that went ahead"
        />
      </dl>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4">
        {board.columns.map((col) => (
          <section
            key={col.status}
            aria-labelledby={`col-${col.status}`}
            className="bg-muted/55 border-border/70 flex flex-col gap-2 rounded-2xl border p-3"
          >
            <h2
              id={`col-${col.status}`}
              className="flex items-center justify-between gap-2 px-1 text-base font-semibold"
            >
              <span>{statusWords(col.status)}</span>
              <span className="bg-card text-muted-foreground min-w-7 rounded-full px-2 text-center text-sm leading-6 tabular-nums ring-1 ring-black/5">
                {col.rounds.length}
              </span>
            </h2>
            {col.rounds.length === 0 ? (
              <p className="text-muted-foreground text-base">No rounds</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {col.rounds.map((r) => (
                  <li key={r.roundId} className="bg-card rounded-xl border p-3 text-base">
                    <Link href={`/ops/rounds/${r.roundId}`} className={LINK}>
                      {r.productName}
                    </Link>
                    <p className="text-muted-foreground">
                      {r.supplierName} · {r.hubName} · {r.cycleLabel}
                    </p>
                    <p className="tabular-nums">
                      Cut-off <time dateTime={r.cutoffAt}>{formatMyt(new Date(r.cutoffAt))}</time>
                    </p>
                    <p className="tabular-nums">
                      {r.shopCount} {r.shopCount === 1 ? 'shop' : 'shops'}
                      {r.totalKept !== null ? ` · ${r.totalKept} kept` : ''}
                      {r.finalTier !== null ? ` · tier ${r.finalTier}` : ''}
                      {r.finalUnitPriceSen !== null ? (
                        <>
                          {' · '}
                          <Money sen={r.finalUnitPriceSen} />
                        </>
                      ) : null}
                    </p>
                    {r.supplierOrderId ? (
                      <p>
                        <Link href={`/ops/supplier-orders/${r.supplierOrderId}`} className={LINK}>
                          Order: {orderStatusLabel(r.supplierOrderStatus ?? '')}
                        </Link>
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
