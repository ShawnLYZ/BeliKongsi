'use client';

import { useId, useMemo, useState } from 'react';
import type { PriceListParseView } from '@/lib/views/supplier';
import { ApiError, apiFetch } from '@/components/common/api-client';
import {
  BUTTON_PRIMARY,
  BUTTON_QUIET,
  BUTTON_SECONDARY,
  FIELD_ERROR,
  FIELD_LABEL,
  INPUT,
} from '@/components/common/controls';
import { Money } from '@/components/common/money';
import { MoneyInput } from '@/components/common/money-input';
import { cn } from '@/lib/utils';
import {
  clashingLines,
  confirmLines,
  DUPLICATE_MATCH,
  laterDuplicates,
  lineProblems,
  reviewLinesFrom,
  type LineProblems,
  type NewProductFields,
  type ReviewLine,
} from './price-list-draft';
import { CATEGORIES, UNITS } from './product-draft';
import { TierEditor } from './tier-editor';

const LOW_CONFIDENCE = 0.8;

function Price({ min, sen }: { min: number; sen: number }) {
  return (
    <span className="flex flex-col tabular-nums">
      <span>{Number.isFinite(min) ? `${min}+` : '?'}</span>
      {Number.isSafeInteger(sen) ? <Money sen={sen} /> : <span>?</span>}
    </span>
  );
}

/** The drafted prices beside the product's prices now, with the rows that have problems marked. */
function CompareTable({ line, problems }: { line: ReviewLine; problems: LineProblems }) {
  const { view } = line;
  const unit = view.current?.unitName ?? view.unitName ?? 'unit';
  const count = Math.max(view.tiers.length, view.current?.tiers.length ?? 0);
  return (
    <table className="w-full border-collapse text-left text-base">
      <caption className="sr-only">
        Prices now and as drafted for {view.current?.name ?? view.proposedName ?? 'this line'}
      </caption>
      <thead>
        <tr className="border-b">
          <th scope="col" className="py-2 font-semibold">
            Per {unit}
          </th>
          <th scope="col" className="py-2 font-semibold">
            Now
          </th>
          <th scope="col" className="py-2 font-semibold">
            Drafted
          </th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-b">
          <th scope="row" className="py-2 font-normal">
            Buy alone
          </th>
          <td className="py-2">
            {view.current ? <Money sen={view.current.buyAlonePriceSen} /> : '—'}
          </td>
          <td className="py-2">
            {view.buyAlonePriceSen === null ? (
              'Same'
            ) : Number.isSafeInteger(view.buyAlonePriceSen) ? (
              <Money sen={view.buyAlonePriceSen} />
            ) : (
              '?'
            )}
          </td>
        </tr>
        {Array.from({ length: count }, (_, i) => {
          const now = view.current?.tiers[i];
          const drafted = view.tiers[i];
          const bad = (problems.rows[i]?.length ?? 0) > 0;
          return (
            <tr
              key={i}
              className={cn('border-b last:border-b-0', bad && 'bg-destructive/10 font-semibold')}
            >
              <th scope="row" className="py-2 font-normal">
                Tier {i + 1}
                {bad ? <span className="text-destructive"> (problem)</span> : null}
              </th>
              <td className="py-2">
                {now ? <Price min={now.minQuantity} sen={now.unitPriceSen} /> : '—'}
              </td>
              <td className="py-2">
                {drafted ? <Price min={drafted.minQuantity} sen={drafted.unitPriceSen} /> : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function NewProductForm({
  idPrefix,
  fields,
  errors,
  onChange,
}: {
  idPrefix: string;
  fields: NewProductFields;
  errors: LineProblems['fields'];
  onChange: (next: NewProductFields) => void;
}) {
  const set = <K extends keyof NewProductFields>(k: K, v: NewProductFields[K]) =>
    onChange({ ...fields, [k]: v });
  const input = (k: 'name' | 'shortName' | 'packDescription' | 'unitWeightText', label: string) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${idPrefix}-${k}`} className={FIELD_LABEL}>
        {label}
      </label>
      <input
        id={`${idPrefix}-${k}`}
        autoComplete="off"
        inputMode={k === 'unitWeightText' ? 'numeric' : undefined}
        value={fields[k]}
        onChange={(e) => set(k, e.target.value)}
        aria-invalid={errors[k] ? true : undefined}
        aria-describedby={errors[k] ? `${idPrefix}-${k}-error` : undefined}
        className={INPUT}
      />
      {errors[k] ? (
        <p id={`${idPrefix}-${k}-error`} className={FIELD_ERROR}>
          {errors[k]}
        </p>
      ) : null}
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-base">
        A new product needs a few more details. It closes every Thursday at 8:00 pm; change that on
        its page afterwards.
      </p>
      {input('name', 'Product name')}
      {input('shortName', 'Short name')}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-category`} className={FIELD_LABEL}>
          Category
        </label>
        <select
          id={`${idPrefix}-category`}
          value={fields.category}
          onChange={(e) => set('category', e.target.value as NewProductFields['category'])}
          aria-invalid={errors.category ? true : undefined}
          aria-describedby={errors.category ? `${idPrefix}-category-error` : undefined}
          className={INPUT}
        >
          <option value="">Choose a category</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {errors.category ? (
          <p id={`${idPrefix}-category-error`} className={FIELD_ERROR}>
            {errors.category}
          </p>
        ) : null}
      </div>
      {input('packDescription', 'What is in one pack')}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-unit`} className={FIELD_LABEL}>
            Unit
          </label>
          <select
            id={`${idPrefix}-unit`}
            value={fields.unitName}
            onChange={(e) => set('unitName', e.target.value as NewProductFields['unitName'])}
            className={INPUT}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        {input('unitWeightText', 'Weight (grams)')}
      </div>
    </div>
  );
}

function LineCard({
  line,
  problems,
  duplicate,
  clashing,
  onChange,
}: {
  line: ReviewLine;
  problems: LineProblems;
  /** Matched to the same product as an earlier line. */
  duplicate: boolean;
  /** Kept while an earlier kept line saves the same product. */
  clashing: boolean;
  onChange: (next: ReviewLine) => void;
}) {
  const id = useId();
  const { view } = line;
  const isNew = view.productId === null;
  const title = isNew ? `New product: ${view.proposedName ?? 'unnamed'}` : view.current!.name;
  const unit = line.newProduct?.unitName ?? view.current?.unitName ?? view.unitName ?? 'unit';
  const ladderCheck = {
    tiers: [],
    ladder: problems.ladder,
    rows: problems.rows,
    ok: problems.ok,
  };
  const hasProblem = !problems.ok || clashing;
  return (
    <li
      aria-labelledby={`${id}-title`}
      className={cn(
        'bg-card flex flex-col gap-3 rounded-2xl border-2 p-4',
        hasProblem && line.included ? 'border-destructive/60' : 'border-border',
        !line.included && 'opacity-90',
      )}
    >
      <div className="flex flex-col gap-1">
        <h3 id={`${id}-title`} className="text-lg leading-snug font-semibold">
          {title}
        </h3>
        <p className="text-muted-foreground text-base break-words">“{view.sourceText}”</p>
        {view.confidence < LOW_CONFIDENCE ? (
          <p className="bg-accent text-accent-foreground w-fit rounded-full px-2 text-base font-semibold">
            Please check
          </p>
        ) : null}
        {view.note ? <p className="text-base">{view.note}</p> : null}
        {duplicate ? (
          <p className={clashing ? FIELD_ERROR : 'text-base font-medium'}>
            {DUPLICATE_MATCH}.
            {clashing ? ' A product can only be saved once, so untick one of them.' : null}
          </p>
        ) : null}
      </div>

      <label className="flex min-h-12 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={line.included}
          onChange={(e) => onChange({ ...line, included: e.target.checked })}
          className="accent-primary size-6 shrink-0"
        />
        <span className="text-base font-medium">
          {isNew ? 'Add this new product' : 'Save these prices'}
          <span className="sr-only"> for {title}</span>
        </span>
      </label>

      {line.edited ? (
        <div className="flex flex-col gap-3">
          <MoneyInput
            id={`${id}-buy-alone`}
            label={`Buy-alone price per ${unit}`}
            value={line.buyAloneText}
            onChange={(t) => onChange({ ...line, buyAloneText: t })}
            hint={isNew ? undefined : 'Leave it empty to keep the price it has now.'}
          />
          <TierEditor
            label="Drafted tiers"
            rows={line.tiers}
            onChange={(rows) => onChange({ ...line, tiers: rows })}
            check={ladderCheck}
            unitName={unit}
            showAll
          />
        </div>
      ) : (
        <>
          <CompareTable line={line} problems={problems} />
          {problems.ladder.length > 0 || problems.rows.some((r) => r.length > 0) ? (
            <ul className="flex flex-col gap-1">
              {[...problems.ladder, ...problems.rows.flat()].map((m) => (
                <li key={m} className={FIELD_ERROR}>
                  {m}
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            className={BUTTON_SECONDARY}
            onClick={() => onChange({ ...line, edited: true })}
          >
            Edit drafted prices<span className="sr-only"> for {title}</span>
          </button>
        </>
      )}

      {line.newProduct && line.included ? (
        <NewProductForm
          idPrefix={`${id}-new`}
          fields={line.newProduct}
          errors={problems.fields}
          onChange={(next) => onChange({ ...line, newProduct: next })}
        />
      ) : null}
    </li>
  );
}

/**
 * The drafted lines beside the products as they are now. Lines with a problem are marked; Confirm
 * stays disabled while a kept line has one. Nothing is saved until Confirm.
 */
export function PriceListReview({
  supplierId,
  parse,
  onConfirmed,
  onStartOver,
}: {
  supplierId: string;
  parse: PriceListParseView;
  onConfirmed: (result: { updated: number; created: number }) => void;
  onStartOver: () => void;
}) {
  const [lines, setLines] = useState(() => reviewLinesFrom(parse));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const problems = useMemo(() => new Map(lines.map((l) => [l.key, lineProblems(l)])), [lines]);
  const kept = lines.filter((l) => l.included);
  const duplicates = useMemo(() => laterDuplicates(lines), [lines]);
  const clashing = clashingLines(lines);
  const blocked = kept.filter((l) => !problems.get(l.key)!.ok || clashing.has(l.key)).length;
  const canConfirm = kept.length > 0 && blocked === 0 && !saving;

  async function confirm() {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await apiFetch<{ updated: number; created: number }>(
        `/api/suppliers/${supplierId}/price-list/confirm`,
        {
          body: { suggestionRunId: parse.suggestionRunId, lines: confirmLines(lines) },
          quiet: true,
        },
      );
      onConfirmed(result);
    } catch (error) {
      setSaveError(
        error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
      );
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">Check the drafted prices</h2>
        <p className="text-base">
          This is what we read. Untick a line to leave it out, or edit its prices. Nothing is saved
          until you confirm, and saved prices reach shops from each product&apos;s next round.
        </p>
      </div>

      <ul aria-label="Drafted price list" className="flex flex-col gap-3">
        {lines.map((line) => (
          <LineCard
            key={line.key}
            line={line}
            problems={problems.get(line.key)!}
            duplicate={duplicates.has(line.key)}
            clashing={clashing.has(line.key)}
            onChange={(next) => setLines((ls) => ls.map((l) => (l.key === line.key ? next : l)))}
          />
        ))}
      </ul>

      {parse.ignoredText.length > 0 ? (
        <details className="bg-card rounded-2xl border p-4">
          <summary className="text-primary focus-visible:ring-ring/50 flex min-h-11 cursor-pointer items-center rounded-md text-base font-medium focus-visible:ring-3 focus-visible:outline-none">
            Text we skipped ({parse.ignoredText.length})
          </summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-base break-words">
            {parse.ignoredText.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="flex flex-col gap-2">
        <p aria-live="polite" className="text-base font-medium">
          {blocked > 0
            ? `${blocked === 1 ? '1 line has' : `${blocked} lines have`} a problem. Fix it or untick it to confirm.`
            : kept.length === 0
              ? 'Tick at least one line to confirm.'
              : `${kept.length} ${kept.length === 1 ? 'line' : 'lines'} will be saved.`}
        </p>
        {saveError ? (
          <p role="alert" className={FIELD_ERROR}>
            {saveError}
          </p>
        ) : null}
        <button type="button" className={BUTTON_PRIMARY} disabled={!canConfirm} onClick={confirm}>
          Confirm
        </button>
        <button type="button" className={BUTTON_QUIET} onClick={onStartOver}>
          Start again
        </button>
      </div>
    </div>
  );
}
