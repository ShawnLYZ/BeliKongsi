import { describe, expect, it } from 'vitest';
import { getServerEnv } from '@/server/platform/env';

const valid = {
  DATABASE_URL: 'postgresql://localhost:54329/belikongsi',
  SESSION_SECRET: 'a-session-secret-that-is-long-enough-0123456789',
  CRON_SECRET: 'a-cron-secret-1234',
};

describe('getServerEnv', () => {
  it('names every missing variable and never echoes values', () => {
    expect(() => getServerEnv({ SESSION_SECRET: 'short-secret-value', CRON_SECRET: 'x' })).toThrow(
      /DATABASE_URL.*SESSION_SECRET.*CRON_SECRET/s,
    );
    try {
      getServerEnv({ SESSION_SECRET: 'short-secret-value' });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain('short-secret-value');
    }
  });

  it('treats <placeholder> values as unset', () => {
    expect(() =>
      getServerEnv({ ...valid, SESSION_SECRET: '<generate-32+-random-chars-here-ok>' }),
    ).toThrow(/SESSION_SECRET/);
    const env = getServerEnv({ ...valid, GEMINI_MODEL: '<gemini-model-name>' });
    expect(env.GEMINI_MODEL).toBe('gemini-3.5-flash-lite');
    expect(() =>
      getServerEnv({ ...valid, AI_ADAPTER: 'gemini', GEMINI_API_KEY: '<gemini-api-key>' }),
    ).toThrow(/GEMINI_API_KEY/);
  });

  it('requires the Gemini key only when the Gemini adapter is chosen', () => {
    expect(() => getServerEnv({ ...valid, AI_ADAPTER: 'gemini' })).toThrow(/GEMINI_API_KEY/);
    expect(getServerEnv({ ...valid, AI_ADAPTER: 'fake' }).AI_ADAPTER).toBe('fake');
  });

  it('requires the Supabase pair only when the Supabase storage is chosen', () => {
    expect(() => getServerEnv({ ...valid, STORAGE_ADAPTER: 'supabase' })).toThrow(
      /SUPABASE_URL.*SUPABASE_SERVICE_ROLE_KEY/s,
    );
  });

  it('applies defaults and parses DEMO_MODE from strings', () => {
    const env = getServerEnv(valid);
    expect(env).toMatchObject({
      DEMO_MODE: true,
      AI_ADAPTER: 'fake',
      GEMINI_MODEL: 'gemini-3.5-flash-lite',
      STORAGE_ADAPTER: 'local',
    });
    expect(getServerEnv({ ...valid, DEMO_MODE: 'false' }).DEMO_MODE).toBe(false);
    expect(getServerEnv({ ...valid, DEMO_MODE: 'true' }).DEMO_MODE).toBe(true);
    expect(() => getServerEnv({ ...valid, DEMO_MODE: 'maybe' })).toThrow(/DEMO_MODE/);
  });

  it('does not cache explicit sources', () => {
    expect(getServerEnv({ ...valid, DEMO_MODE: 'false' }).DEMO_MODE).toBe(false);
    expect(getServerEnv({ ...valid, DEMO_MODE: 'true' }).DEMO_MODE).toBe(true);
  });
});
