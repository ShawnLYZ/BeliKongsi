// Malaysia time (MYT = UTC+8, no daylight saving): arithmetic on epoch ms + 8 hours.
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MYT_OFFSET = 8 * HOUR;

export interface MytParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 1 = Monday ... 7 = Sunday */
  isoWeekday: number;
}

export function mytParts(d: Date): MytParts {
  const s = new Date(d.getTime() + MYT_OFFSET);
  return {
    year: s.getUTCFullYear(),
    month: s.getUTCMonth() + 1,
    day: s.getUTCDate(),
    hour: s.getUTCHours(),
    minute: s.getUTCMinutes(),
    isoWeekday: s.getUTCDay() === 0 ? 7 : s.getUTCDay(),
  };
}

export function mytInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - MYT_OFFSET);
}

/** Monday 00:00 MYT of ISO week 1 of the given ISO year (the week holding 4 January). */
function isoYearStart(year: number): number {
  const jan4 = mytInstant(year, 1, 4, 0, 0);
  const weekday = mytParts(jan4).isoWeekday;
  return jan4.getTime() - (weekday - 1) * DAY;
}

export function isoWeekOf(d: Date): string {
  const { year } = mytParts(d);
  let isoYear = year + 1;
  while (isoYear > year - 1 && isoYearStart(isoYear) > d.getTime()) isoYear -= 1;
  const week = Math.floor((d.getTime() - isoYearStart(isoYear)) / WEEK) + 1;
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

function parseWeek(week: string): { year: number; week: number } {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) throw new Error(`Invalid ISO week: ${week}`);
  return { year: Number(m[1]), week: Number(m[2]) };
}

export function isoWeekStart(week: string): Date {
  const { year, week: w } = parseWeek(week);
  return new Date(isoYearStart(year) + (w - 1) * WEEK);
}

export function isoWeekIndex(week: string): number {
  return Math.round(isoWeekStart(week).getTime() / WEEK);
}

export function addIsoWeeks(week: string, n: number): string {
  // Weeks are exactly 7 days with no DST, so shift the start and re-name it.
  return isoWeekOf(new Date(isoWeekStart(week).getTime() + n * WEEK));
}

export function mytDate(d: Date): string {
  const p = mytParts(d);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** The latest Monday 06:05 MYT that is at or before `now`. */
export function mostRecentMonday0605(now: Date): Date {
  const p = mytParts(now);
  let monday = mytInstant(p.year, p.month, p.day - (p.isoWeekday - 1), 6, 5);
  if (monday.getTime() > now.getTime()) monday = new Date(monday.getTime() - WEEK);
  return monday;
}
