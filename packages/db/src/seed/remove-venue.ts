import { and, eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { events, proposals, series, venues } from "../schema/index.js";

type RemovedVenue = { id: string; slug: string; name: string; address: string };

export type RemoveVenueResult =
  | { status: "not_found"; slug: string }
  | { status: "blocked"; venue: RemovedVenue; events: number; series: number; proposals: number }
  | { status: "would_delete" | "deleted"; venue: RemovedVenue };

/**
 * Removes one venue by slug, but only if nothing refers to it: no events (cancelled ones count,
 * since events are never deleted), no series and no proposals targeting it. Dry run unless `commit`.
 * Runs in one transaction with the venue row locked. The foreign keys' `restrict` is the backstop.
 */
export async function removeVenue(db: Db, slug: string, { commit = false } = {}): Promise<RemoveVenueResult> {
  return db.transaction(async (tx) => {
    const [venue] = await tx
      .select({ id: venues.id, slug: venues.slug, name: venues.name, address: venues.address })
      .from(venues)
      .where(eq(venues.slug, slug))
      .for("update");
    if (!venue) return { status: "not_found", slug };

    const refs = {
      events: await tx.$count(events, eq(events.venueId, venue.id)),
      series: await tx.$count(series, eq(series.venueId, venue.id)),
      proposals: await tx.$count(proposals, and(eq(proposals.targetType, "venue"), eq(proposals.targetId, venue.id))),
    };
    if (refs.events || refs.series || refs.proposals) return { status: "blocked", venue, ...refs };
    if (!commit) return { status: "would_delete", venue };

    const [deleted] = await tx
      .delete(venues)
      .where(eq(venues.id, venue.id))
      .returning({ id: venues.id, slug: venues.slug, name: venues.name, address: venues.address });
    if (!deleted) throw new Error(`venue "${slug}" disappeared during removal`);
    return { status: "deleted", venue: deleted };
  });
}
