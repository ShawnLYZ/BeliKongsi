import { Client } from 'pg';

export interface SecurityCheck {
  id: string;
  passed: boolean;
  warning?: boolean;
  detail: string;
}

const APPEND_ONLY = [
  { table: 'activity_log_entries', trigger: 'activity_log_entries_append_only' },
  { table: 'ledger_postings', trigger: 'ledger_postings_append_only' },
];

/** Message only: errors are reported without the connection URL or any password. */
function reason(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown error';
}

async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const list = (names: string[]) => names.join(', ');

async function appRoleCheck(appUrl: string): Promise<SecurityCheck> {
  try {
    const user = await withClient(appUrl, async (c) => {
      const r = await c.query<{ u: string }>('select current_user as u');
      return r.rows[0]!.u;
    });
    if (user === 'bk_app') {
      return { id: 'app_role', passed: true, detail: 'the app connects as bk_app' };
    }
    if (user === 'postgres') {
      return {
        id: 'app_role',
        passed: true,
        warning: true,
        detail:
          'fallback mode: the app connects as postgres. Table ownership bypasses row-level security; only the append-only triggers still protect the log and ledger. Use bk_app unless it cannot log in through the pooler.',
      };
    }
    return { id: 'app_role', passed: false, detail: `the app connects as unexpected role ${user}` };
  } catch (err) {
    return {
      id: 'app_role',
      passed: false,
      detail: `the app connection (DATABASE_URL) failed: ${reason(err)}`,
    };
  }
}

export async function runSecurityChecks(
  adminUrl: string,
  appUrl: string,
): Promise<{ checks: SecurityCheck[] }> {
  const checks: SecurityCheck[] = [await appRoleCheck(appUrl)];

  try {
    await withClient(adminUrl, async (c) => {
      const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
        (await c.query<T>(sql, params)).rows;

      const tables = await q<{ name: string; rls: boolean; policy: boolean }>(
        `select c.relname as name, c.relrowsecurity as rls,
                exists (select 1 from pg_policies p
                        where p.schemaname = 'public' and p.tablename = c.relname
                          and p.policyname = 'bk_app_all') as policy
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r', 'p')
          order by c.relname`,
      );
      const names = tables.map((t) => t.name);

      const noRls = tables.filter((t) => !t.rls).map((t) => t.name);
      checks.push({
        id: 'rls_enabled',
        passed: noRls.length === 0,
        detail: noRls.length
          ? `row-level security is off on: ${list(noRls)}`
          : `row-level security is on for all ${tables.length} public tables`,
      });

      // _prisma_migrations deliberately has no bk_app policy or grants (RLS stays on).
      const noPolicy = tables
        .filter((t) => t.name !== '_prisma_migrations' && !t.policy)
        .map((t) => t.name);
      checks.push({
        id: 'bk_app_policy',
        passed: noPolicy.length === 0,
        detail: noPolicy.length
          ? `no bk_app_all policy on: ${list(noPolicy)}`
          : 'every app table has the bk_app_all policy',
      });

      const open: string[] = [];
      for (const role of ['anon', 'authenticated']) {
        const rows = await q<{ name: string }>(
          `select t as name from unnest($1::text[]) t
            where has_table_privilege($2, format('public.%I', t), 'SELECT')`,
          [names, role],
        );
        open.push(...rows.map((r) => `${role} on ${r.name}`));
      }
      checks.push({
        id: 'no_anon_access',
        passed: open.length === 0,
        detail: open.length
          ? `SELECT is allowed for: ${list(open)}`
          : 'anon and authenticated cannot read any table',
      });

      const triggers = await q<{ tgname: string }>(
        `select t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and not t.tgisinternal and t.tgenabled <> 'D'`,
      );
      const present = new Set(triggers.map((t) => t.tgname));
      const missing = APPEND_ONLY.filter((a) => !present.has(a.trigger)).map((a) => a.table);
      checks.push({
        id: 'append_only_triggers',
        passed: missing.length === 0,
        detail: missing.length
          ? `append-only trigger missing or disabled on: ${list(missing)}`
          : 'activity_log_entries and ledger_postings are append-only',
      });

      const truncate = await q<{ name: string }>(
        `select t as name from unnest($1::text[]) t
          where has_table_privilege('bk_app', format('public.%I', t), 'TRUNCATE')`,
        [names],
      );
      checks.push({
        id: 'no_truncate',
        passed: truncate.length === 0,
        detail: truncate.length
          ? `bk_app can TRUNCATE: ${list(truncate.map((r) => r.name))}`
          : 'bk_app has no TRUNCATE right on any table',
      });

      // bk_secure_all_tables() grants full rights; the migrations take these back right after it.
      const [locked] = await q<{ write: boolean; mode: boolean }>(
        `select (has_table_privilege('bk_app', 'public.demo_settings', 'INSERT')
                 or has_table_privilege('bk_app', 'public.demo_settings', 'DELETE')
                 or has_table_privilege('bk_app', 'public.demo_settings', 'TRUNCATE')) as write,
                has_column_privilege('bk_app', 'public.demo_settings', 'demo_mode', 'UPDATE') as mode`,
      );
      const loose = [
        ...(locked!.write ? ['INSERT, DELETE or TRUNCATE on demo_settings'] : []),
        ...(locked!.mode ? ['UPDATE on demo_settings.demo_mode'] : []),
      ];
      checks.push({
        id: 'demo_settings_locked',
        passed: loose.length === 0,
        detail: loose.length
          ? `bk_app has ${list(loose)}`
          : 'bk_app cannot add or delete the demo_settings row or switch demo mode off',
      });

      const fn = await q<{ prosecdef: boolean }>(
        `select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'bk_demo_reset'`,
      );
      checks.push({
        id: 'demo_reset_definer',
        passed: fn.length === 1 && fn[0]!.prosecdef,
        detail:
          fn.length === 0
            ? 'bk_demo_reset() does not exist'
            : fn[0]!.prosecdef
              ? 'bk_demo_reset() is SECURITY DEFINER'
              : 'bk_demo_reset() is not SECURITY DEFINER',
      });
    });
  } catch (err) {
    checks.push({
      id: 'admin_connection',
      passed: false,
      detail: `could not inspect the database (MIGRATION_DATABASE_URL): ${reason(err)}`,
    });
  }

  return { checks };
}

/** `https://<ref>.supabase.co` gives the project ref; anything else (local, custom domain) gives null. */
export function projectRefFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const m = /^([a-z0-9]+)\.supabase\.co$/i.exec(new URL(url).hostname);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

const unavailable = (why: string): SecurityCheck => ({
  id: 'supabase_advisor',
  passed: true,
  warning: true,
  detail: `advisor unavailable (${why}); check the Supabase dashboard's Security Advisor by hand`,
});

/**
 * Supabase security advisor (Management API, experimental). Bearer auth per the API introduction.
 * ERROR lints fail; WARN, unknown levels and an unreachable advisor warn; INFO passes.
 */
export async function runAdvisorCheck(
  projectRef: string,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<SecurityCheck> {
  let res: Response;
  try {
    res = await fetchFn(`https://api.supabase.com/v1/projects/${projectRef}/advisors/security`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return unavailable('network error');
  }
  if (!res.ok) return unavailable(`HTTP ${res.status}`);

  let lints: { name?: string; title?: string; level?: string }[];
  try {
    const body = (await res.json()) as { lints?: typeof lints };
    if (!Array.isArray(body.lints)) return unavailable('unexpected response');
    lints = body.lints;
  } catch {
    return unavailable('unreadable response');
  }

  const label = (l: (typeof lints)[number]) => l.title ?? l.name ?? 'unnamed lint';
  const errors = lints.filter((l) => l.level === 'ERROR');
  const others = lints.filter((l) => l.level !== 'ERROR' && l.level !== 'INFO');
  if (errors.length) {
    return {
      id: 'supabase_advisor',
      passed: false,
      detail: `${errors.length} ERROR lint(s): ${list(errors.map(label))}`,
    };
  }
  if (others.length) {
    return {
      id: 'supabase_advisor',
      passed: true,
      warning: true,
      detail: `${others.length} warning lint(s): ${list(others.map(label))}`,
    };
  }
  return { id: 'supabase_advisor', passed: true, detail: 'no ERROR or WARN lints' };
}
