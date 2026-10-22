'use client';

import { useState, useSyncExternalStore } from 'react';
import { Clock } from 'lucide-react';
import { formatMyt } from '@/lib/format';

const TICK_MS = 30_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const subscribe = (onChange: () => void) => {
  const timer = setInterval(onChange, TICK_MS);
  return () => clearInterval(timer);
};
const browserNow = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const noNowOnServer = () => null;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "2 days 4 hours left", "3 hours 5 minutes left", "12 minutes left". */
export function timeLeft(ms: number): string {
  if (ms <= 0) return 'Cut-off has passed';
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  if (days > 0) return `${plural(days, 'day')} ${plural(hours, 'hour')} left`;
  if (hours > 0) {
    return minutes > 0
      ? `${plural(hours, 'hour')} ${plural(minutes, 'minute')} left`
      : `${plural(hours, 'hour')} left`;
  }
  return `${plural(Math.max(1, minutes), 'minute')} left`;
}

/**
 * The cut-off in Malaysia time and the time left. `serverNow` is the app's clock (which the demo
 * can move), so the countdown follows demo time rather than the device clock.
 */
export function Countdown({ cutoffAt, serverNow }: { cutoffAt: string; serverNow: string }) {
  // Set once in the browser: how far the app's clock is from the device's.
  const [offset] = useState(() => Date.parse(serverNow) - Date.now());
  const now = useSyncExternalStore(subscribe, browserNow, noNowOnServer);
  const cutoff = new Date(cutoffAt);
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-base">
      <Clock aria-hidden="true" className="size-5 shrink-0" />
      <span>
        Cut-off <time dateTime={cutoffAt}>{formatMyt(cutoff)}</time>
      </span>
      {now !== null ? (
        <span className="w-full pl-7 font-semibold tabular-nums">
          {timeLeft(cutoff.getTime() - (now + offset))}
        </span>
      ) : null}
    </p>
  );
}
