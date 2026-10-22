import { describe, expect, it } from 'vitest';
import { feeSen, formatRM, formatUnits, roundHalfUpDiv } from '@/server/engine';
import { FEE_BPS } from './fixtures';

describe('money helpers', () => {
  it('rounds half up on whole sen', () => {
    expect(roundHalfUpDiv(292_500, 1000)).toBe(293); // 19.5 kg × 15 sen/kg
    expect(roundHalfUpDiv(39_600, 1000)).toBe(40); // 1.8 kg × 22 sen/kg
    expect(roundHalfUpDiv(500, 1000)).toBe(1);
    expect(roundHalfUpDiv(499, 1000)).toBe(0);
  });
  it('computes the 2% fee per unit, half up', () => {
    expect(feeSen(15800, FEE_BPS)).toBe(316);
    expect(feeSen(14600, FEE_BPS)).toBe(292);
    expect(feeSen(1170, FEE_BPS)).toBe(23); // 23.4
    expect(feeSen(1230, FEE_BPS)).toBe(25); // 24.6
    expect(feeSen(1125, FEE_BPS)).toBe(23); // 22.5, the half-sen boundary
    expect(feeSen(1124, FEE_BPS)).toBe(22);
  });
  it('formats ringgit', () => {
    expect(formatRM(0)).toBe('RM 0.00');
    expect(formatRM(5)).toBe('RM 0.05');
    expect(formatRM(98454)).toBe('RM 984.54');
    expect(formatRM(1533000)).toBe('RM 15,330.00');
    expect(formatRM(123456789)).toBe('RM 1,234,567.89');
    expect(formatRM(-185)).toBe('-RM 1.85');
  });
  it('formats unit counts', () => {
    expect(formatUnits(1, 'carton')).toBe('1 carton');
    expect(formatUnits(6, 'carton')).toBe('6 cartons');
    expect(formatUnits(10, 'tray')).toBe('10 trays');
    expect(formatUnits(2, 'tin')).toBe('2 tins');
  });
  it('refuses negative or fractional inputs to rounding', () => {
    expect(() => roundHalfUpDiv(-1, 10)).toThrow(RangeError);
    expect(() => roundHalfUpDiv(1.5, 10)).toThrow(RangeError);
  });
});
