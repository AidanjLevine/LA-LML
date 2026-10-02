import { pgEnum } from "drizzle-orm/pg-core";

export const listingStatus = pgEnum("listing_status", ["active", "inactive"]);
export const artistKind = pgEnum("artist_kind", ["band", "dj", "solo", "cover"]);
export const eventStatus = pgEnum("event_status", ["draft", "confirmed", "cancelled"]);
export const ticketStatus = pgEnum("ticket_status", ["selling_fast", "sold_out"]);
export const eventArtistRole = pgEnum("event_artist_role", ["headliner", "support", "dj"]);
export const sourceKind = pgEnum("source_kind", [
  "manual",
  "bulk_paste",
  "venue_site",
  "ticketmaster",
  "flyer",
  "newsletter",
  "submission",
]);
export const reviewStatus = pgEnum("review_status", ["pending", "approved", "rejected", "merged"]);
export const proposalStatus = pgEnum("proposal_status", ["pending", "approved", "rejected"]);
export const proposalTargetType = pgEnum("proposal_target_type", [
  "neighborhood",
  "venue",
  "artist",
  "series",
  "event",
]);
