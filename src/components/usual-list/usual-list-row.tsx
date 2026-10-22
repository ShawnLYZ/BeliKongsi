'use client';

import { Trash2 } from 'lucide-react';
import { BUTTON_DANGER, FIELD_ERROR } from '@/components/common/controls';
import { MoneyInput } from '@/components/common/money-input';
import { QuantityStepper } from '@/components/common/quantity-stepper';
import { cn } from '@/lib/utils';

export interface EditItem {
  productId: string;
  name: string;
  packDescription: string;
  unitName: string;
  quantity: number | null;
  priceText: string;
  /** `usual`: the limit follows the usual price; `own`: `limitText`; `none`: no limit. */
  limitMode: 'usual' | 'own' | 'none';
  limitText: string;
}

export interface RowErrors {
  quantity?: string;
  price?: string;
  limit?: string;
}

const LIMIT_OPTIONS: { mode: EditItem['limitMode']; label: string }[] = [
  { mode: 'usual', label: 'Same as my usual price' },
  { mode: 'own', label: 'Set my own limit' },
  { mode: 'none', label: 'No limit' },
];

/** One item of the usual list with its quantity, usual price and price limit. */
export function UsualListRow({
  item,
  errors,
  onChange,
  onRemove,
}: {
  item: EditItem;
  errors: RowErrors | undefined;
  onChange: (item: EditItem) => void;
  onRemove: () => void;
}) {
  const k = `item-${item.productId}`;
  return (
    <li className="bg-card flex flex-col gap-3 rounded-2xl border p-4">
      <div>
        <h2 className="text-lg font-semibold">{item.name}</h2>
        <p className="text-muted-foreground text-base">{item.packDescription}</p>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-base font-medium">Quantity each week ({item.unitName}s)</span>
        <QuantityStepper
          id={`${k}-qty`}
          label={`Quantity of ${item.name}`}
          value={item.quantity}
          onChange={(quantity) => onChange({ ...item, quantity })}
          invalid={Boolean(errors?.quantity)}
          describedBy={errors?.quantity ? `${k}-qty-error` : undefined}
        />
        {errors?.quantity ? (
          <p id={`${k}-qty-error`} className={FIELD_ERROR}>
            {errors.quantity}
          </p>
        ) : null}
      </div>
      <MoneyInput
        id={`${k}-price`}
        label={`Usual price per ${item.unitName}, delivered`}
        value={item.priceText}
        onChange={(priceText) => onChange({ ...item, priceText })}
        error={errors?.price ?? null}
        hint="What you pay today without BeliKongsi. Used to work out your savings."
        placeholder="e.g. 165.00"
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-base font-medium">Price limit</legend>
        <p className="text-muted-foreground text-base">
          If a Kongsi would cost more than this per {item.unitName}, you don&apos;t buy it that
          week.
        </p>
        {LIMIT_OPTIONS.map((o) => {
          const checked = item.limitMode === o.mode;
          return (
            <label
              key={o.mode}
              className={cn(
                'has-focus-visible:ring-ring/60 flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border-2 px-3 has-focus-visible:ring-3',
                checked ? 'border-primary bg-primary/10' : 'border-input/40 bg-card',
              )}
            >
              <input
                type="radio"
                name={`${k}-limit`}
                value={o.mode}
                checked={checked}
                onChange={() =>
                  onChange({
                    ...item,
                    limitMode: o.mode,
                    limitText:
                      o.mode === 'own' && !item.limitText ? item.priceText : item.limitText,
                  })
                }
                className="accent-primary size-5 shrink-0"
              />
              <span className="text-base">{o.label}</span>
            </label>
          );
        })}
        {item.limitMode === 'own' ? (
          <MoneyInput
            id={`${k}-limit`}
            label={`My price limit per ${item.unitName}`}
            value={item.limitText}
            onChange={(limitText) => onChange({ ...item, limitText })}
            error={errors?.limit ?? null}
            placeholder="e.g. 160.00"
          />
        ) : null}
        {item.limitMode === 'none' ? (
          <p className="text-base">You buy at any Kongsi price, up to the starting price.</p>
        ) : null}
      </fieldset>
      <button type="button" className={cn(BUTTON_DANGER, 'self-start')} onClick={onRemove}>
        <Trash2 aria-hidden="true" className="size-5" />
        Remove<span className="sr-only"> {item.name}</span>
      </button>
    </li>
  );
}
