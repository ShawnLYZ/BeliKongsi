const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);

/**
 * Production scripts read the real environment only. `.env.local` and `.env` hold local dev values
 * (even the dev `bk_app` password), so loading them could quietly aim a production command at the
 * dev database or set the production role's password to a published value.
 */
export function requireEnv(...names: string[]): Record<string, string> {
  const missing = names.filter((n) => {
    const v = process.env[n];
    return !v?.trim() || /^<.*>$/.test(v.trim());
  });
  if (missing.length) {
    console.error(
      `Set these environment variables in your shell first (env files are not read): ${missing.join(', ')}.`,
    );
    process.exit(1);
  }
  return Object.fromEntries(names.map((n) => [n, process.env[n]!]));
}

/** Returns an error message when the URL is invalid or points at this machine, else null. Never echoes the value. */
export function checkRemoteOnly(url: string, variable: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `${variable} is not a valid URL; refusing to continue.`;
  }
  if (LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    return `${variable} points at this machine; the prod scripts only run against a remote database (use the db:* scripts for local).`;
  }
  return null;
}

export function refuseLocalDatabase(variable: string): void {
  const problem = checkRemoteOnly(process.env[variable]!, variable);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
}

/** `host:port/database` of a connection URL: never the user or password. */
export function describeTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return '(invalid URL)';
  }
}

/** Prints the message only; connection errors could carry connection details. */
export function exitOnError(label: string): (err: unknown) => never {
  return (err) => {
    console.error(err instanceof Error ? err.message : `${label} failed.`);
    process.exit(1);
  };
}
