-- PostGIS and pg_trgm live in the `extensions` schema, not `public` (Supabase convention).
CREATE SCHEMA IF NOT EXISTS extensions;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
--> statement-breakpoint
-- Columns use the unqualified `geometry` type, so `extensions` must be on the search_path.
-- Supabase already includes it; this covers plain Postgres. SET applies to this migration session,
-- ALTER DATABASE to future sessions (skipped with a notice if the role isn't allowed to).
SET search_path TO "$user", public, extensions;
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET search_path TO "$user", public, extensions', current_database());
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not set database search_path; make sure the extensions schema is on it.';
END
$$;
