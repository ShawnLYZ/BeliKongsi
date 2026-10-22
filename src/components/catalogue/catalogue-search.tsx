'use client';

import { useEffect, useId, useState } from 'react';
import { Plus } from 'lucide-react';
import type { CatalogueItemView } from '@/lib/views/catalogue';
import { apiFetch } from '@/components/common/api-client';
import { FIELD_ERROR, FIELD_LABEL, INPUT } from '@/components/common/controls';
import { Money } from '@/components/common/money';

const DEBOUNCE_MS = 250;
const MAX_RESULTS = 9;

/**
 * Search the catalogue by any name ("炼奶", "minyak", "cups") and pick a product. An empty box
 * lists every product, so this doubles as the pick-from-catalogue form (story 23).
 */
export function CatalogueSearch({
  label = 'Search the catalogue',
  initialQuery = '',
  excludeIds = [],
  onPick,
}: {
  label?: string;
  initialQuery?: string;
  /** Products already on the list are not offered again. */
  excludeIds?: readonly string[];
  onPick: (item: CatalogueItemView) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState(initialQuery);
  const [items, setItems] = useState<CatalogueItemView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const q = query.trim();
        const data = await apiFetch<{ items: CatalogueItemView[] }>(
          `/api/catalogue${q ? `?q=${encodeURIComponent(q.slice(0, 100))}` : ''}`,
          { quiet: true },
        );
        if (!cancelled) {
          setItems(data.items);
          setError(null);
        }
      } catch {
        if (!cancelled)
          setError('Could not search the catalogue. Check your connection and try again.');
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const available = (items ?? []).filter((i) => !excludeIds.includes(i.productId));
  // An empty box lists every product (the pick-from-catalogue form); typed searches are capped.
  const shown = query.trim() ? available.slice(0, MAX_RESULTS) : available;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-q`} className={FIELD_LABEL}>
        {label}
      </label>
      <input
        id={`${id}-q`}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="e.g. condensed milk, minyak, cawan"
        autoComplete="off"
        className={INPUT}
      />
      {error ? <p className={FIELD_ERROR}>{error}</p> : null}
      {items === null && !error ? (
        <div aria-hidden="true" className="flex flex-col gap-2">
          <div className="bg-muted h-14 animate-pulse rounded-xl" />
          <div className="bg-muted h-14 animate-pulse rounded-xl" />
        </div>
      ) : null}
      {items !== null && shown.length === 0 ? (
        <p className="text-muted-foreground text-base">
          {items.length > 0
            ? 'Everything that matches is already on your list.'
            : `No products match “${query.trim()}”. Try another name, such as “milk” or “telur”.`}
        </p>
      ) : null}
      {shown.length > 0 ? (
        <ul aria-label="Matching products" className="flex flex-col gap-2">
          {shown.map((item) => (
            <li key={item.productId}>
              <button
                type="button"
                onClick={() => onPick(item)}
                className="border-input/40 bg-card hover:bg-muted focus-visible:ring-ring/60 flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border-2 px-3 py-2 text-left outline-none focus-visible:ring-3"
              >
                <span className="flex flex-col">
                  <span className="text-base font-semibold">{item.name}</span>
                  <span className="text-muted-foreground text-base">
                    {item.packDescription} · <Money sen={item.buyAlonePriceSen} /> bought alone
                  </span>
                </span>
                <span className="text-primary flex shrink-0 items-center gap-1 text-base font-semibold">
                  <Plus aria-hidden="true" className="size-5" />
                  Add
                  <span className="sr-only"> {item.name}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
