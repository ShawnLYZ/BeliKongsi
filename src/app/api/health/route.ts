import { json, route } from '@/server/platform/http';

const TIMEOUT_MS = 2000;

export const dynamic = 'force-dynamic';

export const GET = route({ auth: 'public' }, async ({ deps }) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
    });
    await Promise.race([deps.prisma.$queryRaw`SELECT 1`, timeout]);
    return json({ status: 'ok', database: 'ok' });
  } catch {
    return json({ status: 'degraded', database: 'unreachable' }, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
});
