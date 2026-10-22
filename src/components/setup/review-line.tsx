'use client';

import { useState } from 'react';
import { AlertTriangle, SearchX, Trash2 } from 'lucide-react';
import { CatalogueSearch } from '@/components/catalogue/catalogue-search';
import { BUTTON_DANGER, BUTTON_SECONDARY, FIELD_ERROR } from '@/components/common/controls';
import { MoneyInput } from '@/components/common/money-input';
import { QuantityStepper } from '@/components/common/quantity-stepper';
import { cn } from '@/lib/utils';
import { chooseProduct, type DraftLine, type LineErrors } from './review-lines';

export function SamplePriceBadge() {
  return (
    <span className="bg-muted text-foreground rounded-full px-2 py-0.5 text-base font-medium">
      sample price
    </span>
  );
}

/** One line of the review list: what was pasted, what it matched, quantity and usual price. */
export function ReviewLine({
  line,
  errors,
  showErrors,
  excludeIds,
  onChange,
  onRemove,
}: {
  line: DraftLine;
  errors: LineErrors | undefined;
  showErrors: boolean;
  excludeIds: readonly string[];
  onChange: (line: DraftLine) => void;
  onRemove: () => void;
}) {
  const [searching, setSearching] = useState(false);
  const shown = showErrors ? errors : undefined;
  const isCheck = line.status === 'check';
  const isNotFound = line.status === 'not_found' && !line.product;
  const name = line.product?.name ?? line.sourceText ?? 'this line';
  const k = line.key;

  return (
    <li
      className={cn(
        'bg-card flex flex-col gap-3 rounded-2xl border-2 p-4',
        isCheck ? 'border-accent bg-accent/10' : 'border-border',
        isNotFound && 'border-dashed',
      )}
    >
      {line.sourceText !== null ? (
        <p className="text-muted-foreground text-base">
          You wrote: <span className="text-foreground font-medium">“{line.sourceText}”</span>
        </p>
      ) : null}

      {isCheck ? (
        <p className="flex items-center gap-2 text-base font-semibold">
          <AlertTriangle aria-hidden="true" className="size-5 shrink-0" />
          Please check
        </p>
      ) : null}
      {isCheck && line.note ? <p className="text-base">{line.note}</p> : null}

      {line.choices.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-base font-medium">Which product do you mean?</legend>
          {line.choices.map((c) => {
            const checked = line.product?.id === c.id;
            return (
              <label
                key={c.id}
                className={cn(
                  'has-focus-visible:ring-ring/60 flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border-2 px-3 py-2 has-focus-visible:ring-3',
                  checked ? 'border-primary bg-primary/10' : 'border-input/40 bg-card',
                )}
              >
                <input
                  type="radio"
                  name={`${k}-choice`}
                  value={c.id}
                  checked={checked}
                  onChange={() => onChange(chooseProduct(line, c))}
                  className="accent-primary size-5 shrink-0"
                />
                <span className="flex flex-col">
                  <span className="text-base font-semibold">{c.name}</span>
                  <span className="text-muted-foreground text-base">{c.packDescription}</span>
                </span>
              </label>
            );
          })}
          {shown?.product ? <p className={FIELD_ERROR}>{shown.product}</p> : null}
        </fieldset>
      ) : null}

      {isNotFound ? (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-base font-semibold">
            <SearchX aria-hidden="true" className="size-5 shrink-0" />
            Not found
          </p>
          <p className="text-base">
            We couldn&apos;t match this to a product we sell. Search the catalogue, or remove the
            line. Lines left as “Not found” are not saved.
          </p>
          {searching ? (
            <CatalogueSearch
              label={`Find a product for “${line.sourceText ?? ''}”`}
              excludeIds={excludeIds}
              onPick={(item) =>
                onChange({
                  ...line,
                  product: {
                    id: item.productId,
                    name: item.name,
                    packDescription: item.packDescription,
                  },
                  quantity: line.quantity ?? 1,
                })
              }
            />
          ) : (
            <button type="button" className={BUTTON_SECONDARY} onClick={() => setSearching(true)}>
              Search the catalogue
            </button>
          )}
        </div>
      ) : null}

      {line.product && line.choices.length === 0 ? (
        <div>
          <p className="text-lg font-semibold">{line.product.name}</p>
          <p className="text-muted-foreground text-base">{line.product.packDescription}</p>
          {shown?.product ? <p className={FIELD_ERROR}>{shown.product}</p> : null}
        </div>
      ) : null}

      {!isNotFound ? (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-base font-medium">Quantity</span>
            <QuantityStepper
              id={`${k}-qty`}
              label={`Quantity of ${name}`}
              value={line.quantity}
              onChange={(quantity) => onChange({ ...line, quantity })}
              invalid={Boolean(shown?.quantity)}
              describedBy={shown?.quantity ? `${k}-qty-error` : undefined}
            />
            {shown?.quantity ? (
              <p id={`${k}-qty-error`} className={FIELD_ERROR}>
                {shown.quantity}
              </p>
            ) : null}
          </div>
          <MoneyInput
            id={`${k}-price`}
            label="Usual price for one, delivered"
            value={line.priceText}
            onChange={(priceText) => onChange({ ...line, priceText, priceIsSample: false })}
            error={shown?.price ?? null}
            hint="What you pay today. It also becomes your price limit, so a Kongsi never costs you more."
            badge={line.priceIsSample ? <SamplePriceBadge /> : null}
            placeholder="e.g. 165.00"
          />
        </>
      ) : null}

      <button type="button" className={cn(BUTTON_DANGER, 'self-start')} onClick={onRemove}>
        <Trash2 aria-hidden="true" className="size-5" />
        Remove<span className="sr-only"> {name}</span>
      </button>
    </li>
  );
}
