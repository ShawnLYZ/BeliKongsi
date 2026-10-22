import { timingSafeEqual } from 'node:crypto';
import { runDueJobs } from '@/server/modules/jobs/run';
import { unauthorized } from '@/server/platform/errors';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

function bearerMatches(header: string | null, secret: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  if (!match) return false;
  const given = Buffer.from(match[1]!);
  const expected = Buffer.from(secret);
  // timingSafeEqual needs equal lengths; the length of the secret is not itself sensitive.
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const run = route({ auth: 'public' }, async ({ request, deps }) => {
  if (!bearerMatches(request.headers.get('authorization'), deps.env.CRON_SECRET)) {
    throw unauthorized();
  }
  return json(await runDueJobs(deps));
});

// Vercel Cron calls GET with the Authorization header; POST is for manual runs.
export const GET = run;
export const POST = run;
