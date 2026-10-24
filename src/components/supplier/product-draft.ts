import type { SupplierProductView } from '@/lib/views/supplier';
import type { ProductInput } from '@/server/modules/catalogue/supplier-edit';
import { validateTiers } from '@/server/engine/tiers';
import { parseRinggitInput, senToRinggitInput } from '@/lib/money-input';

// Pure helpers for the supplier's product form, tier editor and price-list review. The engine's
// `validateTiers` imports only types, so it runs in the browser too.

export const CATEGORIES = [
  { value: 'dairy', label: 'Dairy' },
  { value: 'oil', label: 'Oil' },
  { value: 'flour', label: 'Flour and sugar' },
  { value: 'beverages', label: 'Coffee and tea' },
  { value: 'eggs', label: 'Eggs' },
  { value: 'packaging', label: 'Packaging' },
] as const;

export const UNITS = ['carton', 'tin', 'tray', 'sack', 'pack'] as const;

export const CADENCES = [
  { value: 'weekly', label: 'Every week' },
  { value: 'fortnightly', label: 'Every two weeks' },
  { value: 'monthly', label: 'Every four weeks' },
] as const;

export const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export const MAX_TIERS = 5;

type Category = ProductInput['category'];
type Unit = ProductInput['unitName'];
type Cadence = ProductInput['cadence'];
type Tier = ProductInput['tiers'][number];

/** One row of the tier editor, as typed. */
export interface TierRow {
  key: string;
  minText: string;
  priceText: string;
}

export function tierRowsFrom(tiers: readonly Tier[], prefix = 'tier'): TierRow[] {
  return tiers.map((t, i) => ({
    key: `${prefix}-${i}`,
    minText: String(t.minQuantity),
    priceText: senToRinggitInput(t.unitPriceSen),
  }));
}

/** The ladder as numbers. Text that is not a whole number or an amount reads as NaN. */
export function readTierRows(rows: readonly TierRow[]): Tier[] {
  return rows.map((r) => {
    const min = r.minText.trim();
    const price = parseRinggitInput(r.priceText);
    return {
      minQuantity: /^\d{1,6}$/.test(min) ? Number(min) : NaN,
      unitPriceSen: typeof price === 'number' ? price : NaN,
    };
  });
}

/** The ladder's problems: those about the whole ladder, and those for each row (0-based). */
export interface LadderCheck {
  tiers: Tier[];
  ladder: string[];
  rows: string[][];
  ok: boolean;
}

/**
 * Checks a typed ladder with the engine's rules against the buy-alone price (when it is known).
 * A price that is not an amount gets a message about ringgit rather than sen.
 */
export function checkLadder(
  rows: readonly TierRow[],
  buyAlonePriceSen: number | null | undefined,
): LadderCheck {
  const tiers = readTierRows(rows);
  const result = validateTiers(
    tiers,
    typeof buyAlonePriceSen === 'number' ? { buyAlonePriceSen } : {},
  );
  const ladder: string[] = [];
  const byRow: string[][] = rows.map(() => []);
  if (!result.ok) {
    for (const e of result.errors) {
      const message =
        e.code === 'PRICE_NOT_POSITIVE_INTEGER' && e.position !== null
          ? `Tier ${e.position}'s price must be an amount above zero, like 157.00.`
          : e.message;
      const row = e.position === null ? undefined : byRow[e.position - 1];
      if (row) row.push(message);
      else ladder.push(message);
    }
  }
  return { tiers, ladder, rows: byRow, ok: result.ok };
}

/** The product form, as typed. */
export interface ProductFormValues {
  name: string;
  shortName: string;
  category: Category | '';
  packDescription: string;
  unitName: Unit;
  unitWeightText: string;
  buyAloneText: string;
  aliasesText: string;
  conversionsText: string;
  cadence: Cadence;
  anchorWeek: string;
  cutoffWeekday: string;
  cutoffTime: string;
  tiers: TierRow[];
}

export type ProductField = Exclude<keyof ProductFormValues, 'tiers'>;

export const NEW_PRODUCT_VALUES: ProductFormValues = {
  name: '',
  shortName: '',
  category: '',
  packDescription: '',
  unitName: 'carton',
  unitWeightText: '',
  buyAloneText: '',
  aliasesText: '',
  conversionsText: '',
  cadence: 'weekly',
  anchorWeek: '',
  cutoffWeekday: '4',
  cutoffTime: '20:00',
  tiers: [{ key: 'tier-0', minText: '', priceText: '' }],
};

export function formValuesFrom(p: SupplierProductView): ProductFormValues {
  return {
    name: p.name,
    shortName: p.shortName,
    category: p.category as Category,
    packDescription: p.packDescription,
    unitName: p.unitName as Unit,
    unitWeightText: String(p.unitWeightGrams),
    buyAloneText: senToRinggitInput(p.buyAlonePriceSen),
    aliasesText: p.aliases.join(', '),
    conversionsText: Object.entries(p.packConversions)
      .map(([unit, n]) => `${unit} = ${n}`)
      .join('\n'),
    cadence: p.cadence as Cadence,
    anchorWeek: p.scheduleAnchorWeek,
    cutoffWeekday: String(p.cutoffWeekday),
    cutoffTime: p.cutoffTime,
    tiers: tierRowsFrom(p.tiers),
  };
}

const ISO_WEEK = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function readConversions(text: string): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    const m = /^(.{1,50}?)\s*=\s*(\d{1,6})$/.exec(line);
    if (!m || Number(m[2]) < 1) return undefined;
    out[m[1]!.trim()] = Number(m[2]);
  }
  return out;
}

/** The form read into a product, or the message for each field that needs fixing. */
export function readProductForm(v: ProductFormValues): {
  input: ProductInput | null;
  errors: Partial<Record<ProductField, string>>;
  ladder: LadderCheck;
} {
  const errors: Partial<Record<ProductField, string>> = {};
  const required = (field: ProductField, text: string, label: string) => {
    if (text.trim() === '') errors[field] = `Enter ${label}.`;
  };
  required('name', v.name, 'the product name');
  required('shortName', v.shortName, 'a short name');
  required('packDescription', v.packDescription, 'what is in one pack');
  if (v.category === '') errors.category = 'Choose a category.';

  const weight = v.unitWeightText.trim();
  const unitWeightGrams = /^\d{1,7}$/.test(weight) ? Number(weight) : NaN;
  if (!(unitWeightGrams > 0)) errors.unitWeightText = 'Enter the weight in grams, like 19500.';

  const buyAlone = parseRinggitInput(v.buyAloneText);
  if (typeof buyAlone !== 'number') errors.buyAloneText = 'Enter an amount like 168.00.';

  const aliases = v.aliasesText
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a !== '');
  if (aliases.length > 20) errors.aliasesText = 'Use at most 20 other names.';
  else if (aliases.some((a) => a.length > 100)) errors.aliasesText = 'Keep each name short.';

  const packConversions = readConversions(v.conversionsText);
  if (!packConversions) errors.conversionsText = 'Write one per line, like: tin = 48';

  const anchor = v.anchorWeek.trim();
  if (anchor !== '' && !ISO_WEEK.test(anchor)) {
    errors.anchorWeek = 'Write the week like 2026-W45, or leave it empty.';
  }
  if (!TIME.test(v.cutoffTime)) errors.cutoffTime = 'Enter a time like 20:00.';

  const ladder = checkLadder(v.tiers, typeof buyAlone === 'number' ? buyAlone : null);
  if (Object.keys(errors).length > 0 || !ladder.ok || typeof buyAlone !== 'number') {
    return { input: null, errors, ladder };
  }
  return {
    input: {
      name: v.name.trim(),
      shortName: v.shortName.trim(),
      category: v.category as Category,
      packDescription: v.packDescription.trim(),
      unitName: v.unitName,
      unitWeightGrams,
      buyAlonePriceSen: buyAlone,
      aliases,
      packConversions: packConversions ?? {},
      cadence: v.cadence,
      ...(anchor === '' ? {} : { scheduleAnchorWeek: anchor }),
      cutoffWeekday: Number(v.cutoffWeekday),
      cutoffTime: v.cutoffTime,
      tiers: ladder.tiers,
    },
    errors,
    ladder,
  };
}

/** Only the fields that differ from the product as it is, so the log shows just the change. */
export function changedFields(input: ProductInput, p: SupplierProductView): Partial<ProductInput> {
  const before: ProductInput = {
    name: p.name,
    shortName: p.shortName,
    category: p.category as Category,
    packDescription: p.packDescription,
    unitName: p.unitName as Unit,
    unitWeightGrams: p.unitWeightGrams,
    buyAlonePriceSen: p.buyAlonePriceSen,
    aliases: p.aliases,
    packConversions: p.packConversions,
    cadence: p.cadence as Cadence,
    scheduleAnchorWeek: p.scheduleAnchorWeek,
    cutoffWeekday: p.cutoffWeekday,
    cutoffTime: p.cutoffTime,
    tiers: p.tiers.map((t) => ({ minQuantity: t.minQuantity, unitPriceSen: t.unitPriceSen })),
  };
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (JSON.stringify(value) !== JSON.stringify(before[key as keyof ProductInput])) {
      patch[key] = value;
    }
  }
  return patch as Partial<ProductInput>;
}
