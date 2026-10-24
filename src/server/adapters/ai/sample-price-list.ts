import { seedId } from '../../../../prisma/seed/ids';
import type { PriceListLine, PriceListResult } from './types';

const id = (key: string) => seedId('product', key);

const line = (over: Partial<PriceListLine> & Pick<PriceListLine, 'sourceText'>): PriceListLine => ({
  productId: null,
  proposedName: null,
  packDescription: null,
  unitName: null,
  buyAlonePriceSen: null,
  tiers: [],
  confidence: 0.95,
  note: null,
  ...over,
});

/**
 * Made-up data: the sample price list (SAMPLE_PRICE_LIST_TEXT) as the assistant reads it, so the
 * demo's fake AI drafts something. Prices are copied as written, so the cooking oil ladder that
 * goes up is kept for the supplier to fix.
 */
export const SAMPLE_PRICE_LIST_RESULT: PriceListResult = {
  lines: [
    line({
      sourceText: 'Susu pekat manis 390g (48 tin/ctn) - harga sendiri RM168',
      productId: id('CM'),
      unitName: 'carton',
      buyAlonePriceSen: 16800,
      tiers: [
        { minQuantity: 20, unitPriceSen: 15700 },
        { minQuantity: 50, unitPriceSen: 15100 },
        { minQuantity: 100, unitPriceSen: 14500 },
      ],
      confidence: 0.97,
    }),
    line({
      sourceText: 'Susu cair 390g (48 tin/ctn) - harga sendiri RM150',
      productId: id('EM'),
      unitName: 'carton',
      buyAlonePriceSen: 15000,
      tiers: [
        { minQuantity: 20, unitPriceSen: 14100 },
        { minQuantity: 50, unitPriceSen: 13600 },
        { minQuantity: 100, unitPriceSen: 13100 },
      ],
      confidence: 0.96,
    }),
    line({
      sourceText: 'Tepung gandum 25kg (guni) - harga sendiri RM68',
      productId: id('FLOUR'),
      unitName: 'sack',
      buyAlonePriceSen: 6800,
      tiers: [
        { minQuantity: 20, unitPriceSen: 6300 },
        { minQuantity: 50, unitPriceSen: 6050 },
        { minQuantity: 100, unitPriceSen: 5800 },
      ],
    }),
    line({
      sourceText: 'Minyak masak 17kg (tin) - harga sendiri RM115',
      productId: id('OIL'),
      unitName: 'tin',
      buyAlonePriceSen: 11500,
      tiers: [
        { minQuantity: 20, unitPriceSen: 10000 },
        { minQuantity: 50, unitPriceSen: 12000 },
      ],
      confidence: 0.9,
      note: 'The 50-tin price is higher than the 20-tin price. Please check.',
    }),
    line({
      sourceText: 'BARU: Gula pasir halus 50kg (guni) - harga sendiri RM190',
      proposedName: 'Gula pasir halus 50 kg',
      packDescription: 'sack of 50 kg',
      unitName: 'sack',
      buyAlonePriceSen: 19000,
      tiers: [
        { minQuantity: 10, unitPriceSen: 18000 },
        { minQuantity: 30, unitPriceSen: 17200 },
      ],
      confidence: 0.88,
      note: 'Not in your catalogue yet.',
    }),
  ],
  ignoredText: [
    'PEMBEKAL BARANG KERING CONTOH',
    'Senarai harga borong / Wholesale price list',
    'Berkuat kuasa minggu depan. Hubungi [phone removed] untuk tempahan.',
    'Harga tidak termasuk penghantaran. Terima kasih!',
  ],
};
