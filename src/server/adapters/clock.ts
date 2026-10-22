import type { AppDeps } from '@/server/platform/deps';

// The only allowed source of "now" in the app (R5).
export interface Clock {
  now(): Date;
}

export interface MutableClock extends Clock {
  set(iso: string): void;
  advance(ms: number): void;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(iso: string): MutableClock {
  let current = new Date(iso).getTime();
  return {
    now: () => new Date(current),
    set(next) {
      current = new Date(next).getTime();
    },
    advance(ms) {
      current += ms;
    },
  };
}

export function withOffset(base: Clock, offsetMs: number): Clock {
  return { now: () => new Date(base.now().getTime() + offsetMs) };
}

// Base clock plus the demo offset; no offset when demo mode is off.
export async function resolveClock(deps: AppDeps): Promise<Clock> {
  const settings = await deps.prisma.demoSettings.findUnique({ where: { id: 1 } });
  if (!settings || !settings.demoMode) return deps.clock;
  return withOffset(deps.clock, Number(settings.clockOffsetMs));
}
