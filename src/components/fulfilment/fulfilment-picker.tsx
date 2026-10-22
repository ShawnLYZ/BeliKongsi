'use client';

import { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import type { PickupPointView, ShopSettingsView } from '@/lib/views/directory';
import { ApiError, apiFetch } from '@/components/common/api-client';
import { BUTTON_PRIMARY, FIELD_ERROR } from '@/components/common/controls';
import { Money } from '@/components/common/money';
import { cn } from '@/lib/utils';

// Lazy and browser-only: the Maps script loads only when this picker is on screen (PRD §18).
const PickupMap = dynamic(() => import('@/components/maps/pickup-map'), {
  ssr: false,
  loading: () => <div aria-hidden="true" className="bg-muted h-64 animate-pulse rounded-2xl" />,
});

type Choice = { type: 'pickup'; pickupPointId: string } | { type: 'door' } | null;

const TOO_FAR =
  "Your shop is more than 20 km from the nearest pickup point, so door delivery isn't available. Choose a pickup point instead.";

function initialChoice(settings: ShopSettingsView): Choice {
  if (settings.defaultFulfilment === 'door' && settings.door.available) return { type: 'door' };
  return settings.pickupPoint ? { type: 'pickup', pickupPointId: settings.pickupPoint.id } : null;
}

function km(distance: number | null): string | null {
  if (distance === null) return null;
  return `${distance < 10 ? distance.toFixed(1) : Math.round(distance).toLocaleString('en')} km away`;
}

const OPTION =
  'has-focus-visible:ring-ring/60 flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border-2 p-3 has-focus-visible:ring-3';

/**
 * The default way a shop gets its goods: a pickup point (map and distance-sorted list) or door
 * delivery with its fee. Saves through PATCH /api/shops/{shopId}/settings.
 */
export function FulfilmentPicker({
  shopId,
  settings,
  points,
  submitLabel,
  onSaved,
}: {
  shopId: string;
  settings: ShopSettingsView;
  points: PickupPointView[];
  submitLabel: string;
  onSaved?: (settings: ShopSettingsView) => void;
}) {
  const [choice, setChoice] = useState<Choice>(() => initialChoice(settings));
  const [mapFailed, setMapFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onMapFail = useCallback(() => setMapFailed(true), []);
  const { door } = settings;
  const pickupId = choice?.type === 'pickup' ? choice.pickupPointId : null;

  function choosePickup(id: string) {
    setChoice({ type: 'pickup', pickupPointId: id });
    setError(null);
  }

  async function save() {
    if (!choice) {
      setError('Choose a pickup point or door delivery.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await apiFetch<ShopSettingsView>(`/api/shops/${shopId}/settings`, {
        method: 'PATCH',
        body:
          choice.type === 'door'
            ? { defaultFulfilment: 'door' }
            : { defaultFulfilment: 'pickup', pickupPointId: choice.pickupPointId },
        quiet: true,
      });
      toast.success('Saved.');
      onSaved?.(saved);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-lg font-semibold">Collect from a pickup point</legend>
        <p className="text-base">
          Pickup points are open 10 am–7 pm every day. The nearest is first. Tap a pin on the map or
          choose from the list.
        </p>
        {mapFailed ? (
          <p className="text-muted-foreground text-base">
            The map isn&apos;t available right now. Choose from the list.
          </p>
        ) : (
          <PickupMap
            points={points}
            selectedId={pickupId}
            onSelect={choosePickup}
            onFail={onMapFail}
          />
        )}
        <div className="flex flex-col gap-2">
          {points.map((p) => {
            const checked = pickupId === p.id;
            const distance = km(p.distanceKm);
            return (
              <label
                key={p.id}
                className={cn(
                  OPTION,
                  checked ? 'border-primary bg-primary/10' : 'bg-card border-input/40',
                )}
              >
                <input
                  type="radio"
                  name="fulfilment"
                  value={`pickup:${p.id}`}
                  checked={checked}
                  onChange={() => choosePickup(p.id)}
                  className="accent-primary mt-0.5 size-5 shrink-0"
                />
                <span className="flex flex-col">
                  <span className="text-base font-semibold">{p.name}</span>
                  <span className="text-muted-foreground text-base">
                    {p.address}
                    {distance ? <span className="tabular-nums"> · {distance}</span> : null}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-lg font-semibold">Or get it delivered</legend>
        <label
          className={cn(
            OPTION,
            !door.available && 'cursor-not-allowed opacity-80',
            choice?.type === 'door' ? 'border-primary bg-primary/10' : 'bg-card border-input/40',
          )}
        >
          <input
            type="radio"
            name="fulfilment"
            value="door"
            checked={choice?.type === 'door'}
            disabled={!door.available}
            aria-describedby="door-detail"
            onChange={() => {
              setChoice({ type: 'door' });
              setError(null);
            }}
            className="accent-primary mt-0.5 size-5 shrink-0"
          />
          <span className="flex flex-col">
            <span className="text-base font-semibold">Delivery to your door</span>
            <span id="door-detail" className="text-base">
              {door.available && door.feeSen !== null ? (
                <>
                  Delivery fee <Money sen={door.feeSen} className="font-semibold" /> per delivery,
                  from {door.nearestPickupPoint.name} (
                  <span className="tabular-nums">{door.distanceKm.toFixed(1)} km</span>). Fee quoted
                  by our logistics partner (Simulated).
                </>
              ) : (
                TOO_FAR
              )}
            </span>
          </span>
        </label>
      </fieldset>

      {error ? (
        <p role="alert" className={FIELD_ERROR}>
          {error}
        </p>
      ) : null}
      <button type="button" className={BUTTON_PRIMARY} disabled={saving} onClick={save}>
        {saving ? 'Saving…' : submitLabel}
      </button>
    </div>
  );
}
