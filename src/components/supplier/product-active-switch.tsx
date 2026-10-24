'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { apiFetch } from '@/components/common/api-client';
import { FIELD_LABEL } from '@/components/common/controls';
import { cn } from '@/lib/utils';

/**
 * Whether the product is on sale. Switching it off lets the open round finish and opens no new
 * one; switching it back on means rounds open again.
 */
export function ProductActiveSwitch({
  supplierId,
  productId,
  active,
}: {
  supplierId: string;
  productId: string;
  active: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await apiFetch(`/api/suppliers/${supplierId}/products/${productId}`, {
        method: 'PATCH',
        body: { active: !active },
      });
      toast.success(
        active
          ? 'Switched off. The open round still finishes; no new round opens.'
          : 'Switched on. Shops can order it again from the next round.',
      );
      router.refresh();
    } catch {
      // apiFetch has already shown the error.
    }
    setBusy(false);
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="bg-card flex flex-col gap-3 rounded-2xl border p-4"
    >
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        On sale
      </h2>
      <div className="flex items-center justify-between gap-3">
        <span id={`${id}-switch`} className={FIELD_LABEL}>
          Selling this product is {active ? 'on' : 'off'}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={active}
          aria-labelledby={`${id}-switch`}
          aria-describedby={`${id}-hint`}
          disabled={busy}
          onClick={toggle}
          className={cn(
            'focus-visible:ring-ring/60 inline-flex h-12 w-20 shrink-0 items-center rounded-full border-2 px-1 outline-none focus-visible:ring-3 disabled:opacity-60',
            active ? 'bg-primary border-primary justify-end' : 'bg-muted border-input/60',
          )}
        >
          <span aria-hidden="true" className="bg-card size-8 rounded-full border shadow-sm" />
        </button>
      </div>
      <p id={`${id}-hint`} className="text-muted-foreground text-base">
        Switching it off lets the open round finish and opens no new round.
      </p>
    </section>
  );
}
