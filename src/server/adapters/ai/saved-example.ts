import { seedId } from '../../../../prisma/seed/ids';
import type { ReadResult } from './types';

const id = (key: string) => seedId('product', key);

/** Index §5.6: the sample order as the assistant reads it. Used as the offline fallback in demo mode. */
export const SAVED_EXAMPLE: ReadResult = {
  lines: [
    {
      sourceText: '炼奶 6箱',
      productId: id('CM'),
      quantity: 6,
      unitAsWritten: '箱',
      confidence: 0.97,
      alternatives: [],
      note: null,
    },
    {
      sourceText: 'minyak masak 2 tin',
      productId: id('OIL'),
      quantity: 2,
      unitAsWritten: 'tin',
      confidence: 0.95,
      alternatives: [],
      note: null,
    },
    {
      sourceText: 'telur 10 papan',
      productId: id('EGG_A'),
      quantity: 10,
      unitAsWritten: 'papan',
      confidence: 0.55,
      alternatives: [id('EGG_B')],
      note: 'Grade A or Grade B eggs? Please check.',
    },
    {
      sourceText: 'kopi 1 ctn',
      productId: id('COFFEE'),
      quantity: 1,
      unitAsWritten: 'ctn',
      confidence: 0.93,
      alternatives: [],
      note: null,
    },
    {
      sourceText: 'cawan 16oz 2 ctn',
      productId: id('CUPS'),
      quantity: 2,
      unitAsWritten: 'ctn',
      confidence: 0.96,
      alternatives: [],
      note: null,
    },
  ],
  ignoredText: [
    'Hi boss, minggu ni order macam biasa ya 🙏',
    'Terima kasih! Kalau ada masalah call [phone removed]',
  ],
};
