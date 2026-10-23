import { scanText, type SecretKind } from './secret-patterns';

export type BundleFinding = { path: string; kind: string; detail: string };

/**
 * Chunks are minified, so a bare `pg` would match everywhere. These markers are strings that
 * survive bundling: package specifiers, and class or error names that the packages export.
 */
const PACKAGE_MARKERS: ReadonlyArray<{ pkg: string; markers: readonly string[] }> = [
  {
    pkg: '@supabase/supabase-js',
    markers: ['@supabase/supabase-js', '@supabase/', 'SupabaseClient', 'createClient(supabaseUrl'],
  },
  {
    pkg: '@prisma/client',
    markers: ['@prisma/client', 'PrismaClient', 'PrismaClientKnownRequestError'],
  },
  {
    pkg: 'pg',
    markers: [
      'node_modules/pg/',
      'pg-pool',
      'pg-protocol',
      'pg-connection-string',
      'node-postgres',
    ],
  },
];

// The Maps key is the one intended browser value, so the Google key pattern is not a finding here.
const IGNORED_SECRET_KINDS: ReadonlySet<SecretKind> = new Set(['google-api-key']);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function scanChunk(
  path: string,
  content: string,
  serverEnvKeys: readonly string[],
): BundleFinding[] {
  const findings: BundleFinding[] = [];
  for (const key of serverEnvKeys) {
    if (new RegExp(`(?<![A-Za-z0-9_])${escape(key)}(?![A-Za-z0-9_])`).test(content)) {
      findings.push({ path, kind: 'server-env-name', detail: key });
    }
  }
  const seen = new Set<SecretKind>();
  for (const f of scanText(path, content)) {
    // generic-secret and postgres-password are source heuristics; minified code is covered by the
    // specific key patterns and the env names above.
    if (f.kind === 'generic-secret' || f.kind === 'postgres-password') continue;
    if (IGNORED_SECRET_KINDS.has(f.kind) || seen.has(f.kind)) continue;
    seen.add(f.kind);
    findings.push({ path, kind: 'secret-pattern', detail: f.kind });
  }
  for (const { pkg, markers } of PACKAGE_MARKERS) {
    const hit = markers.find((m) => content.includes(m));
    if (hit) findings.push({ path, kind: 'server-package', detail: `${pkg} (marker ${hit})` });
  }
  return findings;
}
