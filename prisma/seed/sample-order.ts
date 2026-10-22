/** The sample order text shared by the fake AI adapter, "Try with sample data" and the e2e test. */
export const SAMPLE_ORDER_TEXT = [
  'Hi boss, minggu ni order macam biasa ya 🙏',
  '炼奶 6箱',
  'minyak masak 2 tin',
  'telur 10 papan',
  'kopi 1 ctn',
  'cawan 16oz 2 ctn',
  'Terima kasih! Kalau ada masalah call 012-345 6789',
].join('\n');

/** Usual prices (sen) offered with the sample order, by product key. */
export const SAMPLE_USUAL_PRICES_SEN = {
  CM: 16500,
  OIL: 11800,
  EGG_A: 1380,
  EGG_B: 1320,
  COFFEE: 26200,
  CUPS: 13500,
} as const;
