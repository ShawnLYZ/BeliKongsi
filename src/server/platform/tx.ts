import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '@/generated/prisma/client';
import { resolveClock } from '@/server/adapters/clock';
import { actorOf, type Actor, type Caller } from './caller';
import type { AppDeps } from './deps';

export interface TxContext {
  tx: Prisma.TransactionClient;
  now: Date;
  caller: Caller;
  actor: Actor;
  deps: AppDeps;
}

const outerTx = new AsyncLocalStorage<{
  tx: Prisma.TransactionClient;
  now: Date;
  closed: boolean;
}>();

const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 15_000;
const RETRY_CODES = ['40001', '40P01', 'P2034'];

function isRetryable(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; e && typeof e === 'object' && depth < 4; depth++) {
    const { code, meta, cause } = e as {
      code?: unknown;
      meta?: { code?: unknown };
      cause?: unknown;
    };
    if (typeof code === 'string' && RETRY_CODES.includes(code)) return true;
    if (typeof meta?.code === 'string' && RETRY_CODES.includes(meta.code)) return true;
    e = cause;
  }
  return false;
}

export async function withTransaction<T>(
  deps: AppDeps,
  caller: Caller,
  fn: (ctx: TxContext) => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const actor = actorOf(caller);
  // An inner call joins the outer transaction: no new transaction and no retry loop.
  // Detached work (a promise not awaited inside the callback) still sees the store after commit;
  // a closed store is ignored so that work starts its own top-level transaction.
  const joined = outerTx.getStore();
  if (joined && !joined.closed) return fn({ tx: joined.tx, now: joined.now, caller, actor, deps });

  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      // Each attempt re-reads the clock, so a retry sees a fresh offset.
      const now = (await resolveClock(deps)).now();
      const store = { tx: undefined as unknown as Prisma.TransactionClient, now, closed: false };
      try {
        return await deps.prisma.$transaction(
          (tx) => {
            store.tx = tx;
            return outerTx.run(store, () => fn({ tx, now, caller, actor, deps }));
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            timeout,
            maxWait: timeout,
          },
        );
      } finally {
        store.closed = true;
      }
    } catch (error) {
      if (attempt >= MAX_RETRIES || !isRetryable(error)) throw error;
    }
  }
}
