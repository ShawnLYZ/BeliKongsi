'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PickupPointView, ShopSettingsView } from '@/lib/views/directory';
import { apiFetch } from '@/components/common/api-client';
import { Money } from '@/components/common/money';
import { cn } from '@/lib/utils';

const OPTION =
  'has-focus-visible:ring-ring/60 flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border-2 p-3 has-focus-visible:ring-3';

/**
 * This week's basket only: collect from the pickup point, or door delivery with its fee. The shop's
 * default stays as it is in Settings.
 */
export function FulfilmentSwitch({
  basketId,
  fulfilment,
  pickupPoint,
  settings,
  editable,
}: {
  basketId: string;
  fulfilment: 'pickup' | 'door';
  pickupPoint: PickupPointView | null;
  settings: ShopSettingsView;
  editable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const point = pickupPoint ?? settings.pickupPoint ?? settings.door.nearestPickupPoint;
  const { door } = settings;

  async function choose(next: 'pickup' | 'door') {
    if (next === fulfilment || busy) return;
    setBusy(true);
    try {
      await apiFetch(`/api/baskets/${basketId}/fulfilment`, {
        method: 'PATCH',
        body:
          next === 'door'
            ? { fulfilment: 'door' }
            : { fulfilment: 'pickup', pickupPointId: point.id },
      });
      router.refresh();
    } catch {
      // Shown as a toast by apiFetch.
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset
      className="flex flex-col gap-2"
      disabled={!editable || busy}
      aria-busy={busy || undefined}
    >
      <legend className="mb-2 text-lg font-semibold">How you get your goods</legend>
      <label
        className={cn(
          OPTION,
          fulfilment === 'pickup' ? 'border-primary bg-primary/10' : 'bg-card border-input/40',
        )}
      >
        <input
          type="radio"
          name="basket-fulfilment"
          checked={fulfilment === 'pickup'}
          onChange={() => choose('pickup')}
          className="accent-primary mt-0.5 size-5 shrink-0"
        />
        <span className="flex flex-col">
          <span className="text-base font-semibold">Collect from {point.name}</span>
          <span className="text-muted-foreground text-base">Open 10 am–7 pm. No delivery fee.</span>
        </span>
      </label>
      <label
        className={cn(
          OPTION,
          !door.available && 'cursor-not-allowed opacity-80',
          fulfilment === 'door' ? 'border-primary bg-primary/10' : 'bg-card border-input/40',
        )}
      >
        <input
          type="radio"
          name="basket-fulfilment"
          checked={fulfilment === 'door'}
          disabled={!door.available}
          onChange={() => choose('door')}
          className="accent-primary mt-0.5 size-5 shrink-0"
        />
        <span className="flex flex-col">
          <span className="text-base font-semibold">Delivery to your door</span>
          <span className="text-muted-foreground text-base">
            {door.available && door.feeSen !== null ? (
              <>
                Delivery fee <Money sen={door.feeSen} /> per delivery date (Simulated logistics
                partner).
              </>
            ) : (
              "Your shop is more than 20 km from a pickup point, so door delivery isn't available."
            )}
          </span>
        </span>
      </label>
    </fieldset>
  );
}
