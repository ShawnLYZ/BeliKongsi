'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { apiFetch } from '@/components/common/api-client';
import { BottomSheet } from '@/components/common/bottom-sheet';
import { BUTTON_DANGER, BUTTON_PRIMARY, BUTTON_SECONDARY } from '@/components/common/controls';
import { formatRM } from '@/lib/format';
import { cn } from '@/lib/utils';

/** "Cancel" on one round line, after a confirmation. The full amount goes back to the balance. */
export function CancelLineButton({
  participationId,
  description,
  paidSen,
  door,
}: {
  participationId: string;
  /** "6 cartons of condensed milk". */
  description: string;
  paidSen: number;
  /** A door delivery line: cancelling the last one for a date also refunds that date's fee. */
  door: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function cancel() {
    setBusy(true);
    try {
      const r = await apiFetch<{ refundSen: number; deliveryFeeRefundSen: number }>(
        `/api/participations/${participationId}/cancel`,
        { method: 'POST' },
      );
      toast.success(
        r.deliveryFeeRefundSen > 0
          ? `Cancelled. ${formatRM(r.refundSen)} for the line and the ${formatRM(r.deliveryFeeRefundSen)} delivery fee are back in your balance.`
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
        Cancel<span className="sr-only"> {description}</span>
      </button>
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title="Cancel this line?"
        description={description}
      >
        <p className="text-base">
          You leave this Kongsi round. The {formatRM(paidSen)} you paid for this line goes back to
          your BeliKongsi balance straight away.
          {door
            ? ' If it is your last door delivery for that date, the delivery fee comes back too.'
            : ''}
        </p>
        <button type="button" className={BUTTON_PRIMARY} disabled={busy} onClick={cancel}>
          {busy ? 'Cancelling…' : 'Yes, cancel this line'}
        </button>
        <button type="button" className={BUTTON_SECONDARY} onClick={() => setOpen(false)}>
          Keep it
        </button>
      </BottomSheet>
    </>
  );
}
