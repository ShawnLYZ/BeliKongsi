import { describe, expect, it } from 'vitest';
import { fixedClock, withOffset } from '@/server/adapters/clock';
import {
  addIsoWeeks,
  isoWeekIndex,
  isoWeekOf,
  isoWeekStart,
  mostRecentMonday0605,
  mytDate,
  mytInstant,
  mytParts,
} from '@/lib/time';
import {
  formatMyt,
  formatMytDate,
  formatMytShort,
  formatPickupCode,
  formatRM,
  formatUnits,
} from '@/lib/format';

describe('Malaysia time', () => {
  it('names ISO weeks in Malaysia time', () => {
    expect(isoWeekOf(new Date('2026-11-01T22:05:00Z'))).toBe('2026-W45'); // Mon 2 Nov 06:05 MYT
    expect(isoWeekOf(new Date('2026-11-01T15:59:00Z'))).toBe('2026-W44'); // Sun 1 Nov 23:59 MYT
    expect(isoWeekOf(mytInstant(2027, 1, 1, 12, 0))).toBe('2026-W53');
    expect(isoWeekStart('2026-W45').toISOString()).toBe('2026-11-01T16:00:00.000Z');
    expect(isoWeekIndex(addIsoWeeks('2026-W53', 1)) - isoWeekIndex('2026-W53')).toBe(1);
  });
  it('rolls ISO weeks across a year boundary', () => {
    expect(addIsoWeeks('2026-W53', 1)).toBe('2027-W01');
    expect(addIsoWeeks('2027-W01', -1)).toBe('2026-W53');
  });
  it('reads Malaysia calendar parts', () => {
    expect(mytParts(new Date('2026-11-05T16:30:00Z'))).toEqual({
      year: 2026,
      month: 11,
      day: 6,
      hour: 0,
      minute: 30,
      isoWeekday: 5,
    });
    expect(mytDate(new Date('2026-11-09T16:30:00Z'))).toBe('2026-11-10');
  });
});

describe('formatters', () => {
  it('formats Malaysia times the way the PRD shows them', () => {
    const cutoff = new Date('2026-11-05T12:00:00Z');
    expect(formatMyt(cutoff)).toBe('Thu 5 Nov, 8:00 pm');
    expect(formatMytShort(cutoff)).toBe('Thu 8 pm');
    expect(formatMyt(new Date('2026-11-05T16:30:00Z'))).toBe('Fri 6 Nov, 12:30 am');
    expect(formatMytDate('2026-11-10')).toBe('Tue 10 Nov');
    expect(formatPickupCode('482913')).toBe('482 913');
  });
  it('keeps minutes in the short form unless they are on the hour', () => {
    expect(formatMytShort(new Date('2026-11-05T12:30:00Z'))).toBe('Thu 8:30 pm');
  });
  it('writes noon as 12 pm and midnight as 12 am', () => {
    expect(formatMyt(new Date('2026-11-05T04:00:00Z'))).toBe('Thu 5 Nov, 12:00 pm');
    expect(formatMytShort(new Date('2026-11-05T16:00:00Z'))).toBe('Fri 12 am');
  });
  it('formats a Date as a Malaysia calendar date', () => {
    expect(formatMytDate(new Date('2026-11-09T16:30:00Z'))).toBe('Tue 10 Nov');
  });
  it('re-exports the engine money formatters', () => {
    expect(formatRM(123456)).toBe('RM 1,234.56');
    expect(typeof formatUnits).toBe('function');
  });
});

describe('week anchors and clocks', () => {
  it('finds the most recent Monday 06:05 in Malaysia', () => {
    expect(mostRecentMonday0605(new Date('2026-11-04T03:00:00Z')).toISOString()).toBe(
      '2026-11-01T22:05:00.000Z',
    );
    expect(mostRecentMonday0605(new Date('2026-11-01T21:00:00Z')).toISOString()).toBe(
      '2026-10-25T22:05:00.000Z',
    );
  });
  it('offsets a clock', () =>
    expect(withOffset(fixedClock('2026-11-01T22:05:00Z'), 60_000).now().toISOString()).toBe(
      '2026-11-01T22:06:00.000Z',
    ));
  it('lets a fixed clock be set and advanced', () => {
    const c = fixedClock('2026-11-01T22:05:00Z');
    c.advance(1000);
    expect(c.now().toISOString()).toBe('2026-11-01T22:05:01.000Z');
    c.set('2026-12-01T00:00:00Z');
    expect(c.now().toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });
});
