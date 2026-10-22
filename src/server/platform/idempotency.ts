import { Prisma } from '@/generated/prisma/client';
import type { AppDeps } from './deps';
import { conflict } from './errors';

export type StoredResponse = { status: number; body: unknown };

const PENDING = 0;

export async function withIdempotency(
  deps: AppDeps,
  scope: string,
  key: string | null,
  fn: () => Promise<StoredResponse>,
): Promise<StoredResponse> {
  if (key === null) return fn();
  const where = { scope_key: { scope, key } };

  // Claim the key first (own short statement) so a concurrent retry cannot run fn too.
  const claimed = await deps.prisma.idempotencyRecord.createMany({
    data: [{ scope, key, status: PENDING, body: {} }],
    skipDuplicates: true,
  });
  if (claimed.count === 0) {
    const existing = await deps.prisma.idempotencyRecord.findUnique({ where });
    if (existing && existing.status !== PENDING) {
      return { status: existing.status, body: existing.body };
    }
    // Pending, or released between the insert and the read: either way, not ours to run.
    throw conflict('REQUEST_IN_PROGRESS', 'This request is already being processed.');
  }

  let response: StoredResponse;
  try {
    response = await fn();
  } catch (error) {
    await deps.prisma.idempotencyRecord.deleteMany({ where: { scope, key } });
    throw error;
  }
  // Upsert, not update: fn may have wiped the claim itself ("Reset demo data" truncates this table).
  const stored = {
    status: response.status,
    body: (response.body ?? Prisma.JsonNull) as Prisma.InputJsonValue,
  };
  await deps.prisma.idempotencyRecord.upsert({
    where,
    update: stored,
    create: { scope, key, ...stored },
  });
  return response;
}
