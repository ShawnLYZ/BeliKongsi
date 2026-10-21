const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const LOCAL_PORTS = new Set(['54329', '54330', '54331']);

/**
 * Returns an error message when the URL is not a local embedded-Postgres database, or null when
 * it is. The message names the variable, never the value.
 */
export function checkLocalOnly(url: string | undefined, variable = 'MIGRATION_DATABASE_URL') {
  if (!url?.trim()) return `${variable} is not set.`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `${variable} is not a valid URL; refusing to continue.`;
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()) || !LOCAL_PORTS.has(parsed.port)) {
    return `${variable} does not point at a local embedded database (loopback host, port 54329, 54330 or 54331); refusing to continue.`;
  }
  return null;
}

/** Loads env files like prisma.config.ts (no override), then exits 1 unless the URL is local. */
export function assertLocalDatabase(variable = 'MIGRATION_DATABASE_URL'): void {
  for (const file of ['.env.local', '.env']) {
    try {
      process.loadEnvFile(file);
    } catch {
      // The file is optional.
    }
  }
  const problem = checkLocalOnly(process.env[variable], variable);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
}
