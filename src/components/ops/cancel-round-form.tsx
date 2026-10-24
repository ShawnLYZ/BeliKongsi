'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { apiFetch } from '@/components/common/api-client';
import {
  BUTTON_DANGER,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FIELD_LABEL,
  INPUT,
} from '@/components/common/controls';
import { formatRM } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Ops cancel an open round in an emergency (P1-18): a reason is required, every shop gets its
 * money back in full, and the next round opens unless the product is paused too.
 */
export function CancelRoundForm({ roundId }: { roundId: string }) {
  const id = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pause, setPause] = useState(false);
  const [busy, setBusy] = useState(false);

  async function cancel() {
    setBusy(true);
    try {
      const result = await apiFetch<{ refundedSen: number }>(`/api/rounds/${roundId}/cancel`, {
        method: 'POST',
        body: { reason: reason.trim(), pauseProduct: pause },
      });
      toast.success(`Kongsi cancelled. Refunded in full: ${formatRM(result.refundedSen)}.`);
    } catch {
      // apiFetch has already shown the error.
    } finally {
      // A 409 means the round is no longer open: refresh so the button goes away.
      router.refresh();
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div>
        <button type="button" className={BUTTON_DANGER} onClick={() => setOpen(true)}>
          Cancel this Kongsi
        </button>
      </div>
    );
  }

  return (
    <form
      className="bg-card flex max-w-xl flex-col gap-3 rounded-2xl border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void cancel();
      }}
    >
      <p className="text-base">
        Every shop in this Kongsi gets its money back in full, and each owner is told why.
      </p>
      <label htmlFor={`${id}-reason`} className={FIELD_LABEL}>
        Reason for cancelling (required)
      </label>
      <textarea
        id={`${id}-reason`}
        required
        maxLength={1000}
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className={cn(INPUT, 'py-2')}
      />
      <label htmlFor={`${id}-pause`} className="flex min-h-12 items-center gap-3 text-base">
        <input
          id={`${id}-pause`}
          type="checkbox"
          checked={pause}
          onChange={(e) => setPause(e.target.checked)}
          className="size-6"
        />
        Also pause this product, so no new Kongsi opens
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || reason.trim() === ''} className={BUTTON_PRIMARY}>
          Cancel and refund everyone
        </button>
        <button
          type="button"
          disabled={busy}
          className={BUTTON_SECONDARY}
          onClick={() => setOpen(false)}
        >
          Keep it open
        </button>
      </div>
    </form>
  );
}
