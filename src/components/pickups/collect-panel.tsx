'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Eye, EyeOff } from 'lucide-react';
import type { PickupView } from '@/lib/views/pickups';
import { ApiError, apiFetch } from '@/components/common/api-client';
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FIELD_ERROR,
  FIELD_LABEL,
  INPUT,
} from '@/components/common/controls';
import { cn } from '@/lib/utils';
import { PickupCode } from './pickup-code';
import { canHandOver, isHandedOver } from './steps';

function Confirmation({ door }: { door: boolean }) {
  return (
    <section
      role="status"
      className="border-primary bg-primary/10 flex items-start gap-3 rounded-2xl border-2 p-5"
    >
      <CheckCircle2 aria-hidden="true" className="text-primary size-8 shrink-0" />
      <p className="text-lg font-semibold">{door ? 'Delivered.' : 'Collected.'}</p>
    </section>
  );
}

/**
 * Staff hand a pickup over at the counter (story 76): "Show code" reveals the code, the code is
 * typed in, and "Collected" (or "Delivered" at the door) confirms it through
 * POST /api/pickups/{pickupId}/collect. The delivery check follows in M8.
 */
export function CollectPanel({ pickup }: { pickup: PickupView }) {
  const id = useId();
  const router = useRouter();
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // How many parts there were when this one was handed over; the confirmation shows until the page catches up.
  const [doneAt, setDoneAt] = useState<number | null>(null);
  const door = pickup.destinationType === 'door';

  const justHandedOver = doneAt !== null && pickup.collections.length <= doneAt;
  if (justHandedOver || isHandedOver(pickup)) return <Confirmation door={door} />;

  if (!canHandOver(pickup) || !pickup.pickupId || !pickup.code) {
    return (
      <p className="bg-muted rounded-2xl p-4 text-base">
        {pickup.collections.length > 0
          ? 'You have taken part of these goods. The rest is still on its way. We will send a message when you can collect it with the same code.'
          : door
            ? 'You can confirm the delivery once the goods are out for delivery.'
            : 'You can collect once the goods are ready for pickup. We will send a message when they are.'}
      </p>
    );
  }
  const pickupId = pickup.pickupId;
  const pickupCode = pickup.code;

  async function collect() {
    if (code.replace(/\s+/g, '') === '') {
      setCodeError('Type the 6-digit pickup code.');
      return;
    }
    setBusy(true);
    setCodeError(null);
    setError(null);
    try {
      await apiFetch(`/api/pickups/${pickupId}/collect`, {
        method: 'POST',
        body: { code },
        quiet: true,
      });
      setDoneAt(pickup.collections.length);
      setCode('');
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'WRONG_CODE') setCodeError(e.message);
      else if (e instanceof ApiError && e.code === 'NOT_READY') {
        // The pickup moved on (or back) since this page loaded: say why and show where it is now.
        setError(e.message);
        router.refresh();
      } else
        setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
      <h2 id={`${id}-title`} className="text-xl font-bold">
        {pickup.status === 'partly_ready'
          ? door
            ? 'Confirm the part that arrived'
            : 'Collect the part that is ready'
          : door
            ? 'Confirm the delivery'
            : 'Collect your goods'}
      </h2>
      <button
        type="button"
        aria-expanded={showCode}
        aria-controls={`${id}-code`}
        onClick={() => setShowCode((s) => !s)}
        className={BUTTON_SECONDARY}
      >
        {showCode ? (
          <EyeOff aria-hidden="true" className="size-5" />
        ) : (
          <Eye aria-hidden="true" className="size-5" />
        )}
        {showCode ? 'Hide code' : 'Show code'}
      </button>
      <div id={`${id}-code`} hidden={!showCode} className="bg-card rounded-2xl border p-5">
        <PickupCode code={pickupCode} />
      </div>
      <form
        noValidate
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void collect();
        }}
      >
        <label htmlFor={`${id}-input`} className={FIELD_LABEL}>
          Pickup code
        </label>
        <input
          id={`${id}-input`}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setCodeError(null);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={20}
          aria-invalid={codeError ? true : undefined}
          aria-describedby={codeError ? `${id}-error` : `${id}-hint`}
          className={cn(INPUT, 'text-xl tracking-wider tabular-nums')}
        />
        {codeError ? (
          <p id={`${id}-error`} className={FIELD_ERROR}>
            {codeError}
          </p>
        ) : (
          <p id={`${id}-hint`} className="text-muted-foreground text-base">
            The 6 digits, for example 482 913.
          </p>
        )}
        {error ? (
          <p role="alert" className={FIELD_ERROR}>
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy} className={cn(BUTTON_PRIMARY, 'mt-2 w-full')}>
          {busy ? 'Checking the code…' : door ? 'Delivered' : 'Collected'}
        </button>
      </form>
    </section>
  );
}
