import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { artists } from "./artists.js";
import { id, timestamps } from "./columns.js";
import { eventArtistRole, eventStatus, ticketStatus } from "./enums.js";
import { venues } from "./places.js";

/**
 * Times are minutes after midnight on `local_date`, in the venue's time zone.
 * Values from 1440 up mean after midnight: a 1am set on Friday's show is 1500 with Friday's date.
 */
export const MAX_MINUTES = 2879;

const minutesInRange = (column: AnyPgColumn): SQL => sql`${column} between 0 and ${sql.raw(String(MAX_MINUTES))}`;

export const series = pgTable("series", {
  id: id(),
  venueId: uuid("venue_id")
    .notNull()
    .references(() => venues.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  recurrenceRule: text("recurrence_rule"),
  ...timestamps,
}).enableRLS();

// Never delete events: set status to 'cancelled' instead.
export const events = pgTable(
  "events",
  {
    id: id(),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "restrict" }),
    seriesId: uuid("series_id").references(() => series.id, { onDelete: "restrict" }),
    title: text("title"),
    localDate: date("local_date").notNull(),
    startMinutes: integer("start_minutes"),
    doorsMinutes: integer("doors_minutes"),
    endMinutes: integer("end_minutes"),
    isFree: boolean("is_free").notNull().default(false),
    ageLimit: text("age_limit"),
    ticketUrl: text("ticket_url"),
    status: eventStatus("status").notNull().default("draft"),
    ticketStatus: ticketStatus("ticket_status"),
    hidden: boolean("hidden").notNull().default(false),
    checked: boolean("checked").notNull().default(false),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("events_venue_id_local_date_idx").on(t.venueId, t.localDate),
    index("events_local_date_idx").on(t.localDate),
    index("events_series_id_idx").on(t.seriesId),
    check("events_start_minutes_range", minutesInRange(t.startMinutes)),
    check("events_doors_minutes_range", minutesInRange(t.doorsMinutes)),
    check("events_end_minutes_range", minutesInRange(t.endMinutes)),
  ],
).enableRLS();

export const eventArtists = pgTable(
  "event_artists",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "restrict" }),
    billingOrder: integer("billing_order").notNull().default(0),
    role: eventArtistRole("role").notNull(),
    setStartMinutes: integer("set_start_minutes"),
    stage: text("stage"),
    ...timestamps,
  },
  (t) => [
    unique("event_artists_event_id_artist_id_unique").on(t.eventId, t.artistId),
    index("event_artists_artist_id_idx").on(t.artistId),
    check("event_artists_set_start_minutes_range", minutesInRange(t.setStartMinutes)),
  ],
).enableRLS();

export const prices = pgTable(
  "prices",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    cents: integer("cents").notNull(),
    description: text("description"),
    ...timestamps,
  },
  (t) => [index("prices_event_id_idx").on(t.eventId), check("prices_cents_nonnegative", sql`${t.cents} >= 0`)],
).enableRLS();
