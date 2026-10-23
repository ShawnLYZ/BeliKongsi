'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { apiFetch } from '@/components/common/api-client';
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_LABEL, INPUT } from '@/components/common/controls';
import { cn } from '@/lib/utils';

/** Ops approves a claim, or rejects it with a reason (PRD §12), through the approval endpoints. */
export function ClaimDecision({ approvalId }: { approvalId: string }) {
  const reasonId = useId();
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true);
    try {
      await apiFetch(`/api/approvals/${approvalId}/${decision}`, {
        method: 'POST',
        body: decision === 'reject' ? { reason: reason.trim() } : {},
      });
      toast.success(
        decision === 'approve'
          ? 'Approved. The refund is in the shop balance.'
          : 'Rejected. The shop has been told why.',
      );
      router.refresh();
    } catch {
      // apiFetch has already shown the error; refresh so stale buttons (e.g. after a 409) go away.
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (rejecting) {
    return (
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void decide('reject');
        }}
      >
        <label htmlFor={reasonId} className={FIELD_LABEL}>
          Reason for rejecting (required)
        </label>
        <textarea
          id={reasonId}
          required
          maxLength={1000}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={cn(INPUT, 'py-2')}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy || reason.trim() === ''}
            className={cn(BUTTON_PRIMARY, 'bg-destructive hover:bg-destructive/90 text-white')}
          >
            Reject
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setRejecting(false)}
            className={BUTTON_SECONDARY}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void decide('approve')}
        className={BUTTON_PRIMARY}
      >
        Approve
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setRejecting(true)}
        className={BUTTON_SECONDARY}
      >
        Reject
      </button>
    </div>
  );
}
