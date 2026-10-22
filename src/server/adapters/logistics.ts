import { randomUUID } from 'node:crypto';
import { roundHalfUpDiv } from '@/server/engine/money';

export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_KM = 6371.0;
const toRadians = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle (haversine) distance, rounded half-up to 0.1 km before any banding. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  const km = 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  return Math.round(km * 10) / 10;
}

/** Hub-to-pickup shipping rate, sen per kg. Band edges are inclusive at the upper end. */
export function shippingRatePerKgSen(km: number): 8 | 15 | 22 | 30 {
  if (km <= 60) return 8;
  if (km <= 200) return 15;
  if (km <= 400) return 22;
  return 30;
}

/** One unit's shipping share in sen: grams × (sen per kg) ÷ 1000, rounded half-up. */
export function unitShippingSen(unitWeightGrams: number, ratePerKgSen: number): number {
  return roundHalfUpDiv(unitWeightGrams * ratePerKgSen, 1000);
}

/** Pickup-point-to-shop door delivery fee in sen; null beyond 20 km (not available). */
export function deliveryFeeSen(km: number): 800 | 1200 | 1800 | null {
  if (km <= 5) return 800;
  if (km <= 10) return 1200;
  if (km <= 20) return 1800;
  return null;
}

export interface LogisticsPartner {
  quoteShipping(i: { hub: LatLng; pickupPoint: LatLng; unitWeightGrams: number }): {
    distanceKm: number;
    ratePerKgSen: number;
    unitShippingSen: number;
  };
  quoteDeliveryFee(i: { pickupPoint: LatLng; shop: LatLng }): {
    distanceKm: number;
    feeSen: number | null;
  };
  newConsignmentReference(): string;
}

export const simulatedLogistics: LogisticsPartner = {
  quoteShipping({ hub, pickupPoint, unitWeightGrams }) {
    const km = distanceKm(hub, pickupPoint);
    const ratePerKgSen = shippingRatePerKgSen(km);
    return {
      distanceKm: km,
      ratePerKgSen,
      unitShippingSen: unitShippingSen(unitWeightGrams, ratePerKgSen),
    };
  },
  quoteDeliveryFee({ pickupPoint, shop }) {
    const km = distanceKm(pickupPoint, shop);
    return { distanceKm: km, feeSen: deliveryFeeSen(km) };
  },
  newConsignmentReference() {
    return `SIM-${randomUUID().slice(0, 8).toUpperCase()}`;
  },
};
