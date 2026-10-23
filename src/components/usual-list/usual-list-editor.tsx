'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { UsualListItemView, UsualListView } from '@/lib/views/usual-list';
import { CatalogueSearch } from '@/components/catalogue/catalogue-search';
import { ApiError, apiFetch } from '@/components/common/api-client';
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_ERROR } from '@/components/common/controls';
import { EmptyState } from '@/components/common/empty-state';
import { parseRinggitInput, senToRinggitInput } from '@/lib/money-input';
import { UsualListRow, type EditItem, type RowErrors } from './usual-list-row';

const MAX_QUANTITY = 999;

function toEdit(i: UsualListItemView): EditItem {
  return {
    productId: i.productId,
    name: i.name,
    packDescription: i.packDescription,
    unitName: i.unitName,
    quantity: i.quantity,
    priceText: senToRinggitInput(i.usualPriceSen),
    // A limit equal to the usual price (including no usual price and no limit) follows it.
    limitMode:
      i.priceLimitSen === i.usualPriceSen ? 'usual' : i.priceLimitSen === null ? 'none' : 'own',
    limitText: senToRinggitInput(i.priceLimitSen),
  };
}

function validate(items: readonly EditItem[]): Map<string, RowErrors> {
  const errors = new Map<string, RowErrors>();
  for (const i of items) {
    const e: RowErrors = {};
    if (i.quantity === null || i.quantity < 1 || i.quantity > MAX_QUANTITY) {
      e.quantity = `Enter a quantity from 1 to ${MAX_QUANTITY}.`;
    }
    if (parseRinggitInput(i.priceText) === undefined) {
      e.price = 'Enter an amount like 165.00, or leave it empty.';
    }
    if (i.limitMode === 'own' && !parseRinggitInput(i.limitText)) {
      e.limit = 'Enter a price limit like 160.00.';
    }
    if (e.quantity || e.price || e.limit) errors.set(i.productId, e);
  }
  return errors;
}

function toSaveItems(items: readonly EditItem[]) {
  return items.map((i) => ({
    productId: i.productId,
    quantity: i.quantity!,
    usualPriceSen: parseRinggitInput(i.priceText) ?? null,
    // Left out, the limit follows the usual price (story 20).
    ...(i.limitMode === 'none'
      ? { priceLimitSen: null }
      : i.limitMode === 'own'
        ? { priceLimitSen: parseRinggitInput(i.limitText)! }
        : {}),
  }));
}

/** Edit the usual list: quantities, usual prices and price limits; add or remove items. */
export function UsualListEditor({ shopId, list }: { shopId: string; list: UsualListView }) {
  const [items, setItems] = useState(() => list.items.map(toEdit));
  const [adding, setAdding] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errors = validate(items);

  function change(next: EditItem) {
    setItems((is) => is.map((i) => (i.productId === next.productId ? next : i)));
  }

  async function save() {
    setShowErrors(true);
    setError(null);
    if (errors.size > 0) {
      setError('Some items need your attention. Look for the messages above.');
      return;
    }
    setSaving(true);
    try {
      const saved = await apiFetch<UsualListView>(`/api/shops/${shopId}/usual-list`, {
        method: 'PUT',
        body: { items: toSaveItems(items) },
        quiet: true,
      });
      setItems(saved.items.map(toEdit));
      setShowErrors(false);
      toast.success('Your usual list is saved.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {items.length === 0 ? (
        <EmptyState
          title="Your usual list is empty"
          explanation="Add the items you order every week, with how many and what you usually pay. Your weekly basket is drafted from this list."
          example="Evaporated milk 390 g, 2 cartons, usually RM 150.00 a carton."
        />
      ) : (
        <ul aria-label="Your usual list" className="flex flex-col gap-3">
          {items.map((item) => (
            <UsualListRow
              key={item.productId}
              item={item}
              errors={showErrors ? errors.get(item.productId) : undefined}
              onChange={change}
              onRemove={() => setItems((is) => is.filter((i) => i.productId !== item.productId))}
            />
          ))}
        </ul>
      )}

      {adding ? (
        <section className="bg-card flex flex-col gap-3 rounded-2xl border p-4">
          <h2 className="text-lg font-semibold">Add an item</h2>
          <CatalogueSearch
            excludeIds={items.map((i) => i.productId)}
            onPick={(p) => {
              setItems((is) => [
                ...is,
                {
                  productId: p.productId,
                  name: p.name,
                  packDescription: p.packDescription,
                  unitName: p.unitName,
                  quantity: 1,
                  priceText: '',
                  limitMode: 'usual',
                  limitText: '',
                },
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

      {error ? (
        <p role="alert" className={FIELD_ERROR}>
          {error}
        </p>
      ) : null}
      <button type="button" className={BUTTON_PRIMARY} disabled={saving} onClick={save}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}
