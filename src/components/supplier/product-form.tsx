'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { SupplierProductView } from '@/lib/views/supplier';
import { ApiError, apiFetch } from '@/components/common/api-client';
import { BUTTON_PRIMARY, FIELD_ERROR, FIELD_LABEL, INPUT } from '@/components/common/controls';
import { MoneyInput } from '@/components/common/money-input';
import { formatMytDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  CADENCES,
  CATEGORIES,
  changedFields,
  formValuesFrom,
  NEW_PRODUCT_VALUES,
  readProductForm,
  UNITS,
  WEEKDAYS,
  type ProductField,
  type ProductFormValues,
} from './product-draft';
import { TierEditor } from './tier-editor';

/** When a change made now reaches owners, for the tier editor's notice. */
export function nextRoundNotice(p: SupplierProductView): string {
  return p.nextRoundCutoffAt
    ? `Changes apply from the next round (closes ${formatMytDate(new Date(p.nextRoundCutoffAt))})`
    : 'This product is not active, so no new round opens until you switch it back on.';
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: (describedBy: string | undefined) => ReactNode;
}) {
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
    undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>
      {children(describedBy)}
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

/**
 * Every field a supplier sets on a product, with its price tiers. Without `product` it adds a new
 * one, whose first round opens straight away; with it, it saves only what changed.
 */
export function ProductForm({
  supplierId,
  product,
}: {
  supplierId: string;
  product?: SupplierProductView;
}) {
  const id = useId();
  const router = useRouter();
  const [baseline, setBaseline] = useState(product);
  const [values, setValues] = useState<ProductFormValues>(() =>
    product ? formValuesFrom(product) : NEW_PRODUCT_VALUES,
  );
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const read = useMemo(() => readProductForm(values), [values]);
  const set = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const err = (field: ProductField) => (showErrors ? (read.errors[field] ?? null) : null);
  const fid = (field: string) => `${id}-${field}`;

  function text(field: ProductField & keyof ProductFormValues, label: string, hint?: string) {
    return (
      <Field id={fid(field)} label={label} hint={hint} error={err(field)}>
        {(describedBy) => (
          <input
            id={fid(field)}
            autoComplete="off"
            value={values[field] as string}
            onChange={(e) => set(field, e.target.value as never)}
            aria-invalid={err(field) ? true : undefined}
            aria-describedby={describedBy}
            className={INPUT}
          />
        )}
      </Field>
    );
  }

  async function save() {
    setShowErrors(true);
    setSaveError(null);
    if (!read.input) {
      setSaveError('Some fields need your attention. Look for the messages above.');
      return;
    }
    setBusy(true);
    try {
      if (!baseline) {
        const created = await apiFetch<SupplierProductView>(
          `/api/suppliers/${supplierId}/products`,
          { method: 'POST', body: read.input, quiet: true },
        );
        toast.success('Product added. Its first round is open.');
        router.push(`/supplier/products/${created.productId}`);
        return;
      }
      const patch = changedFields(read.input, baseline);
      if (Object.keys(patch).length === 0) {
        toast.info('Nothing has changed.');
        setBusy(false);
        return;
      }
      const saved = await apiFetch<SupplierProductView>(
        `/api/suppliers/${supplierId}/products/${baseline.productId}`,
        { method: 'PATCH', body: patch, quiet: true },
      );
      setBaseline(saved);
      setValues(formValuesFrom(saved));
      setShowErrors(false);
      toast.success(
        saved.nextRoundCutoffAt
          ? `Saved. Owners see the change from the round closing ${formatMytDate(new Date(saved.nextRoundCutoffAt))}.`
          : 'Saved.',
      );
      router.refresh();
    } catch (error) {
      setSaveError(
        error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
      );
    }
    setBusy(false);
  }

  const buyAloneError = err('buyAloneText');
  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <section className="bg-card flex flex-col gap-3 rounded-2xl border p-4">
        <h2 className="text-lg font-semibold">The product</h2>
        {text('name', 'Product name', 'As shops see it, e.g. Sweetened condensed milk 390 g.')}
        {text('shortName', 'Short name', 'Used in messages, e.g. condensed milk.')}
        <Field id={fid('category')} label="Category" error={err('category')}>
          {(describedBy) => (
            <select
              id={fid('category')}
              value={values.category}
              onChange={(e) => set('category', e.target.value as ProductFormValues['category'])}
              aria-invalid={err('category') ? true : undefined}
              aria-describedby={describedBy}
              className={INPUT}
            >
              <option value="">Choose a category</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        {text('packDescription', 'What is in one pack', 'e.g. carton of 48 × 390 g tins.')}
        <div className="grid grid-cols-2 gap-2">
          <Field id={fid('unit')} label="Unit">
            {() => (
              <select
                id={fid('unit')}
                value={values.unitName}
                onChange={(e) => set('unitName', e.target.value as ProductFormValues['unitName'])}
                className={INPUT}
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={fid('weight')} label="Weight (grams)" error={err('unitWeightText')}>
            {(describedBy) => (
              <input
                id={fid('weight')}
                inputMode="numeric"
                autoComplete="off"
                value={values.unitWeightText}
                onChange={(e) => set('unitWeightText', e.target.value)}
                aria-invalid={err('unitWeightText') ? true : undefined}
                aria-describedby={describedBy}
                className={cn(INPUT, 'tabular-nums')}
              />
            )}
          </Field>
        </div>
        {text(
          'aliasesText',
          'Other names shops use (optional)',
          'Separate them with commas, e.g. susu pekat, 炼奶, SKM.',
        )}
        <Field
          id={fid('conversions')}
          label="Other ways to count it (optional)"
          hint={`One per line: how many of each fit in one ${values.unitName}, e.g. tin = 48.`}
          error={err('conversionsText')}
        >
          {(describedBy) => (
            <textarea
              id={fid('conversions')}
              rows={2}
              value={values.conversionsText}
              onChange={(e) => set('conversionsText', e.target.value)}
              aria-invalid={err('conversionsText') ? true : undefined}
              aria-describedby={describedBy}
              className={cn(INPUT, 'py-2')}
            />
          )}
        </Field>
      </section>

      <section className="bg-card flex flex-col gap-4 rounded-2xl border p-4">
        <h2 className="text-lg font-semibold">Prices</h2>
        <MoneyInput
          id={fid('buyAlone')}
          label={`Buy-alone price per ${values.unitName}`}
          value={values.buyAloneText}
          onChange={(t) => set('buyAloneText', t)}
          error={buyAloneError}
          hint="What a shop pays when it buys on its own."
        />
        <TierEditor
          rows={values.tiers}
          onChange={(rows) => set('tiers', rows)}
          check={read.ladder}
          unitName={values.unitName}
          showAll={showErrors}
          notice={
            product
              ? nextRoundNotice(product)
              : 'The first round opens as soon as you add the product.'
          }
        />
      </section>

      <section className="bg-card flex flex-col gap-3 rounded-2xl border p-4">
        <h2 className="text-lg font-semibold">Round schedule</h2>
        <Field id={fid('cadence')} label="How often a round closes">
          {() => (
            <select
              id={fid('cadence')}
              value={values.cadence}
              onChange={(e) => set('cadence', e.target.value as ProductFormValues['cadence'])}
              className={INPUT}
            >
              {CADENCES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field id={fid('weekday')} label="Cut-off day">
            {() => (
              <select
                id={fid('weekday')}
                value={values.cutoffWeekday}
                onChange={(e) => set('cutoffWeekday', e.target.value)}
                className={INPUT}
              >
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={String(i + 1)}>
                    {d}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={fid('time')} label="Cut-off time" error={err('cutoffTime')}>
            {(describedBy) => (
              <input
                id={fid('time')}
                type="time"
                value={values.cutoffTime}
                onChange={(e) => set('cutoffTime', e.target.value)}
                aria-invalid={err('cutoffTime') ? true : undefined}
                aria-describedby={describedBy}
                className={cn(INPUT, 'tabular-nums')}
              />
            )}
          </Field>
        </div>
        {text(
          'anchorWeek',
          product ? 'Week the schedule counts from' : 'Week the schedule counts from (optional)',
          product
            ? 'An ISO week like 2026-W45. Rounds every two or four weeks close in step with it.'
            : 'An ISO week like 2026-W45. Leave it empty to count from this week.',
        )}
        <p className="text-muted-foreground text-base">Times are Malaysia time.</p>
      </section>

      <div className="flex flex-col gap-2">
        {saveError ? (
          <p role="alert" className={FIELD_ERROR}>
            {saveError}
          </p>
        ) : null}
        <button type="submit" className={BUTTON_PRIMARY} disabled={busy}>
          {busy ? 'Saving…' : product ? 'Save changes' : 'Add product'}
        </button>
      </div>
    </form>
  );
}
