// Resolves parsed shows against the database: venues, artists, duplicates. Only reads (SELECT),
// so a dry run can never write. apply.ts writes the result.
import { createHash } from "node:crypto";
import { artists, eventArtists, events, slugify, sourceRecords, sources, venues, type Db } from "@lalml/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { ArtistKind, ParseResult, PastedShow, PasteIssue } from "./parse.js";

export const BULK_PASTE_SOURCE = { kind: "bulk_paste", name: "Bulk paste" } as const;

/**
 * Trigram similarity needed to reuse an existing artist for a differently spelled name.
 * Deliberately high: band names are short, so pg_trgm's default 0.3 would merge different acts
 * ("The Echo" and "The Ekho" score 0.5), and a wrong merge puts a show on the wrong artist,
 * while a duplicate artist is easy to merge later. Names between NEAR_MISS and this get a warning.
 */
export const FUZZY_MATCH_THRESHOLD = 0.7;
export const NEAR_MISS_THRESHOLD = 0.4;

export type ArtistResolution =
  | {
      type: "existing";
      id: string;
      name: string;
      slug: string;
      kind: ArtistKind;
      via: "slug" | "alias" | "fuzzy";
      similarity?: number;
    }
  | {
      type: "new";
      name: string;
      slug: string;
      kind: ArtistKind;
      kindAssumed: boolean;
      nearMiss?: { name: string; similarity: number };
    };

export type ShowAction =
  | { type: "create" }
  /** Another source for an existing event; the event isn't changed. */
  | { type: "link"; eventId: string; cancelled: boolean }
  /** Same show as an earlier line in this paste: link to whatever that line creates or links. */
  | { type: "link-line"; line: number }
  | { type: "skip"; reason: string };

export type PlannedShow = {
  show: PastedShow;
  hash: string;
  venue: { id: string; slug: string; name: string };
  artists: ArtistResolution[];
  action: ShowAction;
};

export type Plan = {
  shows: PlannedShow[];
  errors: PasteIssue[];
  warnings: PasteIssue[];
  sourceId: string | null;
};

/** sha256 of the parsed show's content (not its line number or source URL): identical pastes hash the same. */
export function showHash(show: PastedShow): string {
  const canonical = {
    venue: show.venueSlug,
    date: show.localDate,
    start: show.startMinutes,
    doors: show.doorsMinutes,
    lineup: show.lineup.map((a) => [a.name, a.kind]),
    prices: show.prices.map((p) => [p.cents, p.description]),
    free: show.isFree,
    age: show.ageLimit,
    ticket: show.ticketUrl,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Key identifying an artist across the paste: an existing id, or the slug a new artist will get. */
const artistKey = (a: ArtistResolution) => (a.type === "existing" ? a.id : `new:${a.slug}`);

export async function planPaste(db: Db, parsed: ParseResult): Promise<Plan> {
  const errors: PasteIssue[] = [...parsed.errors];
  const warnings: PasteIssue[] = [];

  // Venues
  const slugs = [...new Set(parsed.shows.map((s) => s.venueSlug))];
  const venueRows = slugs.length
    ? await db
        .select({ id: venues.id, slug: venues.slug, name: venues.name })
        .from(venues)
        .where(inArray(venues.slug, slugs))
    : [];
  const venueBySlug = new Map(venueRows.map((v) => [v.slug, v]));
  const unknown = new Map<string, { line: number; count: number }>();
  for (const show of parsed.shows) {
    if (venueBySlug.has(show.venueSlug)) continue;
    const entry = unknown.get(show.venueSlug) ?? { line: show.venueLine, count: 0 };
    entry.count++;
    unknown.set(show.venueSlug, entry);
  }
  for (const [slug, { line, count }] of unknown) {
    errors.push({ line, message: `unknown venue "@${slug}" (${count} show${count === 1 ? "" : "s"} not processed)` });
  }
  const shows = parsed.shows.filter((s) => venueBySlug.has(s.venueSlug));

  // Previously imported pastes (exact content match)
  const [source] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.kind, BULK_PASTE_SOURCE.kind), eq(sources.name, BULK_PASTE_SOURCE.name)))
    .limit(1);
  const hashes = shows.map(showHash);
  const imported = new Map<string, string | null>();
  if (source && hashes.length) {
    const rows = await db
      .select({ hash: sourceRecords.externalId, eventId: sourceRecords.eventId })
      .from(sourceRecords)
      .where(and(eq(sourceRecords.sourceId, source.id), inArray(sourceRecords.externalId, hashes)));
    for (const r of rows) if (r.hash) imported.set(r.hash, r.eventId);
  }

  // Artists
  const resolved = new Map<string, ArtistResolution>();
  const newBySlug = new Map<string, Extract<ArtistResolution, { type: "new" }>>();
  const reported = new Set<string>();
  async function resolveArtist(name: string, kind: ArtistKind | null, line: number): Promise<ArtistResolution | null> {
    const cacheKey = name.toLowerCase();
    const cached = resolved.get(cacheKey);
    if (cached) return cached;
    const slug = slugify(name);
    if (!slug) {
      errors.push({ line, message: `can't make a URL slug from the artist name "${name}"` });
      return null;
    }
    const columns = { id: artists.id, name: artists.name, slug: artists.slug, kind: artists.kind };

    let resolution: ArtistResolution | undefined;
    const [bySlug] = await db.select(columns).from(artists).where(eq(artists.slug, slug)).limit(1);
    if (bySlug) resolution = { type: "existing", ...bySlug, via: "slug" };

    if (!resolution) {
      const [byAlias] = await db
        .select(columns)
        .from(artists)
        .where(sql`exists (select 1 from unnest(${artists.aliases}) as alias where lower(alias) = lower(${name}))`)
        .orderBy(artists.slug)
        .limit(1);
      if (byAlias) resolution = { type: "existing", ...byAlias, via: "alias" };
    }

    let nearMiss: { name: string; similarity: number } | undefined;
    if (!resolution) {
      // `%` uses the trigram index (candidates at pg_trgm's 0.3 threshold); our cutoffs apply below.
      const similarity = sql<number>`extensions.similarity(${artists.name}, ${name})`;
      const [best] = await db
        .select({ ...columns, similarity })
        .from(artists)
        .where(sql`${artists.name} OPERATOR(extensions.%) ${name}`)
        .orderBy(sql`${similarity} desc`, artists.slug)
        .limit(1);
      const score = best ? round(best.similarity) : 0;
      if (best && score >= FUZZY_MATCH_THRESHOLD) {
        resolution = { type: "existing", id: best.id, name: best.name, slug: best.slug, kind: best.kind, via: "fuzzy", similarity: score };
      } else if (best && score >= NEAR_MISS_THRESHOLD) {
        nearMiss = { name: best.name, similarity: score };
      }
    }

    // Same thresholds against artists this paste will create, so a typo of a brand-new band on a
    // later line doesn't create a second artist.
    let pasteMatch: { artist: Extract<ArtistResolution, { type: "new" }>; similarity: number } | undefined;
    if (!resolution && !newBySlug.has(slug) && newBySlug.size) {
      const candidates = [...newBySlug.values()];
      const names = sql.join(candidates.map((c) => sql`${c.name}`), sql`, `);
      const scores = await db
        .select({ name: sql<string>`candidate`, similarity: sql<number>`extensions.similarity(candidate, ${name})` })
        .from(sql`unnest(array[${names}]::text[]) as candidate`);
      const best = scores.map((s) => ({ ...s, similarity: round(s.similarity) })).sort((a, b) => b.similarity - a.similarity)[0];
      const artist = best && candidates.find((c) => c.name === best.name);
      if (best && artist && best.similarity >= FUZZY_MATCH_THRESHOLD) {
        resolution = artist;
        pasteMatch = { artist, similarity: best.similarity };
      } else if (best && best.similarity >= NEAR_MISS_THRESHOLD && (!nearMiss || best.similarity > nearMiss.similarity)) {
        nearMiss = { name: `${best.name} (new in this paste)`, similarity: best.similarity };
      }
    }

    if (!resolution) {
      resolution = newBySlug.get(slug) ?? { type: "new", name, slug, kind: kind ?? "band", kindAssumed: !kind, nearMiss };
      if (resolution.type === "new") newBySlug.set(slug, resolution);
    }
    resolved.set(cacheKey, resolution);
    if (pasteMatch) {
      warnings.push({
        line,
        message: `"${name}" matched "${pasteMatch.artist.name}", a new artist earlier in this paste (similarity ${pasteMatch.similarity})`,
      });
      return resolution;
    }

    if (!reported.has(resolution.type === "existing" ? resolution.id : `new:${slug}`)) {
      reported.add(resolution.type === "existing" ? resolution.id : `new:${slug}`);
      if (resolution.type === "new") {
        const kindNote = resolution.kindAssumed ? `, kind not given so assuming band` : ` (${resolution.kind})`;
        warnings.push({ line, message: `new artist "${resolution.name}" will be created${kindNote}` });
        if (resolution.nearMiss) {
          warnings.push({
            line,
            message: `"${name}" looks like existing artist "${resolution.nearMiss.name}" (similarity ${resolution.nearMiss.similarity}, below ${FUZZY_MATCH_THRESHOLD}); creating a new artist. Fix the spelling to use the existing one`,
          });
        }
      } else if (resolution.via === "alias") {
        warnings.push({ line, message: `"${name}" matched existing artist "${resolution.name}" by alias` });
      } else if (resolution.via === "fuzzy") {
        warnings.push({ line, message: `"${name}" matched existing artist "${resolution.name}" (similarity ${resolution.similarity})` });
      }
    }
    return resolution;
  }

  const planned: PlannedShow[] = [];
  for (const [i, show] of shows.entries()) {
    const resolutions: ArtistResolution[] = [];
    for (const a of show.lineup) {
      const r = await resolveArtist(a.name, a.kind, show.line);
      if (r) resolutions.push(r);
    }
    if (resolutions.length !== show.lineup.length) continue;
    planned.push({ show, hash: hashes[i]!, venue: venueBySlug.get(show.venueSlug)!, artists: resolutions, action: { type: "create" } });
  }

  // Existing events on the same venue and night, with their lineups
  const nights = [...new Map(planned.map((p) => [`${p.venue.id}|${p.show.localDate}`, p])).values()];
  const existing = nights.length
    ? await db
        .select({ id: events.id, venueId: events.venueId, localDate: events.localDate, status: events.status, artistId: eventArtists.artistId })
        .from(events)
        .leftJoin(eventArtists, eq(eventArtists.eventId, events.id))
        .where(or(...nights.map((p) => and(eq(events.venueId, p.venue.id), eq(events.localDate, p.show.localDate)))))
    : [];
  const existingEvents = new Map<string, { id: string; night: string; cancelled: boolean; artists: Set<string> }>();
  for (const row of existing) {
    const event = existingEvents.get(row.id) ?? {
      id: row.id,
      night: `${row.venueId}|${row.localDate}`,
      cancelled: row.status === "cancelled",
      artists: new Set<string>(),
    };
    if (row.artistId) event.artists.add(row.artistId);
    existingEvents.set(row.id, event);
  }

  // Decide each show's action, in file order
  const earlier: { night: string; artists: Set<string>; line: number; hash: string }[] = [];
  const describe = (p: PlannedShow) => `${p.show.localDate} at @${p.venue.slug}`;
  for (const p of planned) {
    const night = `${p.venue.id}|${p.show.localDate}`;
    const keys = new Set(p.artists.map(artistKey));
    const overlaps = (other: Set<string>) => [...keys].some((k) => other.has(k));

    const sameHashEarlier = earlier.find((e) => e.hash === p.hash);
    const sameShowEarlier = earlier.find((e) => e.night === night && overlaps(e.artists));
    const existingEvent = [...existingEvents.values()].find((e) => e.night === night && overlaps(e.artists));

    if (imported.has(p.hash)) {
      p.action = { type: "skip", reason: "already imported (identical paste)" };
      warnings.push({ line: p.show.line, message: `already imported earlier (identical line); skipping` });
    } else if (sameHashEarlier) {
      p.action = { type: "skip", reason: `identical to line ${sameHashEarlier.line}` };
      warnings.push({ line: p.show.line, message: `identical to line ${sameHashEarlier.line}; skipping` });
    } else if (existingEvent) {
      p.action = { type: "link", eventId: existingEvent.id, cancelled: existingEvent.cancelled };
      const shared = p.artists.filter((a) => a.type === "existing" && existingEvent.artists.has(a.id)).map((a) => a.name);
      warnings.push({
        line: p.show.line,
        message:
          `possible duplicate: existing event ${existingEvent.id} on ${describe(p)} also has ${shared.join(", ")}; ` +
          `will link this paste as another source and leave the event unchanged` +
          (existingEvent.cancelled ? " (note: that event is cancelled)" : ""),
      });
    } else if (sameShowEarlier) {
      p.action = { type: "link-line", line: sameShowEarlier.line };
      warnings.push({
        line: p.show.line,
        message: `possible duplicate of line ${sameShowEarlier.line} (${describe(p)}, overlapping lineup); will link to that show, not create another`,
      });
    }
    earlier.push({ night, artists: keys, line: p.show.line, hash: p.hash });
  }

  warnings.sort((a, b) => a.line - b.line);
  errors.sort((a, b) => a.line - b.line);
  return { shows: planned, errors, warnings, sourceId: source?.id ?? null };
}

const round = (n: number) => Math.round(Number(n) * 100) / 100;
