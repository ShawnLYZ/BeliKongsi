'use client';

import { useId, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { HubCheckPreview, HubCheckView } from '@/server/modules/supplier-orders/hub-check';
import { apiFetch } from '@/components/common/api-client';
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FIELD_ERROR,
  FIELD_LABEL,
  INPUT,
} from '@/components/common/controls';
import { Money } from '@/components/common/money';
import { formatMyt, formatRM, formatUnits } from '@/lib/format';
import { cn } from '@/lib/utils';
import { TABLE, TABLE_WRAP, TD, TD_NUM, TH, TH_NUM } from './labels';

type Input = { goodUnits: number; damagedUnits: number; notes?: string };

function wholeNumber(text: string): number | null {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
}

/**
 * The hub check (PRD §6.7, §8): count good and damaged units, preview the first-come allocation
 * with any shortfall refunds, then confirm to settle the order and release the simulated payout.
 */
export function HubCheckForm({
  supplierOrderId,
  orderedQuantity,
  unitName,
}: {
  supplierOrderId: string;
  orderedQuantity: number;
  unitName: string;
}) {
  const id = useId();
  const router = useRouter();
  const [good, setGood] = useState('');
  const [damaged, setDamaged] = useState('0');
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<{ input: Input; result: HubCheckPreview } | null>(null);
  const [done, setDone] = useState<HubCheckView | null>(null);
  const [busy, setBusy] = useState(false);

  const goodUnits = wholeNumber(good);
  const damagedUnits = wholeNumber(damaged);
  const valid = goodUnits !== null && damagedUnits !== null;

  function input(): Input {
    const trimmed = notes.trim();
    return {
      goodUnits: goodUnits!,
      damagedUnits: damagedUnits!,
      ...(trimmed ? { notes: trimmed } : {}),
    };
  }

  // Any change to the counts makes the preview stale.
  function edit(set: (v: string) => void) {
    return (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      set(e.target.value);
      setPreview(null);
    };
  }

  async function runPreview() {
    if (!valid) return;
    setBusy(true);
    try {
      const body = input();
      const result = await apiFetch<HubCheckPreview>(
        `/api/supplier-orders/${supplierOrderId}/hub-check?preview=true`,
        { method: 'POST', body },
      );
      setPreview({ input: body, result });
    } catch {
      // apiFetch has already shown the error.
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    try {
      const result = await apiFetch<HubCheckView>(
        `/api/supplier-orders/${supplierOrderId}/hub-check`,
        { method: 'POST', body: preview.input },
      );
      setDone(result);
      toast.success(
        `Hub check recorded. Payout released: ${formatRM(result.payoutSen)} (Simulated).`,
      );
      router.refresh();
    } catch {
      // apiFetch has already shown the error.
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="bg-primary/10 rounded-2xl p-4 text-base">
        <p className="text-lg font-semibold">Hub check recorded</p>
        <p className="tabular-nums">
          Payout released: <Money sen={done.payoutSen} className="font-semibold" />{' '}
          <span className="bg-accent text-accent-foreground rounded-md px-2 py-0.5 font-semibold">
            Simulated
          </span>
        </p>
        <p className="tabular-nums">Payout reference: {done.payoutReference}</p>
      </div>
    );
  }

  const r = preview?.result;
  return (
    <div className="flex flex-col gap-5">
      <form
        className="grid gap-4 md:grid-cols-[repeat(2,minmax(0,14rem))_minmax(0,1fr)]"
        onSubmit={(e) => {
          e.preventDefault();
          void runPreview();
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-good`} className={FIELD_LABEL}>
            Good units
          </label>
          <input
            id={`${id}-good`}
            inputMode="numeric"
            required
            value={good}
            onChange={edit(setGood)}
            aria-invalid={good !== '' && goodUnits === null}
            aria-describedby={`${id}-good-hint`}
            className={cn(INPUT, 'tabular-nums')}
          />
          <p id={`${id}-good-hint`} className="text-muted-foreground text-base">
            Ordered: {formatUnits(orderedQuantity, unitName)}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-damaged`} className={FIELD_LABEL}>
            Damaged units
          </label>
          <input
            id={`${id}-damaged`}
            inputMode="numeric"
            required
            value={damaged}
            onChange={edit(setDamaged)}
            aria-invalid={damaged !== '' && damagedUnits === null}
            className={cn(INPUT, 'tabular-nums')}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-notes`} className={FIELD_LABEL}>
            Notes (optional)
          </label>
          <textarea
            id={`${id}-notes`}
            maxLength={500}
            rows={2}
            value={notes}
            onChange={edit(setNotes)}
            className={cn(INPUT, 'py-2')}
          />
        </div>
        <div className="flex flex-col gap-1 md:col-span-3">
          {(good !== '' && goodUnits === null) || (damaged !== '' && damagedUnits === null) ? (
            <p className={FIELD_ERROR}>Enter whole numbers of units, such as 105 and 0.</p>
          ) : null}
          <div>
            <button type="submit" disabled={busy || !valid} className={BUTTON_SECONDARY}>
              Preview allocation
            </button>
          </div>
        </div>
      </form>

      {r ? (
        <section aria-labelledby={`${id}-preview`} className="flex flex-col gap-3">
          <h3 id={`${id}-preview`} className="text-lg font-semibold">
            Allocation preview (first come, first served)
          </h3>
          {r.excessFlag ? (
            <p className="bg-accent/30 rounded-xl p-3 text-base">
              {r.excessUnits} more good {r.excessUnits === 1 ? 'unit' : 'units'} than ordered. Only
              the ordered quantity is allocated and paid for.
            </p>
          ) : null}
          <div className={TABLE_WRAP}>
            <table className={TABLE}>
              <caption className="sr-only">Allocation by shop, in join order</caption>
              <thead className="bg-muted">
                <tr>
                  <th scope="col" className={TH}>
                    Shop
                  </th>
                  <th scope="col" className={TH}>
                    Joined
                  </th>
                  <th scope="col" className={TH_NUM}>
                    Ordered
                  </th>
                  <th scope="col" className={TH_NUM}>
                    Allocated
                  </th>
                  <th scope="col" className={TH_NUM}>
                    Missing
                  </th>
                  <th scope="col" className={TH_NUM}>
                    Refund
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.allocations.map((a) => (
                  <tr key={a.participationId} className="border-t">
                    <td className={cn(TD, 'font-medium')}>{a.shopName}</td>
                    <td className={cn(TD, 'whitespace-nowrap')}>
                      <time dateTime={a.joinedAt}>{formatMyt(new Date(a.joinedAt))}</time>
                    </td>
                    <td className={TD_NUM}>{a.quantity}</td>
                    <td className={TD_NUM}>{a.allocated}</td>
                    <td className={cn(TD_NUM, a.missing > 0 && 'text-destructive font-semibold')}>
                      {a.missing}
                    </td>
                    <td className={TD_NUM}>
                      <Money sen={a.refundSen} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="grid gap-3 text-base sm:grid-cols-2 xl:grid-cols-4">
            {(
              [
                ['Supplier payout (Simulated)', r.supplierPayableSen],
                ['Fee revenue', r.feeRevenueSen],
                ['Logistics payable', r.logisticsPayableSen],
                ['Shortfall refunds', r.shortfallRefundSen],
              ] as const
            ).map(([label, sen]) => (
              <div key={label} className="bg-card rounded-2xl border p-3">
                <dt className="text-muted-foreground font-semibold">{label}</dt>
                <dd className="text-xl font-bold">
                  <Money sen={sen} />
                </dd>
              </div>
            ))}
          </dl>
          <div>
            <button type="button" disabled={busy} onClick={confirm} className={BUTTON_PRIMARY}>
              Confirm
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
