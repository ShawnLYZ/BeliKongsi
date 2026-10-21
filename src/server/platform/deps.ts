import type { PrismaClient } from '@/generated/prisma/client';
import { createPrismaClient } from './db';
import { getServerEnv, type ServerEnv } from './env';

export interface AppDeps {
  prisma: PrismaClient;
  env: ServerEnv;
}

let current: AppDeps | null = null;

export function getDeps(): AppDeps {
  if (!current) {
    const env = getServerEnv();
    current = { prisma: createPrismaClient(env.DATABASE_URL), env };
  }
  return current;
}

export function setDepsForTests(deps: AppDeps | null): void {
  current = deps;
}
