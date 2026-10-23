import type { PrismaClient } from '@/generated/prisma/client';
import { createFakeOrderReader } from '@/server/adapters/ai/fake';
import { createGeminiOrderReader } from '@/server/adapters/ai/gemini';
import type { OrderReader } from '@/server/adapters/ai/types';
import { systemClock, type Clock } from '@/server/adapters/clock';
import { simulatedLogistics, type LogisticsPartner } from '@/server/adapters/logistics';
import { simulatedPayments, type PaymentsPartner } from '@/server/adapters/payments';
import { createLocalStorage } from '@/server/adapters/storage/local';
import { createSupabaseStorage } from '@/server/adapters/storage/supabase';
import type { StorageAdapter } from '@/server/adapters/storage/types';
import { createPrismaClient } from './db';
import { getServerEnv, type ServerEnv } from './env';

export interface AppDeps {
  prisma: PrismaClient;
  env: ServerEnv;
  clock: Clock;
  logistics: LogisticsPartner;
  payments: PaymentsPartner;
  ai: OrderReader;
  storage: StorageAdapter;
}

let current: AppDeps | null = null;

export function getDeps(): AppDeps {
  if (!current) {
    const env = getServerEnv();
    current = {
      prisma: createPrismaClient(env.DATABASE_URL),
      env,
      clock: systemClock,
      logistics: simulatedLogistics,
      payments: simulatedPayments,
      ai:
        env.AI_ADAPTER === 'gemini'
          ? createGeminiOrderReader({ apiKey: env.GEMINI_API_KEY!, model: env.GEMINI_MODEL })
          : createFakeOrderReader(),
      storage:
        env.STORAGE_ADAPTER === 'supabase'
          ? createSupabaseStorage({
              url: env.SUPABASE_URL!,
              serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!,
            })
          : createLocalStorage({
              dir: '.data/storage',
              secret: env.SESSION_SECRET,
              now: () => systemClock.now(),
            }),
    };
  }
  return current;
}

export function setDepsForTests(deps: AppDeps | null): void {
  current = deps;
}
