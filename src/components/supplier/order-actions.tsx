'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { SupplierOrderView } from '@/lib/views/supplier';
import { apiFetch } from '@/components/common/api-client';
import {
  BUTTON_DANGER,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FIELD_LABEL,
  INPUT,
} from '@/components/common/controls';
import { formatMytDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * What a supplier can do with an order: confirm with a dispatch date or reject with a reason
 * while it waits for them, then mark it dispatched (PRD §12, stories 104–107).
 */
export function OrderActions({ order, today }: { order: SupplierOrderView; today: string }) {
  const id = useId();
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'confirm' | 'reject'>('idle');
  const [date, setDate] = useState(
    order.requiredDispatchDate >= today ? order.requiredDispatchDate : today,
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(path: string, body: unknown, done: string) {
    setBusy(true);
    try {
      await apiFetch(path, { method: 'POST', body });
      toast.success(done);
      setMode('idle');
      router.refresh();
    } catch {
      // apiFetch has already shown the error.
    } finally {
      setBusy(false);
    }
  }

  if (order.status === 'confirmed') {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          run(
            `/api/supplier-orders/${order.supplierOrderId}/dispatched`,
            {},
            'Marked dispatched. BeliKongsi will check the goods at the hub.',
          )
        }
        className={cn(BUTTON_PRIMARY, 'w-full')}
      >
        Mark dispatched
      </button>
    );
  }

  if (order.status !== 'awaiting_supplier' || !order.approvalId) return null;
  const approval = order.approvalId;

  if (mode === 'confirm') {
    return (
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            `/api/approvals/${approval}/approve`,
            { expectedDispatchDate: date },
            `Confirmed. Dispatch on ${formatMytDate(date)}.`,
          );
        }}
      >
        <label htmlFor={`${id}-date`} className={FIELD_LABEL}>
          Dispatch date
        </label>
        <input
          id={`${id}-date`}
          type="date"
          required
          min={today}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-describedby={`${id}-date-hint`}
          className={INPUT}
        />
        <p id={`${id}-date-hint`} className="text-muted-foreground text-base">
          Please dispatch by {formatMytDate(order.requiredDispatchDate)}.
        </p>
        <div className="flex flex-col gap-2">
          <button type="submit" disabled={busy || date === ''} className={BUTTON_PRIMARY}>
            Confirm
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setMode('idle')}
            className={BUTTON_SECONDARY}
          >
            Back
          </button>
        </div>
      </form>
    );
  }

  if (mode === 'reject') {
    return (
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            `/api/approvals/${approval}/reject`,
            { reason: reason.trim() },
            'Rejected. BeliKongsi has been told.',
          );
        }}
      >
        <label htmlFor={`${id}-reason`} className={FIELD_LABEL}>
          Reason for rejecting (required)
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
        <div className="flex flex-col gap-2">
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
            onClick={() => setMode('idle')}
            className={BUTTON_SECONDARY}
          >
            Back
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => setMode('confirm')} className={BUTTON_PRIMARY}>
        Confirm
      </button>
      <button type="button" onClick={() => setMode('reject')} className={BUTTON_DANGER}>
        Reject
      </button>
    </div>
  );
}
