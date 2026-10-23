import { assertLocalDatabase } from './lib/local-only';
import { setupAppRole } from './lib/setup-role';

// Loads .env.local then .env like prisma.config.ts, and refuses a non-local database.
assertLocalDatabase();

async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL is not set.');
  const password = process.env.BK_APP_DB_PASSWORD;
  if (!password?.trim()) throw new Error('BK_APP_DB_PASSWORD is not set or is blank.');
  await setupAppRole(url, password);
  console.log('Role bk_app can now log in.');
}

main().catch((err: unknown) => {
  // Report the message only; connection errors could echo connection details.
  console.error(err instanceof Error ? err.message : 'db-setup-role failed.');
  process.exit(1);
});
