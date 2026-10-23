import { exitOnError, refuseLocalDatabase, requireEnv } from './lib/prod-env';
import { setupAppRole } from './lib/setup-role';

const env = requireEnv('MIGRATION_DATABASE_URL', 'BK_APP_DB_PASSWORD');
refuseLocalDatabase('MIGRATION_DATABASE_URL');

setupAppRole(env.MIGRATION_DATABASE_URL!, env.BK_APP_DB_PASSWORD!)
  .then(() => console.log('Role bk_app can now log in.'))
  .catch(exitOnError('prod:setup-role'));
