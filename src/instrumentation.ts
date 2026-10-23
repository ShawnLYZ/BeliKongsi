// Fails a Vercel server start-up when an environment variable is missing, naming it (the message
// lists names and reasons, never values). Local runs and the build are not affected.
export async function register(): Promise<void> {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.VERCEL === '1' &&
    process.env.NEXT_PHASE !== 'phase-production-build'
  ) {
    const { getServerEnv } = await import('@/server/platform/env');
    getServerEnv();
  }
}
