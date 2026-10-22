import { describe, expect, it } from 'vitest';
import { SAVED_EXAMPLE } from '@/server/adapters/ai/saved-example';
import { SAMPLE_USUAL_PRICES_SEN } from '../../prisma/seed/sample-order';
import { seedId } from '../../prisma/seed/ids';
import type { ParseView } from '@/lib/views/usual-list';
import { parseRinggitInput, senToRinggitInput } from '@/lib/money-input';
import { timeLeft } from '@/components/rounds/countdown';
import {
  addedLine,
  chooseProduct,
  draftLinesFromParse,
  toSaveItems,
  validateLines,
} from '@/components/setup/review-lines';

const id = (key: string) => seedId('product', key);
const product = (key: string, name: string) => ({
  id: id(key),
  name,
  packDescription: 'pack',
  unitName: 'carton',
  imageUrl: null,
});

/** The sample order as the parse endpoint returns it (fields the review list reads). */
const parse: ParseView = {
  suggestionRunId: '00000000-0000-4000-8000-000000000001',
  model: 'fake',
  source: 'ai',
  ignoredText: SAVED_EXAMPLE.ignoredText,
  lines: [
    {
      sourceText: '炼奶 6箱',
      product: product('CM', 'Sweetened condensed milk 390 g'),
      quantity: 6,
      unitAsWritten: '箱',
      confidence: 0.97,
      alternatives: [],
      note: null,
      status: 'ok',
      samplePriceSen: SAMPLE_USUAL_PRICES_SEN.CM,
    },
    {
      sourceText: 'telur 10 papan',
      product: product('EGG_A', 'Grade A eggs'),
      quantity: 10,
      unitAsWritten: 'papan',
      confidence: 0.55,
      alternatives: [{ id: id('EGG_B'), name: 'Grade B eggs', packDescription: 'tray of 30' }],
      note: 'Grade A or Grade B eggs? Please check.',
      status: 'check',
      samplePriceSen: SAMPLE_USUAL_PRICES_SEN.EGG_A,
    },
    {
      sourceText: 'gula 2 bag',
      product: null,
      quantity: 2,
      unitAsWritten: 'bag',
      confidence: 0.2,
      alternatives: [],
      note: null,
      status: 'not_found',
    },
  ],
};

describe('ringgit input', () => {
  it('reads typed amounts as whole sen', () => {
    expect(parseRinggitInput('165')).toBe(16500);
    expect(parseRinggitInput('165.5')).toBe(16550);
    expect(parseRinggitInput('RM 1,165.05')).toBe(116505);
    expect(parseRinggitInput('0.29')).toBe(29);
    expect(parseRinggitInput('  ')).toBeNull();
    expect(parseRinggitInput('0')).toBeUndefined();
    expect(parseRinggitInput('1.234')).toBeUndefined();
    expect(parseRinggitInput('abc')).toBeUndefined();
    expect(parseRinggitInput('-5')).toBeUndefined();
  });
  it('pre-fills amounts from sen', () => {
    expect(senToRinggitInput(16500)).toBe('165.00');
    expect(senToRinggitInput(1380)).toBe('13.80');
    expect(senToRinggitInput(5)).toBe('0.05');
    expect(senToRinggitInput(null)).toBe('');
  });
});

describe('setup review lines', () => {
  it('pre-fills sample prices and leaves "Please check" lines unchosen', () => {
    const [cm, eggs, sugar] = draftLinesFromParse(parse);
    expect(cm).toMatchObject({ status: 'ok', priceText: '165.00', priceIsSample: true });
    expect(cm!.product?.id).toBe(id('CM'));
    expect(eggs!.status).toBe('check');
    expect(eggs!.product).toBeNull();
    expect(eggs!.choices.map((c) => c.id)).toEqual([id('EGG_A'), id('EGG_B')]);
    expect(sugar).toMatchObject({ status: 'not_found', product: null });
  });

  it('needs a choice on "Please check" lines and leaves "Not found" lines out', () => {
    const lines = draftLinesFromParse(parse);
    const errors = validateLines(lines);
    expect([...errors.keys()]).toEqual([lines[1]!.key]);
    expect(errors.get(lines[1]!.key)?.product).toMatch(/Choose/);

    const chosen = lines.map((l) => (l.status === 'check' ? chooseProduct(l, l.choices[0]!) : l));
    expect(validateLines(chosen).size).toBe(0);
    expect(toSaveItems(chosen)).toEqual([
      { productId: id('CM'), quantity: 6, usualPriceSen: 16500 },
      { productId: id('EGG_A'), quantity: 10, usualPriceSen: 1380 },
    ]);
  });

  it('keeps the sample price only for the product it belongs to', () => {
    const eggs = draftLinesFromParse(parse)[1]!;
    const gradeB = chooseProduct(eggs, eggs.choices[1]!);
    expect(gradeB).toMatchObject({ priceText: '', priceIsSample: false });
    const backToA = chooseProduct(gradeB, eggs.choices[0]!);
    expect(backToA).toMatchObject({ priceText: '13.80', priceIsSample: true });
  });

  it('flags a product listed twice and bad amounts', () => {
    const [cm] = draftLinesFromParse(parse);
    const twice = addedLine(
      { id: id('CM'), name: 'Sweetened condensed milk 390 g', packDescription: 'pack' },
      'a1',
    );
    const bad = {
      ...cm!,
      key: 'x',
      product: { ...cm!.product!, id: id('OIL') },
      quantity: 0,
      priceText: '1.234',
    };
    const errors = validateLines([cm!, twice, bad]);
    expect(errors.get('a1')?.product).toMatch(/already on your list/);
    expect(errors.get('x')).toMatchObject({
      quantity: expect.any(String),
      price: expect.any(String),
    });
  });
});

describe('countdown', () => {
  it('says how long is left', () => {
    const minute = 60_000;
    expect(timeLeft(((2 * 24 + 4) * 60 + 30) * minute)).toBe('2 days 4 hours left');
    expect(timeLeft((3 * 60 + 5) * minute)).toBe('3 hours 5 minutes left');
    expect(timeLeft(3 * 60 * minute + 30_000)).toBe('3 hours left');
    expect(timeLeft(30_000)).toBe('1 minute left');
    expect(timeLeft(1 * minute)).toBe('1 minute left');
    expect(timeLeft(0)).toBe('Cut-off has passed');
  });
});
