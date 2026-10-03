import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { postgis } from "@electric-sql/pglite-postgis";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import type { Db } from "./client.js";
import * as schema from "./schema/index.js";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

/**
 * In-memory Postgres (PGlite) with PostGIS and pg_trgm and every migration applied.
 * Tests use this so CI needs no real database. Startup takes a second or two, so create one per file.
 */
export async function createTestDb() {
  const client = await PGlite.create({ extensions: { postgis, pg_trgm } });
  const pglite = drizzle({ client, schema });
  await migrate(pglite, { migrationsFolder: MIGRATIONS_FOLDER });
  const db: Db = pglite;

  /** Empties every table in `public`. */
  async function reset() {
    const { rows } = await client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public'",
    );
    await client.exec(`truncate ${rows.map((r) => `"public"."${r.tablename}"`).join(", ")} cascade`);
  }

  return { db, client, reset, close: () => client.close() };
}
