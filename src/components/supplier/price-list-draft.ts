import type { PriceListLineView, PriceListParseView } from '@/lib/views/supplier';
import type { ProductInput } from '@/server/modules/catalogue/supplier-edit';
import { parseRinggitInput, senToRinggitInput } from '@/lib/money-input';
import { checkLadder, tierRowsFrom, type TierRow } from './product-draft';

// Pure helpers for the price-list review: which lines are kept, their problems, and the confirm body.

type Category = ProductInput['category'];
type Unit = ProductInput['unitName'];

/** What a new product needs beyond its prices before it can be added. */
export interface NewProductFields {
  name: string;
  shortName: string;
  category: Category | '';
  packDescription: string;
  unitName: Unit;
  unitWeightText: string;
}

/** One drafted line as the supplier reviews it. */
export interface ReviewLine {
  key: string;
  view: PriceListLineView;
  /**
   * Kept for saving. Matched lines start kept, except a later line matched to the same product as
   * an earlier one; new-product drafts start left out.
   */
  included: boolean;
  /** Once edited, problems are worked out here again rather than taken from the server. */
  edited: boolean;
  buyAloneText: string;
  tiers: TierRow[];
  newProduct: NewProductFields | null;
}

export interface LineProblems {
  /** Problems about the whole line or ladder. */
  ladder: string[];
  /** Problems for each tier (0-based). */
  rows: string[][];
  /** Problems with the new product's fields, by field. */
  fields: Partial<Record<keyof NewProductFields, string>>;
  ok: boolean;
}

/** Shown beside a line matched to the same product as an earlier line. */
export const DUPLICATE_MATCH = 'Also matched on an earlier line';

export function reviewLinesFrom(view: PriceListParseView): ReviewLine[] {
  const lines = view.lines.map((l, i): ReviewLine => ({
    key: `line-${i}`,
    view: l,
    included: l.productId !== null,
    edited: false,
    buyAloneText: senToRinggitInput(l.buyAlonePriceSen),
    tiers: tierRowsFrom(l.tiers, `line-${i}-tier`),
    newProduct:
      l.productId === null
        ? {
            name: l.proposedName ?? '',
            shortName: '',
            category: '',
            packDescription: l.packDescription ?? '',
            unitName: l.unitName ?? 'carton',
            unitWeightText: '',
          }
        : null,
  }));
  const later = laterDuplicates(lines);
  return lines.map((l) => (later.has(l.key) ? { ...l, included: false } : l));
}

/** The keys of lines matched to a product that an earlier line was matched to as well. */
export function laterDuplicates(lines: readonly ReviewLine[]): Set<string> {
  const seen = new Set<string>();
  const later = new Set<string>();
  for (const l of lines) {
    const id = l.view.productId;
    if (id === null) continue;
    if (seen.has(id)) later.add(l.key);
    seen.add(id);
  }
  return later;
}

/**
 * The keys of kept lines whose product an earlier kept line already saves. A product can only be
 * saved once, so Confirm stays disabled while any are kept.
 */
export function clashingLines(lines: readonly ReviewLine[]): Set<string> {
  const kept = new Set<string>();
  const clashing = new Set<string>();
  for (const l of lines) {
    const id = l.view.productId;
    if (id === null || !l.included) continue;
    if (kept.has(id)) clashing.add(l.key);
    kept.add(id);
  }
  return clashing;
}

/** The line's buy-alone price: as typed once edited, else as drafted. Undefined when unreadable. */
function buyAloneOf(line: ReviewLine): number | null | undefined {
  return line.edited ? parseRinggitInput(line.buyAloneText) : line.view.buyAlonePriceSen;
}

export function lineProblems(line: ReviewLine): LineProblems {
  let ladder: string[];
  let rows: string[][];
  if (!line.edited) {
    ladder = [];
    rows = line.view.tiers.map(() => []);
    for (const e of line.view.errors) {
      const row = e.position === null ? undefined : rows[e.position - 1];
      if (row) row.push(e.message);
      else ladder.push(e.message);
    }
  } else {
    const buyAlone = parseRinggitInput(line.buyAloneText);
    const checked = checkLadder(
      line.tiers,
      typeof buyAlone === 'number' ? buyAlone : line.view.current?.buyAlonePriceSen,
    );
    ladder = [
      ...(buyAlone === undefined ? ['The buy-alone price must be an amount like 168.00.'] : []),
      ...checked.ladder,
    ];
    rows = checked.rows;
  }

  const fields: LineProblems['fields'] = {};
  const np = line.newProduct;
  if (np && line.included) {
    if (np.name.trim() === '') fields.name = 'Enter the product name.';
    if (np.shortName.trim() === '') fields.shortName = 'Enter a short name.';
    if (np.category === '') fields.category = 'Choose a category.';
    if (np.packDescription.trim() === '') fields.packDescription = 'Enter what is in one pack.';
    if (!/^\d{1,7}$/.test(np.unitWeightText.trim()) || Number(np.unitWeightText) < 1) {
      fields.unitWeightText = 'Enter the weight in grams, like 50000.';
    }
    if (buyAloneOf(line) === null) ladder.push('A new product needs a buy-alone price.');
  }

  const ok =
    ladder.length === 0 && rows.every((r) => r.length === 0) && Object.keys(fields).length === 0;
  return { ladder, rows, fields, ok };
}

/** The tiers to save: as drafted, or as typed once edited. */
function tiersOf(line: ReviewLine) {
  return line.edited
    ? checkLadder(line.tiers, null).tiers
    : line.view.tiers.map((t) => ({ minQuantity: t.minQuantity, unitPriceSen: t.unitPriceSen }));
}

/** The confirm request's lines, from the kept lines (which must all be free of problems). */
export function confirmLines(lines: readonly ReviewLine[]) {
  return lines
    .filter((l) => l.included)
    .map((l) => {
      const buyAlone = buyAloneOf(l);
      const tiers = tiersOf(l);
      if (l.view.productId !== null) {
        return {
          productId: l.view.productId,
          patch: { tiers, ...(typeof buyAlone === 'number' ? { buyAlonePriceSen: buyAlone } : {}) },
        };
      }
      const np = l.newProduct!;
      const create: ProductInput = {
        name: np.name.trim(),
        shortName: np.shortName.trim(),
        category: np.category as Category,
        packDescription: np.packDescription.trim(),
        unitName: np.unitName,
        unitWeightGrams: Number(np.unitWeightText),
        buyAlonePriceSen: buyAlone as number,
        aliases: [],
        cadence: 'weekly',
        cutoffWeekday: 4,
        cutoffTime: '20:00',
        tiers,
      };
      return { create };
    });
}
