'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { PaymentSummary } from '@/lib/views/payments';
import { apiFetch, isDefiniteRejection } from '@/components/common/api-client';
import { BUTTON_PRIMARY } from '@/components/common/controls';
import { usePageShow } from '@/components/common/use-page-show';
import { cn } from '@/lib/utils';

/**
 * "Approve & pay": approves the basket and opens the simulated checkout, or the receipt when the
 * balance covers everything. A second tap carries the same Idempotency-Key, so it gets the same
 * payment back (review focus 1).
 */
export function ApprovePayButton({
  basketId,
  label = 'Approve & pay',
  className,
}: {
  basketId: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const key = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Back from the checkout (bfcache): the button works again. The key stays: the basket's pending
  // payment is returned either way.
  usePageShow(useCallback(() => setBusy(false), []));

  async function approve() {
    key.current ??= crypto.randomUUID();
    setBusy(true);
    try {
      const payment = await apiFetch<PaymentSummary>(`/api/baskets/${basketId}/approve`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key.current },
      });
      if (payment.checkoutUrl) {
        router.push(payment.checkoutUrl);
      } else {
        toast.success('Paid from your BeliKongsi balance.');
        router.push(`/owner/receipts/${payment.paymentId}`);
      }
    } catch (e) {
      // The error is already shown as a toast. Only a definite refusal (4xx) gets a fresh key; a
      // network error or 5xx may have been applied, so the retry reuses the same key.
      if (isDefiniteRejection(e)) key.current = null;
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      className={cn(BUTTON_PRIMARY, 'w-full text-lg', className)}
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={approve}
    >
      {busy ? 'Opening checkout…' : label}
    </button>
  );
}
