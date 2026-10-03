import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Schema = typeof schema;

/** Driver-agnostic database handle: postgres.js in production, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

/**
 * Connects through postgres.js with serverless-friendly defaults:
 * - prepare: false, because Supabase's transaction pooler (port 6543) doesn't support prepared statements
 * - one connection per function instance; Supavisor does the real pooling
 * - short connect timeout and idle timeout so a cold or frozen instance doesn't hang on a dead socket
 * Create it once per process (module scope), not per request.
 */
export const SERVERLESS_DEFAULTS = {
  prepare: false,
  max: 1,
  connect_timeout: 5,
  idle_timeout: 20,
  max_lifetime: 60 * 30,
} as const;

export function createDb(url: string, options: postgres.Options<Record<string, postgres.PostgresType>> = {}) {
  const client = postgres(url, { ...SERVERLESS_DEFAULTS, ...options });
  const db: Db = drizzle(client, { schema });
  return { db, close: () => client.end() };
}
