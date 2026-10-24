'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { PickupLineView, PickupView } from '@/lib/views/pickups';
import { apiFetch } from '@/components/common/api-client';
import { BottomSheet } from '@/components/common/bottom-sheet';
import { BUTTON_DANGER, BUTTON_PRIMARY, BUTTON_SECONDARY } from '@/components/common/controls';
import { formatRM, formatUnits } from '@/lib/format';
import { cn } from '@/lib/utils';

type Result = {
  refundSen: number;
  deliveryFeeRefundSen: number;
  source: 'round_hold' | 'claims_expense';
};

function CancelLateItem({ line }: { line: PickupLineView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const description = `${line.productName}, ${formatUnits(line.quantity, line.unitName)}`;

  async function cancel() {
    setBusy(true);
    try {
      const r = await apiFetch<Result>(`/api/participations/${line.participationId}/late-cancel`, {
        method: 'POST',
      });
      toast.success(
        r.deliveryFeeRefundSen > 0
          ? `Cancelled. ${formatRM(r.refundSen)} for the item and the ${formatRM(r.deliveryFeeRefundSen)} delivery fee are back in your balance.`
          : `Cancelled. ${formatRM(r.refundSen)} is back in your balance.`,
      );
      setOpen(false);
      router.refresh();
    } catch {
      // Shown as a toast by apiFetch.
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={cn(BUTTON_DANGER, 'border-destructive/40 border-2')}
        onClick={() => setOpen(true)}
      >
        Cancel late item<span className="sr-only">: {description}</span>
      </button>
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title="Cancel this late item?"
        description={description}
      >
        <p className="text-base">
          It is late, so you get a full refund. The money goes back to your BeliKongsi balance
          straight away. You cannot undo this.
        </p>
        <button type="button" className={BUTTON_PRIMARY} disabled={busy} onClick={cancel}>
          {busy ? 'Cancelling…' : 'Yes, cancel this item'}
        </button>
        <button type="button" className={BUTTON_SECONDARY} onClick={() => setOpen(false)}>
          Keep it
        </button>
      </BottomSheet>
    </>
  );
}

/**
 * The owner's "Cancel late item" buttons (P1-7), one per item still waiting, shown only once the
 * 72 hours have passed. Staff never get this list.
 */
export function LateCancelList({ pickup }: { pickup: PickupView }) {
  if (!pickup.late?.canCancelNow) return null;
  const collected = new Set(pickup.collections.flatMap((c) => c.lines.map((l) => l.allocationId)));
  const waiting = pickup.lines.filter((l) => !l.allocationId || !collected.has(l.allocationId));
  if (waiting.length === 0) return null;
  return (
    <section
      aria-labelledby="late-items-title"
      className="bg-card flex flex-col gap-3 rounded-2xl border p-5"
    >
      <h2 id="late-items-title" className="text-lg font-semibold">
        Late items
      </h2>
      <ul className="flex flex-col divide-y">
        {waiting.map((l) => (
          <li key={l.participationId} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
            <p className="text-base">
              <span className="font-semibold">{l.productName}</span>{' '}
              <span className="tabular-nums">{formatUnits(l.quantity, l.unitName)}</span>
            </p>
            <p className="text-muted-foreground text-base">
              {l.readyToCollect ? 'Ready to collect' : 'Not arrived yet'}
            </p>
            <CancelLateItem line={l} />
          </li>
        ))}
      </ul>
    </section>
  );
}
