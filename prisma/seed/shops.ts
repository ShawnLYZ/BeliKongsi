import type { Fulfilment, ShopType } from '@/generated/prisma/client';
import type { ProductKey } from './catalogue';
import { PICKUP_POINTS, type DemoShopKey, type PickupPointKey } from './network';

export interface SeedShop {
  key: string;
  name: string;
  type: ShopType;
  address: string;
  state: string;
  postcode: string;
  lat: number;
  lng: number;
  fulfilment: Fulfilment;
  /** Set when the shop collects from a pickup point. */
  pickupPoint: PickupPointKey | null;
  isBackground: boolean;
  /** False only for Kedai Kopi Contoh: the demo starts with its setup. */
  setupDone: boolean;
}

export const DEMO_SHOPS: readonly (SeedShop & { key: DemoShopKey })[] = [
  {
    key: 'KEDAI_KOPI',
    name: 'Kedai Kopi Contoh',
    type: 'kopitiam',
    address: 'Jalan Contoh 1, Ipoh',
    state: 'Perak',
    postcode: '30000',
    lat: 4.6005,
    lng: 101.079,
    fulfilment: 'pickup',
    pickupPoint: 'PP_IPOH',
    isBackground: false,
    setupDone: false,
  },
  {
    key: 'GERAI',
    name: 'Gerai Contoh',
    type: 'hawker',
    address: 'Jalan Contoh 2, Johor Bahru',
    state: 'Johor',
    postcode: '80000',
    lat: 1.5407,
    lng: 103.7664,
    fulfilment: 'door',
    pickupPoint: null,
    isBackground: false,
    setupDone: true,
  },
  {
    key: 'KAFE',
    name: 'Kafe Contoh',
    type: 'cafe',
    address: 'Jalan Contoh 3, Kuantan',
    state: 'Pahang',
    postcode: '25000',
    lat: 3.816,
    lng: 103.327,
    fulfilment: 'pickup',
    pickupPoint: 'PP_KUANTAN',
    isBackground: false,
    setupDone: true,
  },
];

const BACKGROUND_TYPES: readonly { type: ShopType; label: string }[] = [
  { type: 'kopitiam', label: 'Kopitiam Contoh' },
  { type: 'hawker', label: 'Warung Contoh' },
  { type: 'cafe', label: 'Kafe Kecil Contoh' },
  { type: 'restaurant', label: 'Restoran Contoh' },
  { type: 'bakery', label: 'Bakeri Contoh' },
];

const BACKGROUND_REGIONS: readonly PickupPointKey[] = [
  'PP_IPOH',
  'PP_JB',
  'PP_KUANTAN',
  'PP_PJ',
  'PP_SEREMBAN',
  'PP_MELAKA',
];

export const BACKGROUND_SHOP_COUNT = 40;

function backgroundShop(nn: number): SeedShop {
  const kind = BACKGROUND_TYPES[(nn - 1) % BACKGROUND_TYPES.length]!;
  const regionKey = BACKGROUND_REGIONS[(nn - 1) % BACKGROUND_REGIONS.length]!;
  const region = PICKUP_POINTS.find((p) => p.key === regionKey)!;
  const door = nn % 5 === 0;
  const label = String(nn).padStart(2, '0');
  return {
    key: `BG${label}`,
    name: `${kind.label} ${label}`,
    type: kind.type,
    address: `Jalan Contoh ${nn + 10}, ${region.address}`,
    state: region.state,
    postcode: region.postcode,
    lat: region.lat + 0.01 * (nn % 4),
    lng: region.lng + 0.01 * (nn % 3),
    fulfilment: door ? 'door' : 'pickup',
    pickupPoint: door ? null : regionKey,
    isBackground: true,
    setupDone: true,
  };
}

export const BACKGROUND_SHOPS: readonly SeedShop[] = Array.from(
  { length: BACKGROUND_SHOP_COUNT },
  (_, i) => backgroundShop(i + 1),
);

/**
 * Designed background quantities per current-week round, in join order (index §5.7). Walking the
 * rounds in this order, the k-th quantity overall goes to background shop `(k mod 40) + 1`.
 * Used by the current-week seed (M4).
 */
export const BACKGROUND_QUANTITIES: readonly { product: ProductKey; quantities: number[] }[] = [
  { product: 'CM', quantities: [20, 18, 16, 14, 12, 12] },
  { product: 'EM', quantities: [10, 9, 8, 7, 6, 6, 5, 4] },
  { product: 'OIL', quantities: [14, 12, 11, 10, 10, 9, 9, 8, 7, 6, 4, 4] },
  { product: 'FLOUR', quantities: [8, 6, 5, 4] },
  { product: 'COFFEE', quantities: [7, 6, 5, 4, 3, 2] },
  { product: 'TEA', quantities: [4, 2] },
  { product: 'EGG_A', quantities: [40, 35, 30, 28, 26, 25, 24, 22, 20, 18, 16, 14, 12, 10] },
  { product: 'EGG_B', quantities: [20, 18, 15, 14, 12, 11, 10, 8, 7, 5] },
  { product: 'CUPS', quantities: [6, 5, 5, 4, 3, 3] },
  { product: 'CONT', quantities: [4, 3, 3, 2] },
  { product: 'BAGS', quantities: [9, 8, 7, 6, 6, 5, 4, 3, 3] },
  { product: 'KRAFT', quantities: [] },
];

export interface SeedUsualItem {
  product: ProductKey;
  quantity: number;
  /** The usual price in sen; the price limit defaults to it. */
  usualPriceSen: number;
}

/** Usual lists at reset. Kedai Kopi has none: the demo starts with its setup. */
export const USUAL_LISTS: Readonly<Record<'GERAI' | 'KAFE', readonly SeedUsualItem[]>> = {
  GERAI: [
    { product: 'CM', quantity: 4, usualPriceSen: 16800 },
    { product: 'EM', quantity: 2, usualPriceSen: 15000 },
    { product: 'FLOUR', quantity: 2, usualPriceSen: 7200 },
    { product: 'CONT', quantity: 3, usualPriceSen: 9800 },
  ],
  KAFE: [
    { product: 'CM', quantity: 3, usualPriceSen: 16700 },
    { product: 'EGG_B', quantity: 10, usualPriceSen: 1220 },
    { product: 'COFFEE', quantity: 2, usualPriceSen: 25800 },
    { product: 'CUPS', quantity: 3, usualPriceSen: 13200 },
  ],
};
