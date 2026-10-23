import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '@/server/modules/notifications/notify';

const approved = (
  units: number,
  kind: 'missing' | 'damaged' | 'missing or damaged',
  unit: string,
) =>
  TEMPLATES['claim.decided']({
    decision: 'approved',
    refundSen: 15185,
    units,
    kind,
    unitName: unit,
  })('staff').whatsappText;

describe('Claim decision wording', () => {
  it('puts the adjective before the unit noun', () => {
    expect(approved(1, 'damaged', 'carton')).toBe('Claim approved for 1 damaged carton.');
    expect(approved(2, 'missing', 'carton')).toBe('Claim approved for 2 missing cartons.');
  });

  it('says items when the units differ and keeps amounts from staff', () => {
    expect(approved(3, 'missing or damaged', 'item')).toBe(
      'Claim approved for 3 missing or damaged items.',
    );
  });
});
