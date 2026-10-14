// pnpm db:remove-venue <slug> [--commit]: removes one venue that nothing refers to (no events, series or proposals).
// Dry run by default. Refuses a slug that's still in data/venues.csv, since the next seed would re-create it.
// Uses DATABASE_URL_SESSION (session pooler), like the seed.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { createDb } from "../client.js";
import { requireEnv } from "../env.js";
import { loadRootEnv, REPO_ROOT } from "../local-env.js";
import { slugify } from "../slug.js";
import { removeVenue } from "./remove-venue.js";

const USAGE = "Usage: pnpm db:remove-venue <slug> [--commit]";

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const unknownFlags = args.filter((a) => a.startsWith("-") && a !== "--commit");
const slugs = args.filter((a) => !a.startsWith("-"));
if (slugs.length !== 1 || unknownFlags.length) {
  console.error(unknownFlags.length ? `Unknown option ${unknownFlags.join(", ")}\n${USAGE}` : USAGE);
  process.exit(2);
}
const slug = slugs[0]!;

const csvRows = parse(readFileSync(resolve(REPO_ROOT, "data/venues.csv"), "utf8"), {
  columns: true,
  skip_empty_lines: true,
  trim: true,
}) as Record<string, string>[];
if (csvRows.some((row) => row.venue_name && slugify(row.venue_name) === slug)) {
  console.error(`"${slug}" is still in data/venues.csv; remove the row first or the next seed will re-create it.`);
  process.exit(1);
}

loadRootEnv();
const { db, close } = createDb(requireEnv("DATABASE_URL_SESSION"), { max: 1 });
try {
  const result = await removeVenue(db, slug, { commit });
  const describe = (v: { slug: string; name: string; address: string; id: string }) =>
    `${v.slug} (${v.name}, ${v.address}, id ${v.id})`;
  switch (result.status) {
    case "not_found":
      console.log(`No venue with slug "${result.slug}". Nothing deleted.`);
      break;
    case "blocked":
      console.error(
        `Not deleted: ${describe(result.venue)} is referenced by ${result.events} event(s), ` +
          `${result.series} series and ${result.proposals} proposal(s). Set its status to inactive instead.`,
      );
      process.exitCode = 1;
      break;
    case "would_delete":
      console.log(`Would delete venue ${describe(result.venue)}.\nDry run: nothing was written. Run again with --commit to delete.`);
      break;
    case "deleted":
      console.log(`Deleted venue ${describe(result.venue)}.`);
      break;
  }
} finally {
  await close();
}
