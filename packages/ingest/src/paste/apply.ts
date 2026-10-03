// Writes a plan. Call inside one transaction (see commitPaste) so a failure leaves nothing behind.
import { artists, eventArtists, events, eventSources, prices, sourceRecords, sources, type Db } from "@lalml/db";
import type { ParseResult } from "./parse.js";
import { BULK_PASTE_SOURCE, planPaste, type ArtistResolution, type Plan } from "./plan.js";

export type ApplySummary = {
  eventsCreated: number;
  linkedToExisting: number;
  artistsCreated: number;
  skipped: number;
};

type Role = "headliner" | "support" | "dj";

/** DJs get role dj; the first other act headlines; everyone else supports. */
export function lineupRoles(lineup: ArtistResolution[]): Role[] {
  let headlinerTaken = false;
  return lineup.map((a) => {
    if (a.kind === "dj") return "dj";
    if (!headlinerTaken) {
      headlinerTaken = true;
      return "headliner";
    }
    return "support";
  });
}

export async function applyPlan(db: Db, plan: Plan, { file, now }: { file: string; now: Date }): Promise<ApplySummary> {
  if (plan.errors.length) throw new Error(`refusing to write: ${plan.errors.length} error(s) in the paste`);
  const summary: ApplySummary = { eventsCreated: 0, linkedToExisting: 0, artistsCreated: 0, skipped: 0 };

  const sourceId =
    plan.sourceId ??
    (await db.insert(sources).values({ ...BULK_PASTE_SOURCE, trustLevel: 100 }).returning({ id: sources.id }))[0]!.id;

  // New artists, once each
  const artistIds = new Map<string, string>();
  for (const p of plan.shows) {
    if (p.action.type === "skip") continue;
    for (const a of p.artists) {
      if (a.type === "existing") artistIds.set(a.slug, a.id);
      else if (!artistIds.has(a.slug)) {
        const [row] = await db
          .insert(artists)
          .values({ name: a.name, slug: a.slug, kind: a.kind })
          .returning({ id: artists.id });
        artistIds.set(a.slug, row!.id);
        summary.artistsCreated++;
      }
    }
  }

  const eventByLine = new Map<number, string>();
  for (const p of plan.shows) {
    const { show, action } = p;
    if (action.type === "skip") {
      summary.skipped++;
      continue;
    }

    let eventId: string;
    if (action.type === "create") {
      const [event] = await db
        .insert(events)
        .values({
          venueId: p.venue.id,
          localDate: show.localDate,
          startMinutes: show.startMinutes,
          doorsMinutes: show.doorsMinutes,
          isFree: show.isFree,
          ageLimit: show.ageLimit,
          ticketUrl: show.ticketUrl,
          status: "confirmed",
          checked: false,
          hidden: false,
          lastVerifiedAt: now,
        })
        .returning({ id: events.id });
      eventId = event!.id;
      const roles = lineupRoles(p.artists);
      await db.insert(eventArtists).values(
        p.artists.map((a, i) => ({ eventId, artistId: artistIds.get(a.slug)!, billingOrder: i, role: roles[i]! })),
      );
      if (show.prices.length) {
        await db.insert(prices).values(show.prices.map((price) => ({ eventId, ...price })));
      }
      summary.eventsCreated++;
    } else {
      const target = action.type === "link" ? action.eventId : eventByLine.get(action.line);
      if (!target) throw new Error(`line ${show.line}: nothing to link to on line ${action.type === "link-line" ? action.line : "?"}`);
      eventId = target;
      summary.linkedToExisting++;
    }
    eventByLine.set(show.line, eventId);

    const [record] = await db
      .insert(sourceRecords)
      .values({
        sourceId,
        externalId: p.hash,
        contentHash: p.hash,
        url: show.sourceUrl,
        fetchedAt: now,
        rawPayload: { file, line: show.line, text: show.raw },
        extracted: show,
        confidence: 1,
        reviewStatus: action.type === "create" ? "approved" : "merged",
        eventId,
      })
      .returning({ id: sourceRecords.id });
    await db.insert(eventSources).values({ eventId, sourceRecordId: record!.id });
  }

  return summary;
}

/**
 * Plans and writes in one transaction, so the plan is checked against the same state it writes to
 * and any failure rolls everything back. Throws if the paste has errors.
 */
export async function commitPaste(db: Db, parsed: ParseResult, options: { file: string; now: Date }) {
  return db.transaction(async (tx) => {
    const plan = await planPaste(tx, parsed);
    if (plan.errors.length) return { plan, summary: null };
    return { plan, summary: await applyPlan(tx, plan, options) };
  });
}
