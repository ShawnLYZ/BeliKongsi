import type { PrismaClient } from '@/generated/prisma/client';
import { resolveClock } from '@/server/adapters/clock';
import type { AppDeps } from '@/server/platform/deps';
import { verifyLogChain } from './log';

type Result = Awaited<ReturnType<typeof verifyLogChain>>;

const TTL_MS = 10_000;
const cache = new WeakMap<PrismaClient, { at: number; result: Result }>();

/**
 * The chain check for read-only callers: a result at most 10 seconds old (by the app Clock), so
 * opening timelines does not rescan the whole log each time. Ops' own check is never cached.
 */
export async function recentLogCheck(deps: AppDeps): Promise<Result> {
  const now = (await resolveClock(deps)).now().getTime();
  const hit = cache.get(deps.prisma);
  if (hit && now >= hit.at && now - hit.at < TTL_MS) return hit.result;
  const result = await verifyLogChain(deps.prisma);
  cache.set(deps.prisma, { at: now, result });
  return result;
}
