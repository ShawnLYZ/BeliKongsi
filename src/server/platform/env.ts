import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z
  .object({
    DATABASE_URL: z.string().min(1),
    SESSION_SECRET: z.string().min(32),
    CRON_SECRET: z.string().min(16),
    DEMO_MODE: booleanString.default(true),
    AI_ADAPTER: z.enum(['gemini', 'fake']).default('fake'),
    GEMINI_API_KEY: z.string().min(1).optional(),
    GEMINI_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
    STORAGE_ADAPTER: z.enum(['local', 'supabase']).default('local'),
    LOCAL_STORAGE_DIR: z.string().min(1).default('.data/storage'),
    SUPABASE_URL: z.string().min(1).optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.AI_ADAPTER === 'gemini' && !env.GEMINI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['GEMINI_API_KEY'],
        message: 'required when AI_ADAPTER=gemini',
      });
    }
    if (env.STORAGE_ADAPTER === 'supabase') {
      for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'required when STORAGE_ADAPTER=supabase',
          });
        }
      }
    }
  });

export type ServerEnv = z.infer<typeof schema>;

const order = Object.keys(schema.shape);

/** Every variable name the server schema reads; `.env.example` must list all of them. */
export function serverEnvKeys(): string[] {
  return [...order];
}
let cached: ServerEnv | undefined;

function parse(source: Record<string, string | undefined>): ServerEnv {
  // Empty strings and untouched <placeholder> values from .env.example count as unset, so they
  // neither override defaults nor satisfy a required key.
  const input = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== '' && !/^<.*>$/.test(v)),
  );
  const result = schema.safeParse(input);

  // On Vercel the schema defaults (fake AI, local storage) would quietly run a broken demo, so the
  // adapters must be named explicitly and must be the real ones.
  const reasons = new Map<string, string>();
  if (source.VERCEL === '1') {
    const required: [string, string][] = [
      ['AI_ADAPTER', 'gemini'],
      ['STORAGE_ADAPTER', 'supabase'],
    ];
    for (const [name, real] of required) {
      if (input[name] === undefined) reasons.set(name, `required on Vercel (set it to ${real})`);
      else if (input[name] !== real) reasons.set(name, `must be ${real} on Vercel`);
    }
  }
  if (result.success && reasons.size === 0) return result.data;

  // Report names and reasons only; values (which may be secrets) are never included.
  if (!result.success) {
    for (const issue of result.error.issues) {
      const name = String(issue.path[0] ?? 'environment');
      if (!reasons.has(name)) {
        reasons.set(name, issue.code === 'custom' ? issue.message : 'missing or invalid');
      }
    }
  }
  const sorted = [...reasons].sort(
    ([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99),
  );
  throw new Error(
    `Invalid environment configuration: ${sorted.map(([n, r]) => `${n} (${r})`).join(', ')}`,
  );
}

export function getServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  if (source !== process.env) return parse(source);
  cached ??= parse(source);
  return cached;
}
