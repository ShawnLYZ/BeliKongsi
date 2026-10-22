import { checkLocalOnly } from '../../scripts/lib/local-only';
import { systemCaller } from '@/server/platform/caller';
import { PRODUCTS } from './catalogue';
import { BACKGROUND_SHOPS, DEMO_SHOPS } from './shops';

// Load env files like prisma.config.ts (no override). The seed refuses a non-local database.
for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    // The file is optional.
  }
}

async function main(): Promise<void> {
  const problem = checkLocalOnly(process.env.DATABASE_URL, 'DATABASE_URL');
  if (problem) throw new Error(problem);

  const { getDeps } = await import('@/server/platform/deps');
  const { resetDemo } = await import('@/server/modules/demo/demo');
  const deps = getDeps();
  try {
    // The same path as "Reset demo data": anchor, clock offset, last reset and the genesis log entry.
    await resetDemo(deps, systemCaller('seed demo data'));
    console.log(
      `Seeded ${DEMO_SHOPS.length + BACKGROUND_SHOPS.length} shops, ${PRODUCTS.length} products`,
    );
  } finally {
    await deps.prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  // Report the message only; connection errors could echo connection details.
  console.error(err instanceof Error ? err.message : 'seed failed.');
  process.exit(1);
});
