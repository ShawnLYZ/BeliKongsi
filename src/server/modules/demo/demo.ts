import { seedDemo } from '../../../../prisma/seed';
import { isoWeekOf, mostRecentMonday0605 } from '@/lib/time';
import { resolveClock, systemClock } from '@/server/adapters/clock';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { AppError, conflict } from '@/server/platform/errors';
import { withTransaction } from '@/server/platform/tx';
import { appendLog } from '../activity/log';
import { expireBaskets } from '../baskets/lifecycle';
import { voidOverduePayments } from '../payments/overdue';
import { closeDueRounds } from '../rounds/close';

export const DEMO_BANNER_TEXT =
  'Made-up data: every business, person and product here is fictional.';
const RESET_LOCK_KEY = 777001;

export interface DemoState {
  demoMode: boolean;
  now: string;
  offsetMs: number;
  basketWeek: string;
  featuredProductId: string | null;
  featuredRoundId: string | null;
  bannerText: string;
}

/** PRD §24: demo controls exist only in demo mode. */
export async function requireDemoMode(deps: AppDeps): Promise<void> {
  const settings = await deps.prisma.demoSettings.findUnique({ where: { id: 1 } });
  if (!settings?.demoMode) throw new AppError('DEMO_OFF', 404, 'Demo mode is off.');
}

export async function getDemoState(deps: AppDeps): Promise<DemoState> {
  const settings = await deps.prisma.demoSettings.findUnique({ where: { id: 1 } });
  const now = (await resolveClock(deps)).now();
  const featuredProductId = settings?.featuredProductId ?? null;
  let featuredRoundId: string | null = null;
  if (featuredProductId) {
    const open = await deps.prisma.round.findFirst({
      where: { productId: featuredProductId, status: 'open' },
      orderBy: { opensAt: 'desc' },
      select: { id: true },
    });
    const round =
      open ??
      (await deps.prisma.round.findFirst({
        where: { productId: featuredProductId },
        orderBy: { opensAt: 'desc' },
        select: { id: true },
      }));
    featuredRoundId = round?.id ?? null;
  }
  return {
    demoMode: settings?.demoMode ?? false,
    now: now.toISOString(),
    offsetMs: Number(settings?.clockOffsetMs ?? 0n),
    basketWeek: isoWeekOf(now),
    featuredProductId,
    featuredRoundId,
    bannerText: DEMO_BANNER_TEXT,
  };
}

/** Wipes and re-seeds the demo world in one transaction, then moves the demo clock to the latest Monday 06:05. */
export async function resetDemo(deps: AppDeps, caller: Caller): Promise<DemoState> {
  await requireDemoMode(deps);
  const anchor = mostRecentMonday0605(systemClock.now());
  await withTransaction(
    deps,
    caller,
    async (ctx) => {
      const { tx } = ctx;
      // A second reset waits here, then runs fully on top of the first one's result.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RESET_LOCK_KEY})`;
      await tx.$executeRaw`SELECT bk_demo_reset()`;
      await tx.demoSettings.update({ where: { id: 1 }, data: { clockOffsetMs: 0n } });
      await appendLog(ctx, {
        action: 'demo.reset',
        subjectType: 'demo',
        subjectId: 'demo',
        scope: { operator: true },
        after: { anchorMonday: anchor.toISOString() },
      });
      // Nested: joins this transaction. Its timestamps come from the anchor, not ctx.now.
      await seedDemo(deps, { anchorMonday: anchor });
      // The offset is applied to the base clock (deps.clock), which is systemClock in production.
      const offset = anchor.getTime() - deps.clock.now().getTime();
      await tx.demoSettings.update({
        where: { id: 1 },
        data: { clockOffsetMs: BigInt(offset), lastResetAt: deps.clock.now() },
      });
    },
    { timeoutMs: 60_000 },
  );
  return getDemoState(deps);
}

/**
 * Moves the demo clock to one minute after the earliest open cut-off (never backwards), then, in
 * the scheduled jobs' order (`runDueJobs`), voids overdue payments, closes what is due and expires
 * what has lapsed.
 */
export async function skipToCutoff(
  deps: AppDeps,
  caller: Caller,
): Promise<DemoState & { closed: number; failed: number }> {
  await requireDemoMode(deps);
  const earliest = await deps.prisma.round.findFirst({
    where: { status: 'open' },
    orderBy: [{ cutoffAt: 'asc' }, { id: 'asc' }],
    select: { cutoffAt: true },
  });
  if (!earliest) throw conflict('NO_OPEN_ROUND', 'There is no open round to skip to.');
  const target = earliest.cutoffAt.getTime() + 60_000;
  const base = deps.clock.now().getTime();
  const current = (await resolveClock(deps)).now().getTime();
  const offset = Math.max(target, current) - base;
  await withTransaction(deps, caller, async (ctx) => {
    await ctx.tx.demoSettings.update({
      where: { id: 1 },
      data: { clockOffsetMs: BigInt(offset) },
    });
    await appendLog(ctx, {
      action: 'demo.skip_to_cutoff',
      subjectType: 'demo',
      subjectId: 'demo',
      scope: { operator: true },
      after: { nowAt: new Date(base + offset).toISOString(), offsetMs: offset },
    });
  });
  // resolveClock reads the offset just saved, so every job sees the new time.
  await voidOverduePayments(deps);
  const { closed, failed } = await closeDueRounds(deps);
  await expireBaskets(deps);
  return { ...(await getDemoState(deps)), closed, failed };
}
