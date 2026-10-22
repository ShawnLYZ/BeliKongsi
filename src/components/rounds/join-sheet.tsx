'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import type { ShopSettingsView } from '@/lib/views/directory';
import type { PaymentSummary } from '@/lib/views/payments';
import { ApiError, apiFetch, isDefiniteRejection } from '@/components/common/api-client';
import { BottomSheet } from '@/components/common/bottom-sheet';
import { BUTTON_PRIMARY, FIELD_ERROR, FIELD_LABEL } from '@/components/common/controls';
import { Money } from '@/components/common/money';
import { MoneyInput } from '@/components/common/money-input';
import { QuantityStepper } from '@/components/common/quantity-stepper';
import { usePageShow } from '@/components/common/use-page-show';
import { formatUnits } from '@/lib/format';
import { parseRinggitInput } from '@/lib/money-input';
import { cn } from '@/lib/utils';

const DEBOUNCE_MS = 250;
const OPTION =
  'has-focus-visible:ring-ring/60 flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border-2 p-3 has-focus-visible:ring-3';

/** The parts of a round quote (GET /api/rounds/{id}/quote) this sheet shows. */
interface Quote {
  starting: { allInSen: number };
  startingLineSen: number;
  withYou: { amounts: { allInSen: number } | null; unitsToNextTier: number | null };
  limit: null | {
    priceLimitSen: number;
    belowStarting: boolean;
    lowestTierMeetingLimit: { minQuantity: number } | null;
  };
  explanation: string[];
  deliveryFeeSen: number | null;
  destinationLabel: string;
}

type Fulfilment = 'pickup' | 'door';

/** The PRD §6.4 warning when the price limit is below the starting price. */
function limitWarning(q: Quote, unitName: string): string | null {
  if (!q.limit?.belowStarting) return null;
  return q.limit.lowestTierMeetingLimit
    ? `You'll only be in if the round reaches ${q.limit.lowestTierMeetingLimit.minQuantity}+ ${unitName}s.`
    : 'No price tier is within your limit, so this line would be refunded at cut-off.';
}

/** "Join": quantity, price limit and fulfilment, quoted live, then paid at the simulated checkout. */
export function JoinSheet({
  roundId,
  productName,
  unitName,
  settings,
}: {
  roundId: string;
  productName: string;
  unitName: string;
  settings: ShopSettingsView;
}) {
  const router = useRouter();
  const id = useId();
  /** One Idempotency-Key per set of inputs, kept across retries that may have reached the server. */
  const key = useRef<{ inputs: string; value: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState<number | null>(1);
  const [limitText, setLimitText] = useState('');
  const [fulfilment, setFulfilment] = useState<Fulfilment>(
    settings.defaultFulfilment === 'door' && settings.door.available ? 'door' : 'pickup',
  );
  /** The latest quote and the inputs it was made for. */
  const [quote, setQuote] = useState<{ inputs: string; q: Quote } | null>(null);
  const [quoteError, setQuoteError] = useState<{ inputs: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Back from the checkout (bfcache): the button works again, for a new join with a new key.
  usePageShow(
    useCallback(() => {
      setBusy(false);
      key.current = null;
    }, []),
  );

  const point = settings.pickupPoint ?? settings.door.nearestPickupPoint;
  const limit = parseRinggitInput(limitText);
  const limitError =
    limit === undefined ? 'Enter an amount such as 150.00, or leave it empty.' : null;
  const destination = fulfilment === 'door' ? 'door' : `pickup:${point.id}`;
  const ready = open && quantity !== null && quantity >= 1 && limit !== undefined;
  const inputs = `${quantity}|${limit ?? ''}|${destination}`;
  // A quote for other inputs is stale: hidden, and "Join and pay" waits for the fresh one.
  const current = quote && quote.inputs === inputs ? quote.q : null;
  const currentError = quoteError && quoteError.inputs === inputs ? quoteError.message : null;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ quantity: String(quantity), destination });
      if (limit) params.set('priceLimitSen', String(limit));
      try {
        const q = await apiFetch<Quote>(`/api/rounds/${roundId}/quote?${params}`, { quiet: true });
        if (!cancelled) {
          setQuote({ inputs, q });
          setQuoteError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setQuote(null);
          setQuoteError({
            inputs,
            message: e instanceof ApiError ? e.message : 'Could not get a price. Try again.',
          });
        }
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, roundId, quantity, destination, limit, inputs]);

  async function join() {
    if (!ready || !current || quantity === null || limit === undefined) return;
    if (key.current?.inputs !== inputs) key.current = { inputs, value: crypto.randomUUID() };
    setBusy(true);
    try {
      const payment = await apiFetch<PaymentSummary>(`/api/rounds/${roundId}/participations`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key.current.value },
        body: {
          quantity,
          priceLimitSen: limit,
          destination:
            fulfilment === 'door'
              ? { type: 'door' }
              : { type: 'pickup_point', pickupPointId: point.id },
        },
      });
      if (payment.checkoutUrl) {
        router.push(payment.checkoutUrl);
      } else {
        toast.success('Paid from your BeliKongsi balance.');
        router.push(`/owner/receipts/${payment.paymentId}`);
      }
    } catch (e) {
      // Only a definite refusal starts over; a lost answer must be retried with the same key.
      if (isDefiniteRejection(e)) key.current = null;
      setBusy(false);
    }
  }

  const warning = current ? limitWarning(current, unitName) : null;

  return (
    <>
      <button
        type="button"
        className={`${BUTTON_PRIMARY} w-full text-lg`}
        onClick={() => setOpen(true)}
      >
        Join
      </button>
      <BottomSheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
        }}
        title="Join this Kongsi"
        description={productName}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-qty`} className={FIELD_LABEL}>
            Quantity ({unitName}s)
          </label>
          <QuantityStepper
            id={`${id}-qty`}
            label={`Quantity of ${productName} (${unitName}s)`}
            value={quantity}
            onChange={setQuantity}
          />
        </div>

        <MoneyInput
          id={`${id}-limit`}
          label="Price limit (optional)"
          value={limitText}
          onChange={setLimitText}
          error={limitError}
          hint={`The most you'll pay a ${unitName}, all-in. Leave it empty for no limit.`}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-base font-semibold">How you get your goods</legend>
          <label
            className={cn(
              OPTION,
              fulfilment === 'pickup' ? 'border-primary bg-primary/10' : 'bg-card border-input/40',
            )}
          >
            <input
              type="radio"
              name={`${id}-fulfilment`}
              checked={fulfilment === 'pickup'}
              onChange={() => setFulfilment('pickup')}
              className="accent-primary mt-0.5 size-5 shrink-0"
            />
            <span className="text-base font-semibold">Collect from {point.name}</span>
          </label>
          <label
            className={cn(
              OPTION,
              !settings.door.available && 'cursor-not-allowed opacity-80',
              fulfilment === 'door' ? 'border-primary bg-primary/10' : 'bg-card border-input/40',
            )}
          >
            <input
              type="radio"
              name={`${id}-fulfilment`}
              checked={fulfilment === 'door'}
              disabled={!settings.door.available}
              onChange={() => setFulfilment('door')}
              className="accent-primary mt-0.5 size-5 shrink-0"
            />
            <span className="flex flex-col">
              <span className="text-base font-semibold">Delivery to your door</span>
              {!settings.door.available ? (
                <span className="text-muted-foreground text-base">
                  Not available this far away.
                </span>
              ) : null}
            </span>
          </label>
        </fieldset>

        <section aria-live="polite" className="bg-muted flex flex-col gap-2 rounded-xl p-3">
          {currentError ? (
            <p className={FIELD_ERROR}>{currentError}</p>
          ) : !ready ? (
            <p className="text-muted-foreground text-base">Choose a quantity to see your price.</p>
          ) : !current ? (
            <p className="text-muted-foreground text-base">Getting your price…</p>
          ) : (
            <>
              <p className="text-base">
                You pay now <Money sen={current.startingLineSen} className="text-lg font-bold" /> (
                {formatUnits(quantity ?? 0, unitName)} at <Money sen={current.starting.allInSen} />,
                the starting price)
              </p>
              {fulfilment === 'door' && current.deliveryFeeSen !== null ? (
                <p className="text-base">
                  Plus one delivery fee of <Money sen={current.deliveryFeeSen} /> if you have no
                  other paid door delivery that date. The checkout shows the exact amount.
                </p>
              ) : null}
              <p className="text-base">
                {current.withYou.amounts ? (
                  <>
                    Estimated after cut-off: <Money sen={current.withYou.amounts.allInSen} /> a{' '}
                    {unitName}. You get the difference back.
                  </>
                ) : (
                  `Estimated: the round needs ${formatUnits(current.withYou.unitsToNextTier ?? 0, unitName)} more to reach its minimum order.`
                )}
              </p>
            </>
          )}
        </section>

        {warning ? (
          <p
            role="alert"
            className="border-accent bg-accent/15 flex items-start gap-2 rounded-xl border-2 p-3 text-base font-semibold"
          >
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            {warning}
          </p>
        ) : null}

        <button
          type="button"
          className={BUTTON_PRIMARY}
          disabled={!ready || !current || busy}
          onClick={join}
        >
          {busy ? 'Opening checkout…' : 'Join and pay'}
        </button>
      </BottomSheet>
    </>
  );
}
