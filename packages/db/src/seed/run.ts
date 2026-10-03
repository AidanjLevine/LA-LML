// pnpm db:seed [path/to/venues.csv]: seeds Supabase over the session pooler (DATABASE_URL_SESSION).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDb } from "../client.js";
import { loadRootEnv, REPO_ROOT, requireEnv } from "../env.js";
import { seed, type SeedReport } from "./seed.js";

function print(report: SeedReport) {
  console.log(`Neighborhoods upserted: ${report.neighborhoods}`);
  console.log(`Venues inserted: ${report.venuesInserted.length}${report.venuesInserted.length ? ` (${report.venuesInserted.join(", ")})` : ""}`);
  console.log(`Venues updated: ${report.venuesUpdated.length}${report.venuesUpdated.length ? ` (${report.venuesUpdated.join(", ")})` : ""}`);
  console.log(`Rows skipped: ${report.skipped.length}`);
  for (const s of report.skipped) console.log(`  line ${s.line} ${s.venue}: ${s.reason}`);
  if (report.warnings.length) {
    console.log(`Warnings: ${report.warnings.length}`);
    for (const w of report.warnings) console.log(`  ${w}`);
  }
}

loadRootEnv();
const csvPath = resolve(REPO_ROOT, process.argv[2] ?? "data/venues.csv");
const { db, close } = createDb(requireEnv("DATABASE_URL_SESSION"), { max: 1 });
try {
  console.log(`Seeding from ${csvPath}`);
  print(await seed(db, readFileSync(csvPath, "utf8")));
} finally {
  await close();
}
