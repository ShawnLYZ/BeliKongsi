-- Baseline security setup. Every later migration must end with: SELECT bk_secure_all_tables();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bk_app') THEN
    CREATE ROLE bk_app NOLOGIN;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO bk_app;

-- Without FOR ROLE these apply to the role running migrations (postgres everywhere).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
-- Postgres grants EXECUTE to PUBLIC on new functions by default; only a global (not IN SCHEMA)
-- default can cancel that.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE OR REPLACE FUNCTION bk_secure_all_tables() RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);

    IF t.tablename <> '_prisma_migrations' THEN
      -- bk_app_all is PERMISSIVE: later per-tenant policies for bk_app must be RESTRICTIVE.
      EXECUTE format('DROP POLICY IF EXISTS bk_app_all ON public.%I', t.tablename);
      EXECUTE format(
        'CREATE POLICY bk_app_all ON public.%I FOR ALL TO bk_app USING (true) WITH CHECK (true)',
        t.tablename
      );
    END IF;

    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated, bk_app', t.tablename);

    IF t.tablename IN ('activity_log_entries', 'ledger_postings') THEN
      EXECUTE format('GRANT SELECT, INSERT ON public.%I TO bk_app', t.tablename);
    ELSIF t.tablename <> '_prisma_migrations' THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO bk_app', t.tablename);
    END IF;
  END LOOP;

  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bk_app;
END
$$;

REVOKE ALL ON FUNCTION bk_secure_all_tables() FROM PUBLIC, anon, authenticated, bk_app;

SELECT bk_secure_all_tables();
