export interface PickupPointView {
  id: string;
  name: string;
  address: string;
  state: string;
  lat: number;
  lng: number;
  openingHours: string;
  /** Straight-line distance from the caller's shop, in km; null when there is no shop to measure from. */
  distanceKm: number | null;
}

export interface ShopSettingsView {
  defaultFulfilment: 'pickup' | 'door';
  pickupPoint: PickupPointView | null;
  door: {
    nearestPickupPoint: PickupPointView;
    distanceKm: number;
    feeSen: number | null;
    available: boolean;
  };
  setupCompleted: boolean;
  /** Minutes a week ordering used to take, as the owner entered it; null until entered. */
  oldMinutesPerWeek: number | null;
}

/** What staff see: whether door delivery is available, but no money (R6). */
export interface StaffShopSettingsView extends Omit<ShopSettingsView, 'door'> {
  door: Omit<ShopSettingsView['door'], 'feeSen'>;
}
