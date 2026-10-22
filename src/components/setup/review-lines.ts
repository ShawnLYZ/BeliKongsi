import type { ParseView } from '@/lib/views/usual-list';
import { parseRinggitInput, senToRinggitInput } from '@/lib/money-input';

export interface ProductChoice {
  id: string;
  name: string;
  packDescription: string;
}

/** One line of the setup review list, before it is saved. */
export interface DraftLine {
  key: string;
  /** The pasted line it came from; null for a line added by hand. */
  sourceText: string | null;
  /** What the reader made of it. `added` lines were picked from the catalogue by the owner. */
  status: 'ok' | 'check' | 'not_found' | 'added';
  /** The chosen product; null until a "Please check" or "Not found" line is resolved. */
  product: ProductChoice | null;
  /** For "Please check" lines: the suggested product and its alternatives. */
  choices: ProductChoice[];
  quantity: number | null;
  priceText: string;
  /** True while the price is the untouched sample price for `sampleProductId`. */
  priceIsSample: boolean;
  samplePriceSen: number | null;
  sampleProductId: string | null;
  note: string | null;
}

export interface LineErrors {
  product?: string;
  quantity?: string;
  price?: string;
}

const MAX_QUANTITY = 999;

/** Turns the reader's answer into editable lines. "Please check" lines start with nothing chosen. */
export function draftLinesFromParse(view: ParseView): DraftLine[] {
  return view.lines.map((l, i) => {
    const sample = l.samplePriceSen ?? null;
    const choices: ProductChoice[] =
      l.status === 'check' && l.product
        ? [
            {
              id: l.product.id,
              name: l.product.name,
              packDescription: l.product.packDescription,
            },
            ...l.alternatives,
          ]
        : [];
    const product =
      l.status === 'ok' && l.product
        ? { id: l.product.id, name: l.product.name, packDescription: l.product.packDescription }
        : // A "Please check" line with only one candidate (an unclear quantity) needs no choice.
          l.status === 'check' && l.product && choices.length === 1
          ? choices[0]!
          : null;
    return {
      key: `parsed-${i}`,
      sourceText: l.sourceText,
      status: l.status,
      product,
      choices: choices.length > 1 ? choices : [],
      quantity: l.quantity,
      priceText: senToRinggitInput(sample),
      priceIsSample: sample !== null,
      samplePriceSen: sample,
      sampleProductId: sample !== null ? (l.product?.id ?? null) : null,
      note: l.note,
    };
  });
}

/** A line added through the catalogue search. */
export function addedLine(product: ProductChoice, key: string): DraftLine {
  return {
    key,
    sourceText: null,
    status: 'added',
    product,
    choices: [],
    quantity: 1,
    priceText: '',
    priceIsSample: false,
    samplePriceSen: null,
    sampleProductId: null,
    note: null,
  };
}

/** Chooses a product for a line, keeping the sample price only for the product it belongs to. */
export function chooseProduct(line: DraftLine, product: ProductChoice): DraftLine {
  const next: DraftLine = { ...line, product };
  if (line.samplePriceSen !== null) {
    if (product.id === line.sampleProductId && (line.priceIsSample || line.priceText === '')) {
      next.priceText = senToRinggitInput(line.samplePriceSen);
      next.priceIsSample = true;
    } else if (product.id !== line.sampleProductId && line.priceIsSample) {
      next.priceText = '';
      next.priceIsSample = false;
    }
  }
  return next;
}

/** Problems that stop the list being saved, by line key. "Not found" lines are left out, not errors. */
export function validateLines(lines: readonly DraftLine[]): Map<string, LineErrors> {
  const errors = new Map<string, LineErrors>();
  const seen = new Map<string, string>();
  for (const line of lines) {
    if (line.status === 'not_found' && !line.product) continue;
    const e: LineErrors = {};
    if (!line.product) e.product = 'Choose which product you mean.';
    else if (seen.has(line.product.id)) {
      e.product = `${line.product.name} is already on your list. Remove one of the two lines.`;
    } else seen.set(line.product.id, line.key);
    if (
      line.quantity === null ||
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > MAX_QUANTITY
    ) {
      e.quantity = `Enter a quantity from 1 to ${MAX_QUANTITY}.`;
    }
    if (parseRinggitInput(line.priceText) === undefined) {
      e.price = 'Enter an amount like 165.00, or leave it empty.';
    }
    if (e.product || e.quantity || e.price) errors.set(line.key, e);
  }
  return errors;
}

/** The PUT body's items. The price limit is left out, so it starts as the usual price (story 20). */
export function toSaveItems(lines: readonly DraftLine[]) {
  return lines
    .filter((l): l is DraftLine & { product: ProductChoice } => l.product !== null)
    .map((l) => ({
      productId: l.product.id,
      quantity: l.quantity!,
      usualPriceSen: parseRinggitInput(l.priceText) ?? null,
    }));
}
