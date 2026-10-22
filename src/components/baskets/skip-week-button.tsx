'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { apiFetch } from '@/components/common/api-client';
import { BottomSheet } from '@/components/common/bottom-sheet';
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_LABEL } from '@/components/common/controls';

const MAX_REASON = 500;

/** "Skip this week", with an optional reason. Nothing is charged for a skipped basket. */
export function SkipWeekButton({ basketId }: { basketId: string }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function skip() {
    setBusy(true);
    try {
      const text = reason.trim();
      await apiFetch(`/api/baskets/${basketId}/skip`, {
        method: 'POST',
        body: text ? { reason: text } : {},
      });
      toast.success('Skipped. Nothing is charged this week.');
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
      <button type="button" className={`${BUTTON_SECONDARY} w-full`} onClick={() => setOpen(true)}>
        Skip this week
      </button>
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title="Skip this week?"
        description="This week's basket won't be ordered and nothing is charged. Next Monday's basket comes as usual."
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-reason`} className={FIELD_LABEL}>
            Reason (optional)
          </label>
          <textarea
            id={`${id}-reason`}
            value={reason}
            maxLength={MAX_REASON}
            rows={3}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Shop closed for the holidays"
            className="border-input/60 bg-card focus-visible:border-ring focus-visible:ring-ring/60 w-full rounded-xl border-2 p-3 text-base outline-none focus-visible:ring-3"
          />
        </div>
        <button type="button" className={BUTTON_PRIMARY} disabled={busy} onClick={skip}>
          {busy ? 'Skipping…' : 'Skip this week'}
        </button>
        <button type="button" className={BUTTON_SECONDARY} onClick={() => setOpen(false)}>
          Keep my basket
        </button>
      </BottomSheet>
    </>
  );
}
