'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { StaffBasketView } from '@/lib/views/baskets';
import type { StaffCatalogueItemView } from '@/lib/views/catalogue';
import { apiFetch, isDefiniteRejection } from '@/components/common/api-client';
import {
  BUTTON_PRIMARY,
  BUTTON_QUIET,
  FIELD_ERROR,
  FIELD_LABEL,
  INPUT,
} from '@/components/common/controls';
import { QuantityStepper } from '@/components/common/quantity-stepper';
import { formatUnits } from '@/lib/format';

// Staff see no money anywhere (R6): this screen shows names, pictures and quantities only.

const DEBOUNCE_MS = 250;
const MAX_RESULTS = 8;
export const ADDED_TOAST = "Added. Waiting for owner's approval.";

const STATUS_TEXT: Record<StaffBasketView['status'], string> = {
  draft: "Waiting for owner's approval",
  payment_pending: 'Approved by the owner',
  paid: 'Approved by the owner',
  skipped: 'Not ordered: the owner skipped this week',
  expired: 'Not ordered this week',
};

type Added = { key: string; text: string };

/** "Add to next basket": search by any name, choose a quantity, add. The owner approves it. */
export function StaffAdd({ basket }: { basket: StaffBasketView }) {
  const router = useRouter();
  const id = useId();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<StaffCatalogueItemView[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [picked, setPicked] = useState<StaffCatalogueItemView | null>(null);
  const [quantity, setQuantity] = useState<number | null>(1);
  const [busy, setBusy] = useState(false);
  const [laterWeek, setLaterWeek] = useState<Added[]>([]);
  /** One Idempotency-Key per product and quantity, kept across retries that may have been applied. */
  const key = useRef<{ inputs: string; value: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const q = query.trim();
        const data = await apiFetch<{ items: StaffCatalogueItemView[] }>(
          `/api/catalogue${q ? `?q=${encodeURIComponent(q.slice(0, 100))}` : ''}`,
          { quiet: true },
        );
        if (!cancelled) {
          setItems(data.items);
          setSearchError(null);
        }
      } catch {
        if (!cancelled) setSearchError('Could not search. Check your connection and try again.');
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  async function add() {
    if (!picked || quantity === null) return;
    const inputs = `${picked.productId}:${quantity}`;
    if (key.current?.inputs !== inputs) key.current = { inputs, value: crypto.randomUUID() };
    setBusy(true);
    try {
      const r = await apiFetch<{ basketId: string; week: string; routedToNextWeek: boolean }>(
        `/api/baskets/${basket.basketId}/lines`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': key.current.value },
          body: { productId: picked.productId, quantity },
        },
      );
      key.current = null;
      toast.success(ADDED_TOAST);
      if (r.routedToNextWeek) {
        setLaterWeek((prev) => [
          {
            key: `${r.week}-${picked.productId}-${prev.length}`,
            text: `${formatUnits(quantity, picked.unitName)} of ${picked.name}, in a later basket`,
          },
          ...prev,
        ]);
      }
      setPicked(null);
      setQuantity(1);
      router.refresh();
    } catch (e) {
      // Shown as a toast by apiFetch. Only a definite refusal (4xx) gets a fresh key; a network
      // error or 5xx may have been applied, so the retry reuses the same key.
      if (isDefiniteRejection(e)) key.current = null;
    } finally {
      setBusy(false);
    }
  }

  const shown = (items ?? []).slice(0, query.trim() ? MAX_RESULTS : items?.length);
  const mine = basket.lines.filter((l) => l.addedByMe);

  return (
    <div className="flex flex-col gap-6">
      {picked ? (
        <section
          aria-labelledby={`${id}-picked`}
          className="border-primary bg-card flex flex-col gap-3 rounded-2xl border-2 p-4"
        >
          <h2 id={`${id}-picked`} className="text-lg font-semibold">
            {picked.name}
          </h2>
          <p className="text-muted-foreground text-base">{picked.packDescription}</p>
          <div className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>How many {picked.unitName}s?</span>
            <QuantityStepper
              id={`${id}-qty`}
              label={`Quantity of ${picked.name} (${picked.unitName}s)`}
              value={quantity}
              onChange={setQuantity}
            />
          </div>
          <button
            type="button"
            className={`${BUTTON_PRIMARY} text-lg`}
            disabled={busy || quantity === null}
            onClick={add}
          >
            {busy ? 'Adding…' : 'Add to next basket'}
          </button>
          <button type="button" className={BUTTON_QUIET} onClick={() => setPicked(null)}>
            Choose something else
          </button>
        </section>
      ) : (
        <section className="flex flex-col gap-2">
          <label htmlFor={`${id}-q`} className={FIELD_LABEL}>
            What does the shop need?
          </label>
          <input
            id={`${id}-q`}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Any name: milk, susu, 炼奶, telur"
            autoComplete="off"
            className={INPUT}
          />
          {searchError ? <p className={FIELD_ERROR}>{searchError}</p> : null}
          {items === null && !searchError ? (
            <div aria-hidden="true" className="flex flex-col gap-2">
              <div className="bg-muted h-14 animate-pulse rounded-xl" />
              <div className="bg-muted h-14 animate-pulse rounded-xl" />
            </div>
          ) : null}
          {items !== null && shown.length === 0 ? (
            <p className="text-muted-foreground text-base">
              Nothing matches “{query.trim()}”. Try another name, such as “milk” or “telur”.
            </p>
          ) : null}
          {shown.length > 0 ? (
            <ul aria-label="Matching products" className="flex flex-col gap-2">
              {shown.map((item) => (
                <li key={item.productId}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(item);
                      setQuantity(1);
                    }}
                    className="border-input/40 bg-card hover:bg-muted focus-visible:ring-ring/60 flex min-h-12 w-full flex-col rounded-xl border-2 px-3 py-2 text-left outline-none focus-visible:ring-3"
                  >
                    <span className="text-base font-semibold">{item.name}</span>
                    <span className="text-muted-foreground text-base">{item.packDescription}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      )}

      <section aria-labelledby={`${id}-mine`} className="flex flex-col gap-2">
        <h2 id={`${id}-mine`} className="text-xl font-semibold">
          My recent additions
        </h2>
        {mine.length === 0 && laterWeek.length === 0 ? (
          <p className="text-muted-foreground text-base">
            Nothing yet. What you add shows here with its status, for example “1 carton of
            evaporated milk, waiting for owner&apos;s approval”.
          </p>
        ) : (
          <ul className="bg-card flex flex-col divide-y rounded-2xl border">
            {laterWeek.map((a) => (
              <li key={a.key} className="flex flex-col gap-1 p-4">
                <p className="text-base font-semibold">{a.text}</p>
                <p className="text-base">Waiting for owner&apos;s approval</p>
              </li>
            ))}
            {mine.map((l) => (
              <li key={l.lineId} className="flex flex-col gap-1 p-4">
                <p className="text-base font-semibold">{l.name}</p>
                <p className="text-base tabular-nums">
                  {formatUnits(l.quantity, l.unitName)} in this week&apos;s basket
                </p>
                <p className="text-base">
                  {l.waitingForOwner ? STATUS_TEXT.draft : STATUS_TEXT[basket.status]}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
