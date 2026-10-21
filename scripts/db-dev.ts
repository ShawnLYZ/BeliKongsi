import { resolve } from 'node:path';
import { ensureDatabase, isPortListening, startCluster } from './lib/embedded-pg';

const PORT = 54329;
const DIR = resolve(import.meta.dirname, '..', '.data', 'pg-dev');

async function main(): Promise<void> {
  if (await isPortListening(PORT)) {
    console.log(`Dev database already running on port ${PORT}.`);
    return;
  }

  const cluster = await startCluster({
    dir: DIR,
    port: PORT,
    password: 'postgres',
    log: (m) => console.error(m.trimEnd()),
  });
  await ensureDatabase(cluster.adminUrl(), 'belikongsi');

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await cluster.stop();
      process.exit(0);
    } catch (err) {
      console.error('Failed to stop the dev database cleanly:', err);
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  console.log(`MIGRATION_DATABASE_URL=postgresql://postgres:postgres@localhost:${PORT}/belikongsi`);
  console.log(`DATABASE_URL=postgresql://bk_app:bk_app_dev@localhost:${PORT}/belikongsi`);

  // Keep the process alive until a signal arrives.
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
