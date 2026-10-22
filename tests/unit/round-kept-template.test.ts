import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '@/server/modules/notifications/templates';

const kept = (shopCount: number) =>
  TEMPLATES['round.kept']({
    shortName: 'condensed milk',
    unitName: 'carton',
    finalUnitPriceSen: 15800,
    totalKept: 20,
    shopCount,
    refundSen: 0,
    readyAt: null,
  })().body;

describe('the round kept notice', () => {
  it('counts one shop in the singular and more in the plural', () => {
    expect(kept(1)).toBe('Condensed milk closed at RM 158.00 a carton (20 cartons, 1 shop).');
    expect(kept(9)).toBe('Condensed milk closed at RM 158.00 a carton (20 cartons, 9 shops).');
  });
});
