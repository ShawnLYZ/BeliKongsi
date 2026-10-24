import { describe, expect, it } from 'vitest';
import { consignmentMovedMessage } from '@/components/ops/consignment-labels';
import { canHandOver, isHandedOver, trackerSteps } from '@/components/pickups/steps';
import { nextConsignmentStep } from '@/lib/consignment-steps';

describe('nextConsignmentStep', () => {
  it('offers only the partner step allowed for each path', () => {
    expect(nextConsignmentStep('pickup_point', 'planned')).toBe('dispatched');
    expect(nextConsignmentStep('pickup_point', 'dispatched')).toBe('arrived');
    expect(nextConsignmentStep('pickup_point', 'arrived')).toBeNull();
    expect(nextConsignmentStep('door', 'planned')).toBe('dispatched');
    expect(nextConsignmentStep('door', 'dispatched')).toBe('out_for_delivery');
    expect(nextConsignmentStep('door', 'out_for_delivery')).toBe('delivered');
    expect(nextConsignmentStep('door', 'delivered')).toBeNull();
    expect(nextConsignmentStep('door', 'completed')).toBeNull();
  });
});

describe('consignmentMovedMessage', () => {
  const c = { hubName: 'Klang Valley hub', destinationName: 'Ipoh' };

  it('names the step taken', () => {
    expect(consignmentMovedMessage(c, 'arrived', 'arrived')).toBe(
      'Klang Valley hub → Ipoh: arrived at pickup point.',
    );
  });

  it('says so when every pickup was already collected and the consignment completed', () => {
    expect(consignmentMovedMessage(c, 'arrived', 'completed')).toBe(
      'Klang Valley hub → Ipoh: arrived — all pickups collected, consignment completed.',
    );
    expect(consignmentMovedMessage(c, 'delivered', 'completed')).toBe(
      'Klang Valley hub → Ipoh: delivered — all pickups collected, consignment completed.',
    );
  });
});

describe('pickup tracker', () => {
  it('marks earlier steps done and the current step current', () => {
    const steps = trackerSteps({ destinationType: 'pickup_point', statusLabel: 'At the hub' });
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'current', 'todo', 'todo', 'todo']);
  });

  it('marks the last step done once reached', () => {
    const steps = trackerSteps({ destinationType: 'door', statusLabel: 'Delivered' });
    expect(steps.at(-1)).toEqual({ label: 'Delivered', state: 'done' });
    expect(steps.every((s) => s.state === 'done')).toBe(true);
  });

  it('knows when the code can hand the goods over', () => {
    expect(canHandOver({ destinationType: 'pickup_point', status: 'ready' })).toBe(true);
    expect(canHandOver({ destinationType: 'pickup_point', status: 'waiting' })).toBe(false);
    expect(canHandOver({ destinationType: 'door', status: 'out_for_delivery' })).toBe(true);
    expect(canHandOver({ destinationType: 'door', status: 'ready' })).toBe(false);
    expect(canHandOver({ destinationType: 'pickup_point', status: 'partly_ready' })).toBe(true);
    expect(isHandedOver({ status: 'collected' })).toBe(true);
    expect(isHandedOver({ status: 'ready' })).toBe(false);
  });
});
