'use client';

import { useId, useRef } from 'react';
import { Info, Plus } from 'lucide-react';
import {
  BUTTON_DANGER,
  BUTTON_SECONDARY,
  FIELD_ERROR,
  FIELD_LABEL,
  INPUT,
} from '@/components/common/controls';
import { cn } from '@/lib/utils';
import { MAX_TIERS, type LadderCheck, type TierRow } from './product-draft';

/**
 * The Kongsi price tiers of one product, checked live with the engine's rules: each message sits
 * next to the row it is about, and messages about the whole ladder sit above it. A row's messages
 * show once something is typed in it, or once `showAll` is set (after a save was tried).
 */
export function TierEditor({
  rows,
  onChange,
  check,
  unitName,
  notice,
  showAll = false,
  label = 'Kongsi price tiers',
}: {
  rows: TierRow[];
  onChange: (rows: TierRow[]) => void;
  check: LadderCheck;
  unitName: string;
  /** Shown above the rows, e.g. when the change reaches owners. */
  notice?: string | null;
  showAll?: boolean;
  label?: string;
}) {
  const id = useId();
  const nextKey = useRef(rows.length);
  const update = (key: string, part: Partial<TierRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...part } : r)));

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-lg font-semibold">{label}</legend>
      <p className="text-muted-foreground text-base">
        Up to {MAX_TIERS} tiers. Each minimum is more than the one before, each price is lower, and
        every price is below the buy-alone price.
      </p>
      {notice ? (
        <p className="bg-primary/10 flex items-start gap-2 rounded-xl p-3 text-base font-medium">
          <Info aria-hidden="true" className="text-primary mt-0.5 size-5 shrink-0" />
          {notice}
        </p>
      ) : null}
      {check.ladder.length > 0 ? (
        <ul id={`${id}-ladder`} className="flex flex-col gap-1">
          {check.ladder.map((m) => (
            <li key={m} className={FIELD_ERROR}>
              {m}
            </li>
          ))}
        </ul>
      ) : null}
      <ol className="flex flex-col gap-3">
        {rows.map((row, i) => {
          const n = i + 1;
          const errors =
            showAll || row.minText !== '' || row.priceText !== '' ? (check.rows[i] ?? []) : [];
          const errId = `${id}-${row.key}-errors`;
          const invalid = errors.length > 0;
          return (
            <li
              key={row.key}
              className={cn(
                'flex flex-col gap-2 rounded-xl border-2 p-3',
                invalid ? 'border-destructive/60 bg-destructive/5' : 'border-input/30',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold">Tier {n}</h3>
                {rows.length > 1 ? (
                  <button
                    type="button"
                    className={cn(BUTTON_DANGER, 'px-3')}
                    onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                  >
                    Remove<span className="sr-only"> tier {n}</span>
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${id}-${row.key}-min`} className={FIELD_LABEL}>
                    Tier {n} minimum ({unitName}s)
                  </label>
                  <input
                    id={`${id}-${row.key}-min`}
                    inputMode="numeric"
                    autoComplete="off"
                    value={row.minText}
                    onChange={(e) => update(row.key, { minText: e.target.value })}
                    aria-invalid={invalid || undefined}
                    aria-describedby={invalid ? errId : undefined}
                    className={cn(INPUT, 'tabular-nums')}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${id}-${row.key}-price`} className={FIELD_LABEL}>
                    Tier {n} price per {unitName}
                  </label>
                  <div className="relative">
                    <span
                      aria-hidden="true"
                      className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base"
                    >
                      RM
                    </span>
                    <input
                      id={`${id}-${row.key}-price`}
                      inputMode="decimal"
                      autoComplete="off"
                      value={row.priceText}
                      onChange={(e) => update(row.key, { priceText: e.target.value })}
                      aria-invalid={invalid || undefined}
                      aria-describedby={invalid ? errId : undefined}
                      className={cn(INPUT, 'pl-11 tabular-nums')}
                    />
                  </div>
                </div>
              </div>
              {invalid ? (
                <ul id={errId} className="flex flex-col gap-1">
                  {errors.map((m) => (
                    <li key={m} className={FIELD_ERROR}>
                      {m}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
      {rows.length < MAX_TIERS ? (
        <button
          type="button"
          className={BUTTON_SECONDARY}
          onClick={() => {
            nextKey.current += 1;
            onChange([...rows, { key: `new-${nextKey.current}`, minText: '', priceText: '' }]);
          }}
        >
          <Plus aria-hidden="true" className="size-5" />
          Add a tier
        </button>
      ) : null}
    </fieldset>
  );
}
