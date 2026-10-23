import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { refuseLocalDatabase, requireEnv } from './lib/prod-env';

// prisma.config.ts reads MIGRATION_DATABASE_URL; the child inherits the shell's variables.
requireEnv('MIGRATION_DATABASE_URL');
refuseLocalDatabase('MIGRATION_DATABASE_URL');

const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status ?? 1);
