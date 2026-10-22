import type { Cadence, ProductCategory, UnitName } from '@/generated/prisma/client';
import type { Tier } from '@/server/engine/types';
import type { SupplierKey } from './network';

export type ProductKey =
  | 'CM'
  | 'EM'
  | 'OIL'
  | 'FLOUR'
  | 'COFFEE'
  | 'TEA'
  | 'EGG_A'
  | 'EGG_B'
  | 'CUPS'
  | 'CONT'
  | 'BAGS'
  | 'KRAFT';

export interface SeedProduct {
  key: ProductKey;
  supplier: SupplierKey;
  name: string;
  shortName: string;
  category: ProductCategory;
  packDescription: string;
  unitName: UnitName;
  unitWeightGrams: number;
  buyAlonePriceSen: number;
  tiers: Tier[];
  cadence: Cadence;
  aliases: string[];
  packConversions: Record<string, number>;
}

const t = (minQuantity: number, unitPriceSen: number): Tier => ({ minQuantity, unitPriceSen });

export const FEE_BPS = 200;
export const CUTOFF_WEEKDAY = 4;
export const CUTOFF_TIME = '20:00';

export const PRODUCTS: readonly SeedProduct[] = [
  {
    key: 'CM',
    supplier: 'SUP_DRY',
    name: 'Sweetened condensed milk 390 g',
    shortName: 'condensed milk',
    category: 'dairy',
    packDescription: 'carton of 48 × 390 g tins',
    unitName: 'carton',
    unitWeightGrams: 19500,
    buyAlonePriceSen: 16800,
    tiers: [t(20, 15800), t(50, 15200), t(100, 14600)],
    cadence: 'weekly',
    aliases: ['susu pekat', '炼奶', 'SKM', 'susu pekat manis'],
    packConversions: { tin: 48 },
  },
  {
    key: 'EM',
    supplier: 'SUP_DRY',
    name: 'Evaporated milk 390 g',
    shortName: 'evaporated milk',
    category: 'dairy',
    packDescription: 'carton of 48 × 390 g tins',
    unitName: 'carton',
    unitWeightGrams: 19500,
    buyAlonePriceSen: 15000,
    tiers: [t(20, 14100), t(50, 13600), t(100, 13100)],
    cadence: 'weekly',
    aliases: ['susu cair', '淡奶', 'evap'],
    packConversions: { tin: 48 },
  },
  {
    key: 'OIL',
    supplier: 'SUP_DRY',
    name: 'Cooking oil (palm olein) 17 kg',
    shortName: 'cooking oil',
    category: 'oil',
    packDescription: '17 kg tin',
    unitName: 'tin',
    unitWeightGrams: 18000,
    buyAlonePriceSen: 11500,
    tiers: [t(20, 10800), t(50, 10400), t(100, 10000)],
    cadence: 'weekly',
    aliases: ['minyak', 'minyak masak', '油', 'palm oil'],
    packConversions: {},
  },
  {
    key: 'FLOUR',
    supplier: 'SUP_DRY',
    name: 'Wheat flour 25 kg',
    shortName: 'flour',
    category: 'flour',
    packDescription: '25 kg sack',
    unitName: 'sack',
    unitWeightGrams: 25000,
    buyAlonePriceSen: 6800,
    tiers: [t(20, 6300), t(50, 6050), t(100, 5800)],
    cadence: 'weekly',
    aliases: ['tepung', '面粉', 'tepung gandum'],
    packConversions: {},
  },
  {
    key: 'COFFEE',
    supplier: 'SUP_DRY',
    name: 'Coffee powder 1 kg',
    shortName: 'coffee powder',
    category: 'beverages',
    packDescription: 'carton of 10 × 1 kg packs',
    unitName: 'carton',
    unitWeightGrams: 10500,
    buyAlonePriceSen: 26000,
    tiers: [t(10, 24500), t(25, 23600), t(50, 22800)],
    cadence: 'weekly',
    aliases: ['kopi', '咖啡粉', 'serbuk kopi'],
    packConversions: { pack: 10 },
  },
  {
    key: 'TEA',
    supplier: 'SUP_DRY',
    name: 'Black tea dust 1 kg',
    shortName: 'tea dust',
    category: 'beverages',
    packDescription: 'carton of 10 × 1 kg packs',
    unitName: 'carton',
    unitWeightGrams: 10500,
    buyAlonePriceSen: 18000,
    tiers: [t(10, 17000), t(25, 16400), t(50, 15800)],
    cadence: 'weekly',
    aliases: ['teh', '茶', 'serbuk teh'],
    packConversions: { pack: 10 },
  },
  {
    key: 'EGG_A',
    supplier: 'SUP_EGG',
    name: 'Grade A eggs',
    shortName: 'Grade A eggs',
    category: 'eggs',
    packDescription: 'tray of 30 eggs',
    unitName: 'tray',
    unitWeightGrams: 1900,
    buyAlonePriceSen: 1320,
    tiers: [t(100, 1230), t(300, 1190), t(600, 1150)],
    cadence: 'weekly',
    aliases: ['telur A', '鸡蛋 A', 'gred A', 'telur gred A'],
    packConversions: {},
  },
  {
    key: 'EGG_B',
    supplier: 'SUP_EGG',
    name: 'Grade B eggs',
    shortName: 'Grade B eggs',
    category: 'eggs',
    packDescription: 'tray of 30 eggs',
    unitName: 'tray',
    unitWeightGrams: 1800,
    buyAlonePriceSen: 1260,
    tiers: [t(100, 1170), t(300, 1130), t(600, 1090)],
    cadence: 'weekly',
    aliases: ['telur B', '鸡蛋 B', 'gred B', 'telur gred B'],
    packConversions: {},
  },
  {
    key: 'CUPS',
    supplier: 'SUP_PACK',
    name: '16 oz plastic cups with lids',
    shortName: '16 oz cups',
    category: 'packaging',
    packDescription: 'carton of 1,000 cups with lids',
    unitName: 'carton',
    unitWeightGrams: 9000,
    buyAlonePriceSen: 13500,
    tiers: [t(10, 12400), t(25, 11800), t(50, 11200)],
    cadence: 'fortnightly',
    aliases: ['cawan 16oz', '16oz cups', '杯', 'cawan plastik'],
    packConversions: {},
  },
  {
    key: 'CONT',
    supplier: 'SUP_PACK',
    name: '650 ml takeaway containers',
    shortName: 'takeaway containers',
    category: 'packaging',
    packDescription: 'carton of 500 containers',
    unitName: 'carton',
    unitWeightGrams: 11000,
    buyAlonePriceSen: 9800,
    tiers: [t(10, 9000), t(25, 8600), t(50, 8200)],
    cadence: 'fortnightly',
    aliases: ['bekas tapau', '饭盒', 'container 650ml'],
    packConversions: {},
  },
  {
    key: 'BAGS',
    supplier: 'SUP_PACK',
    name: 'Plastic carrier bags (medium)',
    shortName: 'carrier bags',
    category: 'packaging',
    packDescription: 'carton of 50 packs',
    unitName: 'carton',
    unitWeightGrams: 10000,
    buyAlonePriceSen: 8500,
    tiers: [t(10, 7800), t(25, 7400), t(50, 7000)],
    cadence: 'fortnightly',
    aliases: ['beg plastik', '塑料袋'],
    packConversions: {},
  },
  {
    key: 'KRAFT',
    supplier: 'SUP_PACK',
    name: 'Kraft paper bags',
    shortName: 'paper bags',
    category: 'packaging',
    packDescription: 'carton of 1,000 bags',
    unitName: 'carton',
    unitWeightGrams: 12000,
    buyAlonePriceSen: 12000,
    tiers: [t(10, 11000), t(25, 10500), t(50, 10000)],
    cadence: 'fortnightly',
    aliases: ['beg kertas', '纸袋', 'kraft bag'],
    packConversions: {},
  },
];
