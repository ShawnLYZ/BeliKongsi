import type { AppDeps } from './deps';
import { rateLimited } from './errors';

export async function enforceRateLimit(
  deps: AppDeps,
  bucket: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  // Abuse windows run on real time, never the demo-offset clock. The base `deps.clock` is
  // systemClock in production; tests inject a fixed one.
  const now = deps.clock.now();
  const since = new Date(now.getTime() - windowMs);
  const allowed = await deps.prisma.$transaction(async (tx) => {
    // Serialise hits per bucket so concurrent callers cannot all slip under the limit.
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${bucket}))`;
    const used = await tx.rateLimitHit.count({ where: { bucket, at: { gt: since } } });
    if (used >= limit) return false;
    await tx.rateLimitHit.create({ data: { bucket, at: now } });
    return true;
  });
  if (!allowed) throw rateLimited();
}
