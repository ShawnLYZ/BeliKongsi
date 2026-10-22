'use client';

import { Minus, Plus } from 'lucide-react';

const STEP =
  'border-input/50 bg-card hover:bg-muted focus-visible:ring-ring/60 inline-flex size-12 shrink-0 items-center justify-center rounded-xl border-2 outline-none focus-visible:ring-3 disabled:opacity-50';

/** A whole-number quantity with − and + buttons. `null` is an empty box (nothing chosen yet). */
export function QuantityStepper({
  id,
  label,
  value,
  onChange,
  min = 1,
  max = 999,
  invalid = false,
  describedBy,
}: {
  id: string;
  /** What the number counts, e.g. "Quantity of Grade A eggs (trays)". */
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  invalid?: boolean;
  describedBy?: string;
}) {
  const set = (n: number) => onChange(Math.min(max, Math.max(min, n)));
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={STEP}
        aria-label={`Fewer: ${label}`}
        disabled={value !== null && value <= min}
        onClick={() => set((value ?? min + 1) - 1)}
      >
        <Minus aria-hidden="true" className="size-5" />
      </button>
      <input
        id={id}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        inputMode="numeric"
        pattern="[0-9]*"
        value={value ?? ''}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
          onChange(digits === '' ? null : Math.min(max, Number(digits)));
        }}
        className="border-input/60 bg-card focus-visible:border-ring focus-visible:ring-ring/60 aria-invalid:border-destructive h-12 w-16 rounded-xl border-2 text-center text-base tabular-nums outline-none focus-visible:ring-3"
      />
      <button
        type="button"
        className={STEP}
        aria-label={`More: ${label}`}
        disabled={value !== null && value >= max}
        onClick={() => set((value ?? min - 1) + 1)}
      >
        <Plus aria-hidden="true" className="size-5" />
      </button>
    </div>
  );
}
