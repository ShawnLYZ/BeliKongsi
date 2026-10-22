'use client';

import { useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { UsualListView } from '@/lib/views/usual-list';
import { CatalogueSearch } from '@/components/catalogue/catalogue-search';
import { ApiError, apiFetch } from '@/components/common/api-client';
import {
  BUTTON_PRIMARY,
  BUTTON_QUIET,
  BUTTON_SECONDARY,
  FIELD_ERROR,
} from '@/components/common/controls';
import { ReviewLine } from './review-line';
import { addedLine, toSaveItems, validateLines, type DraftLine } from './review-lines';

/**
 * The review list: matched, "Please check" and "Not found" lines, quantities and usual prices.
 * Nothing is saved until the owner confirms (story 17).
 */
export function ReviewList({
  shopId,
  initialLines,
  suggestionRunId,
  ignoredText,
  onConfirmed,
  onStartOver,
}: {
  shopId: string;
  initialLines: DraftLine[];
  suggestionRunId: string | null;
  ignoredText: string[];
  onConfirmed: (list: UsualListView) => void;
  onStartOver: () => void;
}) {
  const [lines, setLines] = useState(initialLines);
  const [adding, setAdding] = useState(initialLines.length === 0);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const nextKey = useRef(0);

  const errors = useMemo(() => validateLines(lines), [lines]);
  const items = toSaveItems(lines);
  const unresolved = lines.filter((l) => l.status === 'not_found' && !l.product).length;
  const toCheck = lines.filter((l) => l.status === 'check').length;
  const productIds = lines.flatMap((l) => (l.product ? [l.product.id] : []));

  function update(key: string, next: DraftLine) {
    setLines((ls) => ls.map((l) => (l.key === key ? next : l)));
  }

  async function confirm() {
    setShowErrors(true);
    setSaveError(null);
    if (errors.size > 0) {
      setSaveError('Some lines need your attention. Look for the messages above.');
      return;
    }
    if (items.length === 0) {
      setSaveError('Add at least one item to your usual list.');
      return;
    }
    setSaving(true);
    try {
      const list = await apiFetch<UsualListView>(`/api/shops/${shopId}/usual-list`, {
        method: 'PUT',
        body: { items, ...(suggestionRunId ? { suggestionRunId } : {}) },
        quiet: true,
      });
      onConfirmed(list);
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
        <h2 className="text-xl font-semibold">Check your usual list</h2>
        <p className="text-base">
          {suggestionRunId
            ? 'This is what we understood. Change anything that is wrong. Nothing is saved until you confirm.'
            : 'Add the items you order every week. Nothing is saved until you confirm.'}
        </p>
        {toCheck > 0 ? (
          <p className="text-base font-medium">
            {toCheck === 1
              ? '1 line needs you to check it.'
              : `${toCheck} lines need you to check them.`}
          </p>
        ) : null}
      </div>

      {lines.length > 0 ? (
        <ul aria-label="Your usual list" className="flex flex-col gap-3">
          {lines.map((line) => (
            <ReviewLine
              key={line.key}
              line={line}
              errors={errors.get(line.key)}
              showErrors={showErrors}
              excludeIds={productIds}
              onChange={(next) => update(line.key, next)}
              onRemove={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
            />
          ))}
        </ul>
      ) : null}

      {ignoredText.length > 0 ? (
        <details className="bg-card rounded-2xl border p-4">
          <summary className="text-primary focus-visible:ring-ring/50 flex min-h-11 cursor-pointer items-center rounded-md text-base font-medium focus-visible:ring-3 focus-visible:outline-none">
            Text we skipped ({ignoredText.length})
          </summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-base">
            {ignoredText.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {adding ? (
        <section className="bg-card flex flex-col gap-3 rounded-2xl border p-4">
          <h3 className="text-lg font-semibold">Add an item</h3>
          <CatalogueSearch
            excludeIds={productIds}
            onPick={(item) => {
              nextKey.current += 1;
              setLines((ls) => [
                ...ls,
                addedLine(
                  { id: item.productId, name: item.name, packDescription: item.packDescription },
                  `added-${nextKey.current}`,
                ),
              ]);
            }}
          />
          <button type="button" className={BUTTON_SECONDARY} onClick={() => setAdding(false)}>
            Done adding
          </button>
        </section>
      ) : (
        <button type="button" className={BUTTON_SECONDARY} onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" className="size-5" />
          Add an item
        </button>
      )}

      {unresolved > 0 ? (
        <p className="text-base">
          {unresolved === 1
            ? '1 line is still “Not found” and will not be saved.'
            : `${unresolved} lines are still “Not found” and will not be saved.`}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        {saveError ? (
          <p role="alert" className={FIELD_ERROR}>
            {saveError}
          </p>
        ) : null}
        <button type="button" className={BUTTON_PRIMARY} disabled={saving} onClick={confirm}>
          {saving
            ? 'Saving…'
            : `Confirm my usual list (${items.length} ${items.length === 1 ? 'item' : 'items'})`}
        </button>
        <button type="button" className={BUTTON_QUIET} onClick={onStartOver}>
          Start again
        </button>
      </div>
    </div>
  );
}
