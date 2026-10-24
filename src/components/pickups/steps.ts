import type { PickupStatusLabel, PickupStatusView, PickupView } from '@/lib/views/pickups';

/** Story 71's steps, in order, for each way of getting the goods. */
const STEPS: Record<PickupView['destinationType'], readonly PickupStatusLabel[]> = {
  pickup_point: [
    'Waiting for supplier',
    'On its way to the hub',
    'At the hub',
    'On the way',
    'Ready for pickup',
    'Collected',
  ],
  door: [
    'Waiting for supplier',
    'On its way to the hub',
    'At the hub',
    'On the way',
    'Out for delivery',
    'Delivered',
  ],
};

export type TrackerStep = { label: PickupStatusLabel; state: 'done' | 'current' | 'todo' };

/** The tracker for a pickup: steps before its label are done; the last step is done once reached. */
export function trackerSteps(
  pickup: Pick<PickupView, 'destinationType' | 'statusLabel'>,
): TrackerStep[] {
  const steps = STEPS[pickup.destinationType];
  const at = steps.indexOf(pickup.statusLabel);
  const last = steps.length - 1;
  return steps.map((label, i) => ({
    label,
    state: i < at || (i === at && i === last) ? 'done' : i === at ? 'current' : 'todo',
  }));
}

const HANDED_OVER: readonly PickupStatusView[] = ['collected', 'delivered', 'checked', 'closed'];

/** True once the goods are collected or delivered. */
export const isHandedOver = (p: Pick<PickupView, 'status'>): boolean =>
  HANDED_OVER.includes(p.status);

/** True when the code can hand the goods over now. */
export const canHandOver = (p: Pick<PickupView, 'status' | 'destinationType'>): boolean =>
  p.status === 'partly_ready' ||
  (p.destinationType === 'door' ? p.status === 'out_for_delivery' : p.status === 'ready');

/** Where the goods go: the pickup point's name, or the shop for a door delivery. */
export const placeLabel = (p: Pick<PickupView, 'placeName'>): string =>
  p.placeName ?? 'Your shop (door delivery)';
