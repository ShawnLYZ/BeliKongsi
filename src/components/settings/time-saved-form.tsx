'use client';

import { useId, useState } from 'react';
import { toast } from 'sonner';
import type { ShopSettingsView } from '@/lib/views/directory';
import { ApiError, apiFetch } from '@/components/common/api-client';
import { BUTTON_PRIMARY, FIELD_ERROR, FIELD_LABEL, INPUT } from '@/components/common/controls';
import { readMinutes } from './minutes';

/** How long ordering took before BeliKongsi; the Savings screen turns it into an Estimated time saved. */
export function TimeSavedForm({
  shopId,
  settings,
}: {
  shopId: string;
  settings: ShopSettingsView;
}) {
  const id = useId();
  const [text, setText] = useState(
    settings.oldMinutesPerWeek === null ? '' : String(settings.oldMinutesPerWeek),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const read = readMinutes(text);
    if ('error' in read) {
      setError(read.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // The settings call needs the fulfilment choice too. Read the saved one now, not the one this
      // page was rendered with, so a choice saved above is never reverted.
      const current = await apiFetch<ShopSettingsView>(`/api/shops/${shopId}/settings`, {
        quiet: true,
      });
      if (current.defaultFulfilment === 'pickup' && !current.pickupPoint) {
        setError('Choose a pickup point or door delivery above and save it first.');
        return;
      }
      const fulfilment =
        current.defaultFulfilment === 'pickup' && current.pickupPoint
          ? { defaultFulfilment: 'pickup', pickupPointId: current.pickupPoint.id }
          : { defaultFulfilment: 'door' };
      await apiFetch(`/api/shops/${shopId}/settings`, {
        method: 'PATCH',
        body: { ...fulfilment, oldMinutesPerWeek: read.minutes },
        quiet: true,
      });
      toast.success('Saved.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="bg-card flex flex-col gap-2 rounded-2xl border p-4"
    >
      <h2 id={`${id}-title`} className="text-xl font-semibold">
        Time saved
      </h2>
      <label htmlFor={id} className={FIELD_LABEL}>
        How many minutes a week did ordering take you before BeliKongsi?
      </label>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
        className={`${INPUT} tabular-nums`}
      />
      <p id={`${id}-hint`} className="text-muted-foreground text-base">
        Your best guess is fine. Savings shows the time saved as an estimate.
      </p>
      {error ? (
        <p id={`${id}-error`} role="alert" className={FIELD_ERROR}>
          {error}
        </p>
      ) : null}
      <button type="button" className={BUTTON_PRIMARY} disabled={saving} onClick={save}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </section>
  );
}
