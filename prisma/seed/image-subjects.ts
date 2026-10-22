import type { ProductKey } from './catalogue';

/** The PRD §17 "[pack description]" for each product, extended with the product itself. */
export const IMAGE_SUBJECTS: Record<ProductKey, string> = {
  CM: 'carton of 48 tins of sweetened condensed milk',
  EM: 'carton of 48 tins of evaporated milk',
  OIL: '17 kg metal tin of cooking oil',
  FLOUR: '25 kg sack of wheat flour',
  COFFEE: 'carton of ten 1 kg packs of ground coffee',
  TEA: 'carton of ten 1 kg packs of black tea dust',
  EGG_A: 'tray of 30 large brown eggs',
  EGG_B: 'tray of 30 medium brown eggs',
  CUPS: 'carton of 16 oz clear plastic cups with lids',
  CONT: 'carton of 650 ml plastic takeaway containers',
  BAGS: 'carton of medium plastic carrier bags',
  KRAFT: 'carton of brown kraft paper bags',
};

/** PRD §17 prompt template. */
export const imagePrompt = (subject: string): string =>
  `Studio product photo of a plain, unbranded ${subject} on a white background, soft lighting, no text, no logos, no brand names.`;

/** Where a product's compressed picture is stored: `<key lowercased>.webp`. */
export const imageKeyFor = (key: ProductKey): string => `${key.toLowerCase()}.webp`;

/** Approved seeds that differ from the generator default (7000 + catalogue index). */
export const IMAGE_SEEDS: Partial<Record<ProductKey, number>> = { CM: 8500, EM: 8500 };
