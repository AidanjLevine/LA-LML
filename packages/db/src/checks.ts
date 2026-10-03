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

export type RestCheck = { locked: boolean; detail: string };
type PostgrestError = { code?: string; message?: string };

/**
 * With the Data API disabled in the Supabase dashboard (how this project runs), nothing can be read
 * or written through it, so that counts as locked down. Supabase answers either 503 PGRST002
 * (PostgREST has no schema to serve) or 404 (the REST route isn't served at all).
 */
function dataApiDisabled(status: number, body: unknown): string | null {
  if (status === 503 && (body as PostgrestError | null)?.code === "PGRST002") return "Data API disabled (503 PGRST002)";
  if (status === 404) return "Data API disabled (404)";
  return null;
}

/** Anon read of a table: locked if the Data API is off or RLS returns no rows. */
export function classifyRestRead(status: number, body: unknown): RestCheck {
  const disabled = dataApiDisabled(status, body);
  if (disabled) return { locked: true, detail: disabled };
  if (status === 200 && Array.isArray(body)) {
    return body.length === 0
      ? { locked: true, detail: "RLS returned no rows" }
      : { locked: false, detail: `returned ${body.length} rows` };
  }
  if ([401, 403].includes(status)) return { locked: true, detail: `denied (${status})` };
  return { locked: false, detail: `inconclusive: ${status} ${JSON.stringify(body)}` };
}

/** Anon insert of `{}`: locked if the Data API is off or RLS rejects it (42501). A NOT NULL error means RLS let it through. */
export function classifyRestWrite(status: number, body: unknown): RestCheck {
  const disabled = dataApiDisabled(status, body);
  if (disabled) return { locked: true, detail: disabled };
  const error = (body ?? {}) as PostgrestError;
  if (error.code === "42501") return { locked: true, detail: "RLS rejected the insert (42501)" };
  if ([401, 403].includes(status)) return { locked: true, detail: `denied (${status})` };
  return { locked: false, detail: `${status} ${error.code ?? ""} ${error.message ?? ""}`.trim() };
}
