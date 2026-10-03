import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXTENSION_SCHEMAS, TABLES_WITHOUT_RLS, TABLES_WITHOUT_UPDATED_AT_TRIGGER } from "./checks.js";
import { sources } from "./schema/index.js";
import { createTestDb } from "./testing.js";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

describe("migrations", () => {
  it("install PostGIS and pg_trgm into the extensions schema", async () => {
    const { rows } = await t.client.query(EXTENSION_SCHEMAS);
    expect(rows).toEqual([
      { extension: "pg_trgm", schema: "extensions" },
      { extension: "postgis", schema: "extensions" },
    ]);
  });

  it("enable row level security on every table in public", async () => {
    const { rows: tables } = await t.client.query("select tablename from pg_tables where schemaname = 'public'");
    expect(tables.length).toBe(11);
    const { rows } = await t.client.query(TABLES_WITHOUT_RLS);
    expect(rows).toEqual([]);
  });

  it("add the updated_at trigger to every table in public", async () => {
    const { rows } = await t.client.query(TABLES_WITHOUT_UPDATED_AT_TRIGGER);
    expect(rows).toEqual([]);
  });

  it("bump updated_at on update", async () => {
    const past = new Date("2020-01-01T00:00:00Z");
    const [row] = await t.db
      .insert(sources)
      .values({ kind: "manual", name: "trigger test", createdAt: past, updatedAt: past })
      .returning();
    await t.db.update(sources).set({ name: "renamed" }).where(eq(sources.id, row!.id));
    const [after] = await t.db.select().from(sources).where(eq(sources.id, row!.id));
    expect(after!.updatedAt.getTime()).toBeGreaterThan(past.getTime());
    expect(after!.createdAt).toEqual(past);
  });

  it("detect a table created without RLS or the trigger", async () => {
    await t.db.execute(sql`create table public.rogue (id int, updated_at timestamptz)`);
    try {
      expect((await t.client.query(TABLES_WITHOUT_RLS)).rows).toEqual([{ table: "rogue" }]);
      expect((await t.client.query(TABLES_WITHOUT_UPDATED_AT_TRIGGER)).rows).toEqual([{ table: "rogue" }]);
    } finally {
      await t.db.execute(sql`drop table public.rogue`);
    }
  });
});
