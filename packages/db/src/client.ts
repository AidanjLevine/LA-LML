import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Schema = typeof schema;

/** Driver-agnostic database handle: postgres.js in production, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

/**
 * Connects through postgres.js. Prepared statements are off because Supabase's transaction
 * pooler (port 6543), which the serverless API uses, doesn't support them.
 */
export function createDb(url: string, options: postgres.Options<Record<string, postgres.PostgresType>> = {}) {
  const client = postgres(url, { prepare: false, ...options });
  const db: Db = drizzle(client, { schema });
  return { db, close: () => client.end() };
}
