import { expect, it } from 'vitest';
import {
  deliveryFeeSen,
  distanceKm,
  shippingRatePerKgSen,
  simulatedLogistics,
  type LatLng,
} from '@/server/adapters/logistics';
import { HUBS, PICKUP_POINTS } from '../../prisma/seed/network';
import { DEMO_SHOPS } from '../../prisma/seed/shops';

const at = (list: readonly { key: string; lat: number; lng: number }[], key: string): LatLng => {
  const x = list.find((i) => i.key === key)!;
  return { lat: x.lat, lng: x.lng };
};
const HUB_KV = at(HUBS, 'HUB_KV');
const HUB_JOHOR = at(HUBS, 'HUB_JOHOR');
const PP_IPOH = at(PICKUP_POINTS, 'PP_IPOH');
const PP_JB = at(PICKUP_POINTS, 'PP_JB');
const PP_KUANTAN = at(PICKUP_POINTS, 'PP_KUANTAN');
const GERAI = at(DEMO_SHOPS, 'GERAI');

it('measures one degree of longitude at the equator', () =>
  expect(distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBe(111.2));
it('rounds once, so a raw 20.0495 km stays 20.0 and inside the door-delivery limit', () => {
  // 20.0495 km along a meridian: degrees = km / (R * pi / 180).
  const deg = 20.0495 / ((6371.0 * Math.PI) / 180);
  const km = distanceKm({ lat: 0, lng: 0 }, { lat: deg, lng: 0 });
  expect(km).toBe(20.0);
  expect(deliveryFeeSen(km)).toBe(1800);
});
it.each([
  [60.0, 8],
  [60.1, 15],
  [200.0, 15],
  [200.1, 22],
  [400.0, 22],
  [400.1, 30],
])('rate band at %s km', (km, rate) => expect(shippingRatePerKgSen(km)).toBe(rate));
it.each([
  [5.0, 800],
  [5.1, 1200],
  [10.0, 1200],
  [20.0, 1800],
  [20.1, null],
])('delivery fee at %s km', (km, fee) => expect(deliveryFeeSen(km)).toBe(fee));
it('reproduces the PRD shipping shares from the seed coordinates (C9)', () => {
  const cm = (pp: LatLng) =>
    simulatedLogistics.quoteShipping({ hub: HUB_KV, pickupPoint: pp, unitWeightGrams: 19500 })
      .unitShippingSen;
  expect([cm(PP_IPOH), cm(PP_JB), cm(PP_KUANTAN)]).toEqual([293, 429, 429]);
  expect(
    simulatedLogistics.quoteShipping({
      hub: HUB_JOHOR,
      pickupPoint: PP_KUANTAN,
      unitWeightGrams: 1800,
    }).unitShippingSen,
  ).toBe(40);
});
it('quotes Gerai Contoh door delivery at RM 12.00', () => {
  const q = simulatedLogistics.quoteDeliveryFee({ pickupPoint: PP_JB, shop: GERAI });
  expect(q.feeSen).toBe(1200);
  expect(q.distanceKm).toBeGreaterThan(5);
  expect(q.distanceKm).toBeLessThanOrEqual(10);
});
