'use client';

import type { ReactNode } from 'react';
import { FIELD_ERROR, FIELD_LABEL } from './controls';

/** A ringgit amount field: "RM" in front, typed as text, read with `parseRinggitInput`. */
export function MoneyInput({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  badge,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (text: string) => void;
  error?: string | null;
  hint?: string;
  /** Shown beside the label, e.g. "sample price". */
  badge?: ReactNode;
  placeholder?: string;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className={FIELD_LABEL}>
          {label}
        </label>
        {badge}
      </div>
      <div className="relative">
        <span
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base"
        >
          RM
        </span>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className="border-input/60 bg-card focus-visible:border-ring focus-visible:ring-ring/60 aria-invalid:border-destructive min-h-12 w-full rounded-xl border-2 pr-3 pl-12 text-base tabular-nums outline-none focus-visible:ring-3"
        />
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-base">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className={FIELD_ERROR}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
