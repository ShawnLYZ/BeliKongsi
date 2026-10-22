'use client';

import { useState } from 'react';
import type { BalanceView, MoneyHistoryItem } from '@/lib/views/payments';
import { apiFetch } from '@/components/common/api-client';
import { BUTTON_SECONDARY } from '@/components/common/controls';
import { EmptyState } from '@/components/common/empty-state';
import { Money } from '@/components/common/money';
import { formatMyt, formatRM } from '@/lib/format';

function change(item: MoneyHistoryItem): string {
  if (item.balanceChangeSen > 0) return `+${formatRM(item.balanceChangeSen)} to your balance`;
  if (item.balanceChangeSen < 0) return `−${formatRM(-item.balanceChangeSen)} from your balance`;
  return 'Paid outside your balance';
}

/** The BeliKongsi balance and the money history, newest first, with the balance after each item. */
export function MoneyHistory({ shopId, initial }: { shopId: string; initial: BalanceView }) {
  const [items, setItems] = useState(initial.history.items);
  const [cursor, setCursor] = useState(initial.history.nextCursor);
  const [loading, setLoading] = useState(false);

  async function more() {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await apiFetch<BalanceView>(
        `/api/shops/${shopId}/balance?cursor=${encodeURIComponent(cursor)}`,
      );
      setItems((prev) => [...prev, ...page.history.items]);
      setCursor(page.history.nextCursor);
    } catch {
      // Shown as a toast by apiFetch.
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="bg-primary/10 flex flex-col gap-1 rounded-2xl p-4">
        <h2 className="text-base font-medium">Your BeliKongsi balance</h2>
        <p className="text-3xl font-bold">
          <Money sen={initial.balanceSen} />
        </p>
        <p className="text-base">Refunds land here. It is used first the next time you pay.</p>
      </section>

      <section aria-labelledby="money-history" className="flex flex-col gap-3">
        <h2 id="money-history" className="text-xl font-semibold">
          Money history
        </h2>
        {items.length === 0 ? (
          <EmptyState
            title="Nothing yet"
            explanation="Every payment, refund and use of your balance appears here, newest first, with your balance after it."
            example="Payment (simulated) — DuitNow QR, RM 1,848.60."
          />
        ) : (
          <ul className="bg-card flex flex-col divide-y rounded-2xl border">
            {items.map((item, i) => (
              <li key={`${item.at}-${item.kind}-${i}`} className="flex flex-col gap-1 p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-base font-semibold">{item.label}</p>
                  <p className="text-base font-semibold">
                    <Money sen={item.amountSen} />
                  </p>
                </div>
                <p className="text-muted-foreground text-base">
                  <time dateTime={item.at}>{formatMyt(new Date(item.at))}</time>
                </p>
                <p className="text-base tabular-nums">{change(item)}</p>
                <p className="text-muted-foreground text-base">
                  Balance after: <Money sen={item.runningBalanceSen} />
                </p>
                {item.reason ? <p className="text-base">{item.reason}</p> : null}
              </li>
            ))}
          </ul>
        )}
        {cursor ? (
          <button type="button" className={BUTTON_SECONDARY} disabled={loading} onClick={more}>
            {loading ? 'Loading…' : 'Show older'}
          </button>
        ) : null}
      </section>
    </div>
  );
}
