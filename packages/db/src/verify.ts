// pnpm db:verify: checks the live database over both connection strings.
// Never prints connection strings (they contain the password).
import postgres from "postgres";
import { EXTENSION_SCHEMAS, TABLES_WITHOUT_RLS, TABLES_WITHOUT_UPDATED_AT_TRIGGER } from "./checks.js";
import { loadRootEnv } from "./env.js";

loadRootEnv();
let failed = false;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failed = true;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
};

for (const [label, envName] of [
  ["Session pooler (migrations, seed)", "DATABASE_URL_SESSION"],
  ["Transaction pooler (API runtime)", "DATABASE_URL"],
] as const) {
  const url = process.env[envName];
  console.log(`\n${label} [${envName}]`);
  if (!url) {
    check(false, `${envName} is set`);
    continue;
  }
  check(true, "port", new URL(url).port);
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    const extensions = await sql.unsafe<{ extension: string; schema: string }[]>(EXTENSION_SCHEMAS);
    for (const name of ["pg_trgm", "postgis"]) {
      const schema = extensions.find((e) => e.extension === name)?.schema;
      check(schema === "extensions", `${name} in extensions schema`, schema ?? "not installed");
    }
    const [path] = await sql<{ search_path: string }[]>`show search_path`;
    check(!!path?.search_path.includes("extensions"), "search_path includes extensions", path?.search_path);
    const [geometry] = await sql<{ type: string }[]>`
      select pg_typeof('SRID=4326;POINT(-118.26 34.08)'::geometry)::text as type`;
    check(geometry?.type === "geometry", "unqualified geometry resolves");
    const [migrations] = await sql<{ count: number }[]>`select count(*)::int as count from drizzle.__drizzle_migrations`;
    check((migrations?.count ?? 0) >= 4, "migrations applied", String(migrations?.count));
    const noRls = await sql.unsafe<{ table: string }[]>(TABLES_WITHOUT_RLS);
    check(noRls.length === 0, "RLS on every public table", noRls.map((r) => r.table).join(", "));
    const noTrigger = await sql.unsafe<{ table: string }[]>(TABLES_WITHOUT_UPDATED_AT_TRIGGER);
    check(noTrigger.length === 0, "updated_at trigger on every public table", noTrigger.map((r) => r.table).join(", "));
    const [counts] = await sql`select
      (select count(*)::int from neighborhoods) as neighborhoods,
      (select count(*)::int from venues) as venues,
      (select count(*)::int from sources) as sources`;
    console.log(`  rows: ${JSON.stringify(counts)}`);
  } catch (error) {
    check(false, "query", (error as Error).message);
  } finally {
    await sql.end();
  }
}

// Supabase's auto-generated REST API must not read or write anything (RLS on, no policies).
const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
console.log("\nSupabase REST API (anon key)");
if (!supabaseUrl || !anonKey) {
  console.log("  skipped: set SUPABASE_URL and SUPABASE_ANON_KEY to check");
} else {
  const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" };
  const read = await fetch(`${supabaseUrl}/rest/v1/venues?select=slug&limit=5`, { headers });
  const rows = read.ok ? ((await read.json()) as unknown[]) : null;
  check(rows === null || rows.length === 0, "anon read of venues returns nothing", `${read.status} ${rows ? `${rows.length} rows` : ""}`);
  // An empty insert: blocked by RLS (42501) if locked down; a NOT NULL error would mean RLS let it through.
  const write = await fetch(`${supabaseUrl}/rest/v1/neighborhoods`, { method: "POST", headers, body: "{}" });
  const body = (await write.json().catch(() => ({}))) as { code?: string; message?: string };
  check(!write.ok && body.code !== "23502", "anon insert is rejected", `${write.status} ${body.code ?? ""} ${body.message ?? ""}`.trim());
}

console.log(failed ? "\nSome checks failed." : "\nAll checks passed.");
process.exitCode = failed ? 1 : 0;
