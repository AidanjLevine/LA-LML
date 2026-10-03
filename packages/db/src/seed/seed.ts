import { parse } from "csv-parse/sync";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { neighborhoods, sources, venues } from "../schema/index.js";
import { NEIGHBORHOODS } from "./neighborhoods.js";

export const SEED_SOURCE = { kind: "manual", name: "Seed data" } as const;

/** Columns of the venue audit template that the seed reads. Other template columns are ignored. */
const REQUIRED_COLUMNS = ["area", "neighborhood", "venue_name", "address", "latitude", "longitude"] as const;

// Rough Los Angeles County bounds, to catch swapped or mistyped coordinates.
const LA_BOUNDS = { minLat: 33.6, maxLat: 34.9, minLng: -118.95, maxLng: -117.6 };

export type SeedReport = {
  neighborhoods: number;
  venuesInserted: string[];
  venuesUpdated: string[];
  skipped: { line: number; venue: string; reason: string }[];
  warnings: string[];
};

type CsvRow = Record<string, string>;

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const blankToNull = (value: string | undefined) => (value?.trim() ? value.trim() : null);

/** "@handle", "handle" or an instagram.com URL -> "handle". */
function instagramHandle(value: string | undefined): string | null {
  const raw = blankToNull(value);
  if (!raw) return null;
  const fromUrl = raw.match(/instagram\.com\/([^/?#]+)/i)?.[1];
  return (fromUrl ?? raw).replace(/^@/, "");
}

/**
 * Seeds launch neighborhoods, the manual seed source, and venues from the venue audit CSV.
 * Idempotent: neighborhoods and venues upsert on slug, the source is reused. Runs in one transaction.
 */
export async function seed(db: Db, venuesCsv: string): Promise<SeedReport> {
  const records = parse(venuesCsv, { columns: true, skip_empty_lines: true, trim: true, info: true }) as {
    record: CsvRow;
    info: { lines: number };
  }[];
  const header = records[0] ? Object.keys(records[0].record) : [];
  const missing = REQUIRED_COLUMNS.filter((c) => records.length > 0 && !header.includes(c));
  if (missing.length) throw new Error(`venues CSV is missing columns: ${missing.join(", ")}`);

  const report: SeedReport = { neighborhoods: 0, venuesInserted: [], venuesUpdated: [], skipped: [], warnings: [] };

  await db.transaction(async (tx) => {
    const [existingSource] = await tx
      .select({ id: sources.id })
      .from(sources)
      .where(and(eq(sources.kind, SEED_SOURCE.kind), eq(sources.name, SEED_SOURCE.name)))
      .limit(1);
    if (!existingSource) await tx.insert(sources).values({ ...SEED_SOURCE, trustLevel: 100 });

    const hoods = await tx
      .insert(neighborhoods)
      .values(NEIGHBORHOODS.map((n) => ({ ...n, center: { ...n.center } })))
      .onConflictDoUpdate({
        target: neighborhoods.slug,
        set: {
          name: sql`excluded.name`,
          region: sql`excluded.region`,
          center: sql`excluded.center`,
          zoom: sql`excluded.zoom`,
        },
      })
      .returning({ id: neighborhoods.id, slug: neighborhoods.slug, name: neighborhoods.name, region: neighborhoods.region });
    report.neighborhoods = hoods.length;

    const hoodByName = new Map(hoods.flatMap((h) => [[h.name.toLowerCase(), h], [h.slug, h]] as const));
    const seenSlugs = new Set<string>();

    for (const { record: row, info } of records) {
      const line = info.lines;
      const name = blankToNull(row.venue_name);
      const skip = (reason: string) => report.skipped.push({ line, venue: name ?? "(no name)", reason });

      if (!name) {
        skip("missing venue_name");
        continue;
      }
      const slug = slugify(name);
      if (seenSlugs.has(slug)) {
        skip(`duplicate venue (slug "${slug}" already used earlier in the CSV)`);
        continue;
      }

      const latText = blankToNull(row.latitude);
      const lngText = blankToNull(row.longitude);
      if (!latText || !lngText) {
        skip("missing coordinates");
        continue;
      }
      const lat = Number(latText);
      const lng = Number(lngText);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        skip(`invalid coordinates (${latText}, ${lngText})`);
        continue;
      }
      if (lat < LA_BOUNDS.minLat || lat > LA_BOUNDS.maxLat || lng < LA_BOUNDS.minLng || lng > LA_BOUNDS.maxLng) {
        report.warnings.push(`line ${line} ${name}: coordinates (${lat}, ${lng}) are outside Los Angeles; check for swapped values`);
      }

      const address = blankToNull(row.address);
      if (!address) {
        skip("missing address");
        continue;
      }

      const hoodName = blankToNull(row.neighborhood);
      const hood = hoodName ? (hoodByName.get(hoodName.toLowerCase()) ?? hoodByName.get(slugify(hoodName))) : undefined;
      if (hoodName && !hood) {
        report.warnings.push(`line ${line} ${name}: neighborhood "${hoodName}" not found; imported without one`);
      }

      const area = blankToNull(row.area)?.toLowerCase() ?? null;
      const region = hood?.region ?? area;
      if (!region) {
        skip("missing area and no matching neighborhood");
        continue;
      }
      if (hood && area && area !== hood.region) {
        report.warnings.push(`line ${line} ${name}: area "${row.area}" differs from ${hood.name}'s region "${hood.region}"; used "${hood.region}"`);
      }

      const capacityText = blankToNull(row.capacity);
      const capacity = capacityText ? Number.parseInt(capacityText, 10) : null;
      if (capacityText && !Number.isInteger(capacity)) {
        report.warnings.push(`line ${line} ${name}: capacity "${capacityText}" isn't a number; left empty`);
      }

      const values = {
        slug,
        name,
        address,
        neighborhoodId: hood?.id ?? null,
        region,
        location: { x: lng, y: lat },
        capacity: Number.isInteger(capacity) ? capacity : null,
        agePolicy: blankToNull(row.age_policy),
        website: blankToNull(row.website),
        instagram: instagramHandle(row.instagram),
        facebook: blankToNull(row.facebook),
        dice: blankToNull(row.dice_url),
      };
      const [result] = await tx
        .insert(venues)
        .values(values)
        .onConflictDoUpdate({ target: venues.slug, set: { ...values, slug: undefined } })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      seenSlugs.add(slug);
      (result?.inserted ? report.venuesInserted : report.venuesUpdated).push(slug);
    }
  });

  return report;
}
