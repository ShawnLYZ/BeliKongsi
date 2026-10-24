import { describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { SAMPLE_PRICE_LIST_TEXT } from '../../prisma/seed/sample-price-list';
import type { PriceListParseView, SupplierProductView } from '@/lib/views/supplier';
import { createFakeOrderReader } from '@/server/adapters/ai/fake';
import { redactPersonalData } from '@/server/adapters/ai/redact';
import {
  clashingLines,
  confirmLines,
  laterDuplicates,
  lineProblems,
  reviewLinesFrom,
} from '@/components/supplier/price-list-draft';
import {
  changedFields,
  checkLadder,
  formValuesFrom,
  readProductForm,
  tierRowsFrom,
  type TierRow,
} from '@/components/supplier/product-draft';

const CM = seedId('product', 'CM');
const OIL = seedId('product', 'OIL');

const rows = (...pairs: [string, string][]): TierRow[] =>
  pairs.map(([minText, priceText], i) => ({ key: `r${i}`, minText, priceText }));

const CONDENSED_MILK: SupplierProductView = {
  productId: CM,
  name: 'Sweetened condensed milk 390 g',
  shortName: 'condensed milk',
  category: 'dairy',
  packDescription: 'carton of 48 × 390 g tins',
  unitName: 'carton',
  unitWeightGrams: 19500,
  buyAlonePriceSen: 16800,
  tiers: [
    { position: 1, minQuantity: 20, unitPriceSen: 15800 },
    { position: 2, minQuantity: 50, unitPriceSen: 15200 },
    { position: 3, minQuantity: 100, unitPriceSen: 14600 },
  ],
  aliases: ['susu pekat', 'SKM'],
  packConversions: { tin: 48 },
  cadence: 'weekly',
  scheduleAnchorWeek: '2026-W45',
  cutoffWeekday: 4,
  cutoffTime: '20:00',
  active: true,
  imageUrl: null,
  imageAiGenerated: false,
  nextRoundCutoffAt: '2026-11-12T12:00:00.000Z',
};

describe('the tier editor check', () => {
  it('puts a price that does not fall next to its own row', () => {
    const check = checkLadder(rows(['20', '157.00'], ['50', '160.00']), 16800);
    expect(check.ok).toBe(false);
    expect(check.rows[0]).toEqual([]);
    expect(check.rows[1]).toEqual(["Tier 2's price must be less than tier 1's."]);
    expect(check.ladder).toEqual([]);
  });

  it('puts a whole-ladder problem above the rows', () => {
    const six = rows(
      ...Array.from({ length: 6 }, (_, i) => [`${(i + 1) * 10}`, `${100 - i}`] as [string, string]),
    );
    expect(checkLadder(six, 16800).ladder).toEqual(['A product needs between 1 and 5 tiers.']);
  });

  it('refuses a tier at or above the buy-alone price', () => {
    expect(checkLadder(rows(['20', '168.00']), 16800).rows[0]).toEqual([
      "Tier 1's price must be below the buy-alone price.",
    ]);
  });

  it('asks for an amount when a price cannot be read', () => {
    expect(checkLadder(rows(['20', 'abc']), 16800).rows[0]).toEqual([
      "Tier 1's price must be an amount above zero, like 157.00.",
    ]);
  });
});

describe('the product form', () => {
  it('sends only the tiers when only the tiers changed', () => {
    const values = formValuesFrom(CONDENSED_MILK);
    values.tiers = rows(['20', '157.00'], ['50', '151.00'], ['100', '145.00']);
    const { input } = readProductForm(values);
    expect(changedFields(input!, CONDENSED_MILK)).toEqual({
      tiers: [
        { minQuantity: 20, unitPriceSen: 15700 },
        { minQuantity: 50, unitPriceSen: 15100 },
        { minQuantity: 100, unitPriceSen: 14500 },
      ],
    });
  });

  it('names each field that is missing and builds nothing', () => {
    const values = formValuesFrom(CONDENSED_MILK);
    values.name = ' ';
    values.unitWeightText = 'heavy';
    values.conversionsText = 'tin 48';
    const read = readProductForm(values);
    expect(read.input).toBeNull();
    expect(read.errors).toEqual({
      name: 'Enter the product name.',
      unitWeightText: 'Enter the weight in grams, like 19500.',
      conversionsText: 'Write one per line, like: tin = 48',
    });
  });
});

describe('the demo price list', () => {
  it('drafts the condensed milk ladder from the sample with the fake AI', async () => {
    const reader = createFakeOrderReader();
    const result = await reader.readPriceList({
      text: redactPersonalData(SAMPLE_PRICE_LIST_TEXT).text,
      products: [],
    });
    expect(result.lines.find((l) => l.productId === CM)?.tiers).toEqual([
      { minQuantity: 20, unitPriceSen: 15700 },
      { minQuantity: 50, unitPriceSen: 15100 },
      { minQuantity: 100, unitPriceSen: 14500 },
    ]);
  });
});

describe('the price-list review', () => {
  const view: PriceListParseView = {
    suggestionRunId: '00000000-0000-4000-8000-000000000001',
    model: 'fake',
    ignoredText: [],
    lines: [
      {
        sourceText: 'Susu pekat manis',
        productId: CM,
        proposedName: null,
        packDescription: null,
        unitName: 'carton',
        buyAlonePriceSen: 16800,
        tiers: [{ minQuantity: 20, unitPriceSen: 15700 }],
        confidence: 0.97,
        note: null,
        errors: [],
        current: {
          name: 'Sweetened condensed milk 390 g',
          packDescription: 'carton',
          unitName: 'carton',
          buyAlonePriceSen: 16800,
          tiers: [{ minQuantity: 20, unitPriceSen: 15800 }],
        },
      },
      {
        sourceText: 'Minyak masak',
        productId: OIL,
        proposedName: null,
        packDescription: null,
        unitName: 'tin',
        buyAlonePriceSen: 11500,
        tiers: [
          { minQuantity: 20, unitPriceSen: 10000 },
          { minQuantity: 50, unitPriceSen: 12000 },
        ],
        confidence: 0.9,
        note: null,
        errors: [
          {
            code: 'PRICE_NOT_DECREASING',
            position: 2,
            message: "Tier 2's price must be less than tier 1's.",
          },
        ],
        current: null,
      },
      {
        sourceText: 'BARU: Gula',
        productId: null,
        proposedName: 'Gula pasir halus 50 kg',
        packDescription: 'sack of 50 kg',
        unitName: 'sack',
        buyAlonePriceSen: 19000,
        tiers: [{ minQuantity: 10, unitPriceSen: 18000 }],
        confidence: 0.88,
        note: null,
        errors: [],
        current: null,
      },
    ],
  };

  it('keeps matched lines and leaves new-product drafts out to start with', () => {
    expect(reviewLinesFrom(view).map((l) => l.included)).toEqual([true, true, false]);
  });

  it('leaves a second line for the same product unticked and blocks saving both', () => {
    const twice = { ...view, lines: [view.lines[0]!, { ...view.lines[0]!, sourceText: 'Susu' }] };
    const lines = reviewLinesFrom(twice);
    expect(lines.map((l) => l.included)).toEqual([true, false]);
    expect([...laterDuplicates(lines)]).toEqual(['line-1']);
    expect(clashingLines(lines).size).toBe(0);
    const both = lines.map((l) => ({ ...l, included: true }));
    expect([...clashingLines(both)]).toEqual(['line-1']);
  });

  it('shows the server problem next to its tier until the line is fixed', () => {
    const [, oil] = reviewLinesFrom(view);
    expect(lineProblems(oil!).rows).toEqual([[], ["Tier 2's price must be less than tier 1's."]]);
    const fixed = {
      ...oil!,
      edited: true,
      tiers: tierRowsFrom([
        { minQuantity: 20, unitPriceSen: 10000 },
        { minQuantity: 50, unitPriceSen: 9800 },
      ]),
    };
    expect(lineProblems(fixed).ok).toBe(true);
    expect(confirmLines([fixed])).toEqual([
      {
        productId: OIL,
        patch: {
          tiers: [
            { minQuantity: 20, unitPriceSen: 10000 },
            { minQuantity: 50, unitPriceSen: 9800 },
          ],
          buyAlonePriceSen: 11500,
        },
      },
    ]);
  });

  it('asks for the new product details once a new product is ticked', () => {
    const sugar = { ...reviewLinesFrom(view)[2]!, included: true };
    expect(lineProblems(sugar).fields).toEqual({
      shortName: 'Enter a short name.',
      category: 'Choose a category.',
      unitWeightText: 'Enter the weight in grams, like 50000.',
    });
  });
});
