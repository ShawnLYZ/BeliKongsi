import type { Cadence } from '@/generated/prisma/client';
import {
  addIsoWeeks,
  isoWeekIndex,
  isoWeekOf,
  isoWeekStart,
  mytDate,
  mytParts,
  mytInstant,
} from '@/lib/time';

export type ScheduleProduct = {
  cadence: Cadence;
  scheduleAnchorWeek: string;
  cutoffWeekday: number;
  cutoffTime: string;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PERIOD: Record<Cadence, number> = { weekly: 1, fortnightly: 2, monthly: 4 };
// Look ahead further than the longest cadence so a bad schedule fails loudly rather than loops.
const MAX_LOOKAHEAD_WEEKS = 8;

/** The cut-off in the given ISO week, or null when the product's cadence skips that week. */
export function cutoffForWeek(p: ScheduleProduct, isoWeek: string): Date | null {
  const period = PERIOD[p.cadence];
  const diff = isoWeekIndex(isoWeek) - isoWeekIndex(p.scheduleAnchorWeek);
  if (((diff % period) + period) % period !== 0) return null;
  const [hh, mm] = p.cutoffTime.split(':').map(Number) as [number, number];
  const monday = mytParts(isoWeekStart(isoWeek));
  return mytInstant(monday.year, monday.month, monday.day + p.cutoffWeekday - 1, hh, mm);
}

/** The first cut-off strictly after `instant`. */
export function nextCutoffAfter(p: ScheduleProduct, instant: Date): Date {
  const first = isoWeekOf(instant);
  for (let i = 0; i <= MAX_LOOKAHEAD_WEEKS; i++) {
    const cutoff = cutoffForWeek(p, addIsoWeeks(first, i));
    if (cutoff && cutoff.getTime() > instant.getTime()) return cutoff;
  }
  throw new Error('No cut-off found within the look-ahead window.');
}

/** Cut-off + 4 days 14 hours. */
export function expectedReadyAt(cutoff: Date): Date {
  return new Date(cutoff.getTime() + 4 * DAY + 14 * HOUR);
}

export function deliveryDateOf(cutoff: Date): string {
  return mytDate(expectedReadyAt(cutoff));
}

/** The supplier must dispatch within 2 days of the cut-off (C10). */
export function requiredDispatchDate(cutoff: Date): string {
  return mytDate(new Date(cutoff.getTime() + 2 * DAY));
}

export function expectedHubDate(cutoff: Date): string {
  return mytDate(new Date(cutoff.getTime() + 4 * DAY));
}
