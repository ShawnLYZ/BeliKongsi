import { describeTarget, requireEnv } from './lib/prod-env';
import {
  projectRefFromUrl,
  runAdvisorCheck,
  runSecurityChecks,
  type SecurityCheck,
} from './lib/security-checks';

const env = requireEnv('DATABASE_URL', 'MIGRATION_DATABASE_URL');

async function main(): Promise<void> {
  console.log(`App database:   ${describeTarget(env.DATABASE_URL!)}`);
  console.log(`Admin database: ${describeTarget(env.MIGRATION_DATABASE_URL!)}`);
  console.log('');
  const { checks } = await runSecurityChecks(env.MIGRATION_DATABASE_URL!, env.DATABASE_URL!);
  const all: SecurityCheck[] = [...checks];

  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (token && !/^<.*>$/.test(token)) {
    const ref = projectRefFromUrl(process.env.SUPABASE_URL);
    all.push(
      ref
        ? await runAdvisorCheck(ref, token)
        : {
            id: 'supabase_advisor',
            passed: true,
            warning: true,
            detail: 'skipped: SUPABASE_URL is not a https://<ref>.supabase.co address',
          },
    );
  } else {
    console.log('SUPABASE_ACCESS_TOKEN is not set: skipping the Supabase security advisor.\n');
  }

  const width = Math.max(...all.map((c) => c.id.length));
  for (const c of all) {
    const status = !c.passed ? 'FAIL' : c.warning ? 'WARN' : 'PASS';
    console.log(`${status}  ${c.id.padEnd(width)}  ${c.detail}`);
  }
  const failed = all.filter((c) => !c.passed).length;
  const warned = all.filter((c) => c.passed && c.warning).length;
  console.log(`\n${all.length - failed} passed (${warned} with warnings), ${failed} failed.`);
  process.exit(failed ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'prod:check failed.');
  process.exit(1);
});
