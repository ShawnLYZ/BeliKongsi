'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ApiError, apiFetch } from '@/components/common/api-client';
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FIELD_ERROR,
  FIELD_LABEL,
  INPUT,
} from '@/components/common/controls';
import { formatMytDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * "Set new date" with a reason, for goods that will be late (P1-7, story 74). Ops acts as the
 * logistics partner; every shop affected is told the new date. `endpoint` is the delay route of a
 * consignment or a supplier order (`POST .../delay`).
 */
export function NewDateForm({ endpoint, className }: { endpoint: string; className?: string }) {
  const id = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!date) {
      setError('Pick the new date.');
      return;
    }
    if (reason.trim() === '') {
      setError('Please give a reason for the new date.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(endpoint, { method: 'POST', body: { newDate: date, reason }, quiet: true });
      toast.success(`New date set: ${formatMytDate(date)}. The shops have been told.`);
      setOpen(false);
      setDate('');
      setReason('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(BUTTON_SECONDARY, 'w-full', className)}
      >
        Set new date
      </button>
    );
  }

  return (
    <form
      noValidate
      className={cn('flex flex-col gap-2', className)}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label htmlFor={`${id}-date`} className={FIELD_LABEL}>
        New date
      </label>
      <input
        id={`${id}-date`}
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className={INPUT}
      />
      <label htmlFor={`${id}-reason`} className={FIELD_LABEL}>
        Reason
      </label>
      <input
        id={`${id}-reason`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={200}
        aria-describedby={`${id}-hint`}
        className={INPUT}
      />
      <p id={`${id}-hint`} className="text-muted-foreground text-base">
        Shops and staff will read this. Don&apos;t include prices.
      </p>
      {error ? (
        <p role="alert" className={FIELD_ERROR}>
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={BUTTON_PRIMARY}>
          {busy ? 'Saving…' : 'Save new date'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className={BUTTON_SECONDARY}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
