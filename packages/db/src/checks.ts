/** SQL checks shared by the PGlite tests and `pnpm db:verify` against Supabase. */

/** Tables in `public` without row level security. Must be empty. */
export const TABLES_WITHOUT_RLS = `
  select c.relname as table
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  order by 1`;

/** Tables in `public` with an updated_at column but no set_updated_at trigger. Must be empty. */
export const TABLES_WITHOUT_UPDATED_AT_TRIGGER = `
  select c.relname as table
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'updated_at' and not a.attisdropped
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and not exists (
      select 1 from pg_trigger t
      join pg_proc p on p.oid = t.tgfoid
      where t.tgrelid = c.oid and p.proname = 'set_updated_at' and not t.tgisinternal
    )
  order by 1`;

/** Schema of each required extension. Both must be `extensions`. */
export const EXTENSION_SCHEMAS = `
  select e.extname as extension, n.nspname as schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname in ('postgis', 'pg_trgm')
  order by 1`;
