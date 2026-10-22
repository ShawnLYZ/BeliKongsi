import { describe, expect, it } from 'vitest';
import {
  cutoffForWeek,
  deliveryDateOf,
  expectedHubDate,
  expectedReadyAt,
  nextCutoffAfter,
  requiredDispatchDate,
} from '@/server/modules/rounds/schedule';

const weekly = {
  cadence: 'weekly',
  scheduleAnchorWeek: '2026-W45',
  cutoffWeekday: 4,
  cutoffTime: '20:00',
} as const;

describe('schedule', () => {
  it('closes weekly products on Thursday 8 pm Malaysia time', () =>
    expect(cutoffForWeek(weekly, '2026-W45')?.toISOString()).toBe('2026-11-05T12:00:00.000Z'));

  it('skips the off weeks of fortnightly products', () => {
    const f = { ...weekly, cadence: 'fortnightly' } as const;
    expect(cutoffForWeek(f, '2026-W46')).toBeNull();
    expect(
      nextCutoffAfter(
        { ...f, scheduleAnchorWeek: '2026-W44' },
        new Date('2026-11-01T22:05:00Z'),
      ).toISOString(),
    ).toBe('2026-11-12T12:00:00.000Z');
  });

  it('closes monthly products every fourth week', () => {
    const m = { ...weekly, cadence: 'monthly' } as const;
    expect(cutoffForWeek(m, '2026-W49')).not.toBeNull();
    expect(cutoffForWeek(m, '2026-W46')).toBeNull();
    expect(cutoffForWeek(m, '2026-W42')).toBeNull();
    expect(cutoffForWeek(m, '2026-W41')).not.toBeNull();
  });

  it('derives the later dates from the cut-off', () => {
    const c = new Date('2026-11-05T12:00:00Z');
    expect([
      expectedReadyAt(c).toISOString(),
      deliveryDateOf(c),
      requiredDispatchDate(c),
      expectedHubDate(c),
    ]).toEqual(['2026-11-10T02:00:00.000Z', '2026-11-10', '2026-11-07', '2026-11-09']);
  });

  it('picks the next week when called exactly at a cut-off', () =>
    expect(nextCutoffAfter(weekly, new Date('2026-11-05T12:00:00Z')).toISOString()).toBe(
      '2026-11-12T12:00:00.000Z',
    ));
});
