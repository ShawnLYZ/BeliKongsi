'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ApiError, apiFetch } from '@/components/common/api-client';
import { BottomSheet } from '@/components/common/bottom-sheet';
import {
  BUTTON_DANGER,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FIELD_ERROR,
  FIELD_LABEL,
  INPUT,
} from '@/components/common/controls';
import { cn } from '@/lib/utils';

type Result = { canApprove: boolean };

/** Export the shop's data as a ZIP, or ask for it to be deleted. */
export function YourDataCard({ shopId }: { shopId: string }) {
  const id = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState<Result | null>(null);

  async function request() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<Result>(`/api/shops/${shopId}/deletion-request`, {
        method: 'POST',
        body: reason.trim() ? { reason: reason.trim() } : {},
        quiet: true,
      });
      setRequested(result);
      setOpen(false);
      toast.success('Deletion requested.');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="bg-card flex flex-col gap-3 rounded-2xl border p-4"
    >
      <h2 id={`${id}-title`} className="text-xl font-semibold">
        Your data
      </h2>
      <p className="text-base">
        Download everything BeliKongsi holds about your shop as a ZIP of spreadsheet (CSV) files.
      </p>
      <a href={`/api/shops/${shopId}/export`} download className={BUTTON_SECONDARY}>
        Export my data
      </a>

      <p className="text-base">
        If you use a photo, it is sent to our AI provider so it can be read, and BeliKongsi does not
        keep it. Cover names and phone numbers before you take the photo.
      </p>

      <p className="text-base">
        You can ask for your shop and its people to be deleted. Our team checks the request.
      </p>
      {requested ? (
        <p role="status" className="bg-muted rounded-xl p-3 text-base">
          Your request is with our team.{' '}
          {requested.canApprove
            ? 'Nothing is open, so it can go ahead.'
            : 'It cannot go ahead until your open rounds, pickups, claims and payments are done and your balance is withdrawn.'}
        </p>
      ) : null}
      <button type="button" className={BUTTON_DANGER} onClick={() => setOpen(true)}>
        Request deletion
      </button>

      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title="Request deletion"
        description="Your shop and its people are made anonymous. This cannot be undone."
      >
        <div className="flex flex-col gap-2 text-base">
          <p>
            <span className="font-semibold">What we keep:</span> payment and money records, under an
            anonymous ID with no name, for the period the law requires us to keep accounts. The
            activity log stays as it is.
          </p>
          <p>
            <span className="font-semibold">Before it can go ahead:</span> no open rounds, pickups,
            claims or payments, and your balance withdrawn to zero. Withdraw it from the Money
            screen first.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-reason`} className={FIELD_LABEL}>
            Reason (optional)
          </label>
          <textarea
            id={`${id}-reason`}
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={cn(INPUT, 'py-2')}
          />
        </div>
        {error ? (
          <p role="alert" className={FIELD_ERROR}>
            {error}
          </p>
        ) : null}
        <div className="flex flex-col gap-2">
          <button type="button" className={BUTTON_PRIMARY} disabled={busy} onClick={request}>
            {busy ? 'Sending…' : 'Send deletion request'}
          </button>
          <button type="button" className={BUTTON_SECONDARY} onClick={() => setOpen(false)}>
            Keep my data
          </button>
        </div>
      </BottomSheet>
    </section>
  );
}
