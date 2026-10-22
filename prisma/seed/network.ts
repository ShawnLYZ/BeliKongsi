import type { ProductCategory, Role, SignInProvider } from '@/generated/prisma/client';
import type { SeedUserKey } from './ids';

export type HubKey = 'HUB_KV' | 'HUB_JOHOR';
export type PickupPointKey =
  'PP_IPOH' | 'PP_JB' | 'PP_KUANTAN' | 'PP_PJ' | 'PP_SEREMBAN' | 'PP_MELAKA';
export type SupplierKey = 'SUP_DRY' | 'SUP_EGG' | 'SUP_PACK';
export type DemoShopKey = 'KEDAI_KOPI' | 'GERAI' | 'KAFE';

export const HUBS: readonly {
  key: HubKey;
  name: string;
  region: string;
  address: string;
  lat: number;
  lng: number;
}[] = [
  {
    key: 'HUB_KV',
    name: 'Klang Valley hub (Shah Alam, Selangor)',
    region: 'Klang Valley',
    address: 'Shah Alam, Selangor',
    lat: 3.0738,
    lng: 101.5183,
  },
  {
    key: 'HUB_JOHOR',
    name: 'Johor hub (Senai, Johor)',
    region: 'Johor',
    address: 'Senai, Johor',
    lat: 1.6006,
    lng: 103.6419,
  },
];

export const PICKUP_OPENING_HOURS = '10 am–7 pm daily';

export const PICKUP_POINTS: readonly {
  key: PickupPointKey;
  name: string;
  address: string;
  state: string;
  postcode: string;
  lat: number;
  lng: number;
}[] = [
  {
    key: 'PP_IPOH',
    name: 'Ipoh pickup point',
    address: 'Ipoh, Perak',
    state: 'Perak',
    postcode: '30000',
    lat: 4.5975,
    lng: 101.0901,
  },
  {
    key: 'PP_JB',
    name: 'Johor Bahru pickup point',
    address: 'Johor Bahru, Johor',
    state: 'Johor',
    postcode: '80000',
    lat: 1.4927,
    lng: 103.7414,
  },
  {
    key: 'PP_KUANTAN',
    name: 'Kuantan pickup point',
    address: 'Kuantan, Pahang',
    state: 'Pahang',
    postcode: '25000',
    lat: 3.8077,
    lng: 103.326,
  },
  {
    key: 'PP_PJ',
    name: 'Petaling Jaya pickup point',
    address: 'Petaling Jaya, Selangor',
    state: 'Selangor',
    postcode: '46000',
    lat: 3.1073,
    lng: 101.6067,
  },
  {
    key: 'PP_SEREMBAN',
    name: 'Seremban pickup point',
    address: 'Seremban, Negeri Sembilan',
    state: 'Negeri Sembilan',
    postcode: '70000',
    lat: 2.7258,
    lng: 101.9424,
  },
  {
    key: 'PP_MELAKA',
    name: 'Melaka pickup point',
    address: 'Melaka, Melaka',
    state: 'Melaka',
    postcode: '75000',
    lat: 2.1896,
    lng: 102.2501,
  },
];

export const SUPPLIERS: readonly {
  key: SupplierKey;
  name: string;
  hub: HubKey;
  region: string;
  categories: ProductCategory[];
  contactName: string;
  contactPhone: string;
}[] = [
  {
    key: 'SUP_DRY',
    name: 'Pembekal Barang Kering Contoh',
    hub: 'HUB_KV',
    region: 'Klang Valley',
    categories: ['dairy', 'oil', 'flour', 'beverages'],
    contactName: 'Farid',
    contactPhone: '012-300 0001',
  },
  {
    key: 'SUP_EGG',
    name: 'Ladang Telur Contoh',
    hub: 'HUB_JOHOR',
    region: 'Johor',
    categories: ['eggs'],
    contactName: 'Lim',
    contactPhone: '012-300 0002',
  },
  {
    key: 'SUP_PACK',
    name: 'Pembungkusan Contoh',
    hub: 'HUB_KV',
    region: 'Klang Valley',
    categories: ['packaging'],
    contactName: 'Priya',
    contactPhone: '012-300 0003',
  },
];

export const OPERATOR = { key: 'OPS', name: 'BeliKongsi Operations' } as const;

export type SeedMembershipTarget =
  | { orgType: 'shop'; shop: DemoShopKey }
  | { orgType: 'supplier'; supplier: SupplierKey }
  | { orgType: 'operator' };

/** One user and their single membership. The membership key is the user key. */
export interface SeedUser {
  key: SeedUserKey;
  displayName: string;
  // Staff are stored as a name and role only (PRD �4): no contact or sign-in details.
  email: string | null;
  phone: string | null;
  signInProvider: SignInProvider | null;
  role: Role;
  target: SeedMembershipTarget;
}

export const SEED_USERS: readonly SeedUser[] = [
  {
    key: 'ahSeng',
    displayName: 'Ah Seng',
    email: 'ah.seng@contoh.example',
    phone: '012-200 0001',
    signInProvider: 'microsoft',
    role: 'owner',
    target: { orgType: 'shop', shop: 'KEDAI_KOPI' },
  },
  {
    key: 'rahim',
    displayName: 'Rahim',
    email: null,
    phone: null,
    signInProvider: null,
    role: 'staff',
    target: { orgType: 'shop', shop: 'KEDAI_KOPI' },
  },
  {
    key: 'siti',
    displayName: 'Siti',
    email: 'siti@contoh.example',
    phone: '012-200 0003',
    signInProvider: 'google',
    role: 'owner',
    target: { orgType: 'shop', shop: 'GERAI' },
  },
  {
    key: 'kumar',
    displayName: 'Kumar',
    email: null,
    phone: null,
    signInProvider: null,
    role: 'staff',
    target: { orgType: 'shop', shop: 'GERAI' },
  },
  {
    key: 'mei',
    displayName: 'Mei',
    email: 'mei@contoh.example',
    phone: '012-200 0005',
    signInProvider: 'google',
    role: 'owner',
    target: { orgType: 'shop', shop: 'KAFE' },
  },
  {
    key: 'danial',
    displayName: 'Danial',
    email: null,
    phone: null,
    signInProvider: null,
    role: 'staff',
    target: { orgType: 'shop', shop: 'KAFE' },
  },
  {
    key: 'farid',
    displayName: 'Farid',
    email: 'farid@contoh.example',
    phone: '012-300 0001',
    signInProvider: 'microsoft',
    role: 'supplier',
    target: { orgType: 'supplier', supplier: 'SUP_DRY' },
  },
  {
    key: 'lim',
    displayName: 'Lim',
    email: 'lim@contoh.example',
    phone: '012-300 0002',
    signInProvider: 'microsoft',
    role: 'supplier',
    target: { orgType: 'supplier', supplier: 'SUP_EGG' },
  },
  {
    key: 'priya',
    displayName: 'Priya',
    email: 'priya@contoh.example',
    phone: '012-300 0003',
    signInProvider: 'microsoft',
    role: 'supplier',
    target: { orgType: 'supplier', supplier: 'SUP_PACK' },
  },
  {
    key: 'nadia',
    displayName: 'Nadia',
    email: 'nadia@contoh.example',
    phone: '012-400 0001',
    signInProvider: 'microsoft',
    role: 'ops',
    target: { orgType: 'operator' },
  },
];
