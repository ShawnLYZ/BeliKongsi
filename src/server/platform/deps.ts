import type { PrismaClient } from '@/generated/prisma/client';
import { systemClock, type Clock } from '@/server/adapters/clock';
import { createPrismaClient } from './db';
import { getServerEnv, type ServerEnv } from './env';

export interface AppDeps {
  prisma: PrismaClient;
  env: ServerEnv;
  clock: Clock;
}

let current: AppDeps | null = null;

export function getDeps(): AppDeps {
  if (!current) {
    const env = getServerEnv();
    current = { prisma: createPrismaClient(env.DATABASE_URL), env, clock: systemClock };
  }
  return current;
}

export function setDepsForTests(deps: AppDeps | null): void {
  current = deps;
}
