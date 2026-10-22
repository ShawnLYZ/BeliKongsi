import { mytParts } from '@/lib/time';

export { formatRM, formatUnits } from '@/server/engine/money';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function clock12(hour: number, minute: number, dropZeroMinutes: boolean): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? 'am' : 'pm';
  const mm = dropZeroMinutes && minute === 0 ? '' : `:${String(minute).padStart(2, '0')}`;
  return `${h}${mm} ${suffix}`;
}

/** "Thu 5 Nov, 8:00 pm" */
export function formatMyt(d: Date): string {
  const p = mytParts(d);
  return `${WEEKDAYS[p.isoWeekday - 1]} ${p.day} ${MONTHS[p.month - 1]}, ${clock12(p.hour, p.minute, false)}`;
}

/** "Thu 8 pm" or "Thu 8:30 pm" */
export function formatMytShort(d: Date): string {
  const p = mytParts(d);
  return `${WEEKDAYS[p.isoWeekday - 1]} ${clock12(p.hour, p.minute, true)}`;
}

/** "Tue 10 Nov"; a string is a "YYYY-MM-DD" Malaysia calendar date. */
export function formatMytDate(dOrYmd: Date | string): string {
  let year: number, month: number, day: number;
  if (typeof dOrYmd === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dOrYmd);
    if (!m) throw new Error(`Invalid date: ${dOrYmd}`);
    year = Number(m[1]);
    month = Number(m[2]);
    day = Number(m[3]);
  } else {
    ({ year, month, day } = mytParts(dOrYmd));
  }
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAYS[(weekday + 6) % 7]} ${day} ${MONTHS[month - 1]}`;
}

/** "482913" -> "482 913" */
export function formatPickupCode(code: string): string {
  return code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}
