// Shared event schema, filters, query and serialization for every endpoint that returns events.
import { z } from "@hono/zod-openapi";
import { artists, eventArtists, events, neighborhoods, prices, venues, type Db } from "@lalml/db";
import { and, asc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { ApiError } from "./errors.js";
import { decodeCursor, paginate } from "./pagination.js";
import { latLng, TimeSchema } from "./serialize.js";
import { currentNight, timeOf } from "./time.js";
import { NeighborhoodRefSchema } from "./venues.js";

export const ARTIST_KINDS = ["band", "dj", "solo", "cover"] as const;
/** Window used when the client doesn't pass `from`/`to`, and the largest it may ask for. */
export const MAX_RANGE_DAYS = 7;
const DEFAULT_TIME_ZONE = "America/Los_Angeles";

// ---------- Schemas ----------

export const PriceSchema = z
  .object({
    cents: z.number().int().openapi({ example: 1500 }),
    description: z.string().nullable().openapi({ example: "door" }),
  })
  .openapi("Price");

export const LineupEntrySchema = z
  .object({
    artist: z.object({ slug: z.string(), name: z.string(), kind: z.enum(ARTIST_KINDS) }),
    role: z.enum(["headliner", "support", "dj"]),
    billing_order: z.number().int(),
    set_start: TimeSchema.nullable(),
    stage: z.string().nullable(),
  })
  .openapi("LineupEntry");

export const EventVenueSummarySchema = z
  .object({
    slug: z.string().openapi({ example: "the-echo" }),
    name: z.string().openapi({ example: "The Echo" }),
    neighborhood: NeighborhoodRefSchema.nullable(),
    lat: z.number(),
    lng: z.number(),
  })
  .openapi("EventVenueSummary");

const eventFields = {
  id: z.string().uuid(),
  title: z.string().nullable().openapi({ description: "Often null: the lineup is the title" }),
  local_date: z.string().openapi({ description: "The night of the show in the venue's time zone", example: "2026-10-02" }),
  start: TimeSchema.nullable(),
  doors: TimeSchema.nullable(),
  end: TimeSchema.nullable(),
  status: z.enum(["confirmed", "cancelled"]).openapi({ description: "Cancelled shows stay listed so people know" }),
  ticket_status: z.enum(["selling_fast", "sold_out"]).nullable(),
  is_free: z.boolean(),
  age_limit: z.string().nullable(),
  ticket_url: z.string().nullable(),
  lineup: z.array(LineupEntrySchema).openapi({ description: "In billing order" }),
  prices: z.array(PriceSchema),
  last_verified_at: z.string().nullable().openapi({ description: "ISO timestamp" }),
};

export const EventSchema = z.object({ ...eventFields, venue: EventVenueSummarySchema }).openapi("Event");
export type EventJson = z.infer<typeof EventSchema>;

// ---------- Query ----------

/** Never public: drafts and hidden events. Cancelled events are returned with their status. */
export const publicEvent = (): SQL[] => [ne(events.status, "draft"), eq(events.hidden, false)];

// Events sort by night, then start time with unknown times last, then id. The cursor is that tuple.
const UNKNOWN_START = 100_000;
const eventSortKey = sql`coalesce(${events.startMinutes}, ${sql.raw(String(UNKNOWN_START))})`;
const EventCursor = z.object({ d: z.string(), m: z.number(), id: z.string().uuid() });
export const eventOrder = [asc(events.localDate), asc(eventSortKey), asc(events.id)];

const eventRowColumns = {
  event: events,
  venue: { slug: venues.slug, name: venues.name, location: venues.location },
  neighborhood: { slug: neighborhoods.slug, name: neighborhoods.name },
};
type EventRow = {
  event: typeof events.$inferSelect;
  venue: { slug: string; name: string; location: { x: number; y: number } };
  neighborhood: { slug: string; name: string } | null;
};

/** events joined to their venue and neighborhood, so filters can use venue columns. */
export const eventsWithVenue = (db: Db) =>
  db
    .select(eventRowColumns)
    .from(events)
    .innerJoin(venues, eq(events.venueId, venues.id))
    .leftJoin(neighborhoods, eq(venues.neighborhoodId, neighborhoods.id));

/** A page of public events matching `conditions`, in date and start-time order, fully serialized. */
export async function listEvents(db: Db, conditions: SQL[], { limit, cursor }: { limit: number; cursor?: string }) {
  const where = [...publicEvent(), ...conditions];
  if (cursor) {
    const after = decodeCursor(cursor, EventCursor);
    where.push(sql`(${events.localDate}, ${eventSortKey}, ${events.id}) > (${after.d}::date, ${after.m}, ${after.id}::uuid)`);
  }
  const rows = await eventsWithVenue(db)
    .where(and(...where))
    .orderBy(...eventOrder)
    .limit(limit + 1);
  const { page, nextCursor } = paginate(rows, limit, ({ event }) => ({
    d: event.localDate,
    m: event.startMinutes ?? UNKNOWN_START,
    id: event.id,
  }));
  const details = await loadLineupsAndPrices(db, page.map((r) => r.event.id));
  return { data: page.map((row) => serializeEvent(row, details)), next_cursor: nextCursor };
}

export type EventDetails = Awaited<ReturnType<typeof loadLineupsAndPrices>>;

/** Lineups (billing order) and prices for many events in two queries. */
export async function loadLineupsAndPrices(db: Db, ids: string[]) {
  if (!ids.length) return { lineups: new Map<string, LineupJson[]>(), prices: new Map<string, PriceJson[]>() };
  const [lineupRows, priceRows] = await Promise.all([
    db
      .select({ entry: eventArtists, artist: { slug: artists.slug, name: artists.name, kind: artists.kind } })
      .from(eventArtists)
      .innerJoin(artists, eq(eventArtists.artistId, artists.id))
      .where(inArray(eventArtists.eventId, ids))
      .orderBy(asc(eventArtists.billingOrder), asc(artists.name)),
    db.select().from(prices).where(inArray(prices.eventId, ids)).orderBy(asc(prices.cents)),
  ]);
  const lineups = new Map<string, LineupJson[]>();
  for (const r of lineupRows) {
    const list = lineups.get(r.entry.eventId) ?? [];
    list.push({
      artist: r.artist,
      role: r.entry.role,
      billing_order: r.entry.billingOrder,
      set_start: timeOf(r.entry.setStartMinutes),
      stage: r.entry.stage,
    });
    lineups.set(r.entry.eventId, list);
  }
  const priceMap = new Map<string, PriceJson[]>();
  for (const p of priceRows) {
    priceMap.set(p.eventId, [...(priceMap.get(p.eventId) ?? []), { cents: p.cents, description: p.description }]);
  }
  return { lineups, prices: priceMap };
}

type LineupJson = z.infer<typeof LineupEntrySchema>;
type PriceJson = z.infer<typeof PriceSchema>;

export function serializeEventFields(e: typeof events.$inferSelect, details: EventDetails) {
  return {
    id: e.id,
    title: e.title,
    local_date: e.localDate,
    start: timeOf(e.startMinutes),
    doors: timeOf(e.doorsMinutes),
    end: timeOf(e.endMinutes),
    // Drafts never reach serialization (publicEvent filters them).
    status: e.status as "confirmed" | "cancelled",
    ticket_status: e.ticketStatus,
    is_free: e.isFree,
    age_limit: e.ageLimit,
    ticket_url: e.ticketUrl,
    lineup: details.lineups.get(e.id) ?? [],
    prices: details.prices.get(e.id) ?? [],
    last_verified_at: e.lastVerifiedAt?.toISOString() ?? null,
  };
}

export function serializeEvent({ event, venue, neighborhood }: EventRow, details: EventDetails): EventJson {
  return {
    ...serializeEventFields(event, details),
    venue: { slug: venue.slug, name: venue.name, neighborhood, ...latLng(venue.location) },
  };
}

/** Events on or after tonight in `timeZone` (tonight lasts until 5am). */
export const upcoming = (now: Date, timeZone = DEFAULT_TIME_ZONE): SQL =>
  sql`${events.localDate} >= ${currentNight(now, timeZone)}::date`;

/** Events whose lineup includes an artist matching `condition`. */
const lineupHas = (condition: SQL): SQL =>
  sql`exists (select 1 from ${eventArtists} inner join ${artists} on ${artists.id} = ${eventArtists.artistId}
    where ${eventArtists.eventId} = ${events.id} and ${condition})`;

export const lineupIncludesArtist = (artistId: string): SQL =>
  sql`exists (select 1 from ${eventArtists} where ${eventArtists.eventId} = ${events.id} and ${eventArtists.artistId} = ${artistId})`;

// ---------- Filters shared by /v1/events and /v1/map ----------

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), "not a real date");

function numberList(count: number, label: string) {
  return (value: string, ctx: z.RefinementCtx) => {
    const parts = value.split(",").map((p) => Number(p.trim()));
    if (parts.length !== count || parts.some((n) => !Number.isFinite(n))) {
      ctx.addIssue({ code: "custom", message: `expected ${label}` });
      return z.NEVER;
    }
    return parts;
  };
}

const inRange = (lat: number, lng: number) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

export const EventFilterQuery = {
  from: isoDate.optional().openapi({ description: "First night (YYYY-MM-DD). Default: tonight in Los Angeles", example: "2026-10-09" }),
  to: isoDate
    .optional()
    .openapi({ description: `Last night, inclusive. Default: from + ${MAX_RANGE_DAYS} days; at most ${MAX_RANGE_DAYS} days after from` }),
  neighborhood: z.string().optional().openapi({ description: "Neighborhood slug", example: "echo-park" }),
  region: z.string().optional().openapi({ example: "eastside" }),
  venue: z.string().optional().openapi({ description: "Venue slug", example: "the-echo" }),
  artist: z.string().optional().openapi({ description: "Artist slug: events with this artist in the lineup" }),
  kind: z.enum(ARTIST_KINDS).optional().openapi({ description: "Events with at least one artist of this kind" }),
  genre: z.string().optional().openapi({ description: "Events with at least one artist in this genre (see /v1/genres)" }),
  free: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true"))
    .openapi({ description: "Only free (true) or only paid (false) events" }),
  bbox: z
    .string()
    .optional()
    .openapi({ description: "minLng,minLat,maxLng,maxLat", example: "-118.30,34.05,-118.20,34.12" })
    .transform((v, ctx) => {
      if (v === undefined) return undefined;
      const parts = numberList(4, "bbox as minLng,minLat,maxLng,maxLat")(v, ctx);
      if (parts === z.NEVER) return z.NEVER;
      const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];
      if (!inRange(minLat, minLng) || !inRange(maxLat, maxLng) || minLng >= maxLng || minLat >= maxLat) {
        ctx.addIssue({ code: "custom", message: "bbox must be minLng,minLat,maxLng,maxLat with min < max" });
        return z.NEVER;
      }
      return { minLng, minLat, maxLng, maxLat };
    }),
  near: z
    .string()
    .optional()
    .openapi({ description: "lat,lng: events within `radius` meters of this point", example: "34.078,-118.26" })
    .transform((v, ctx) => {
      if (v === undefined) return undefined;
      const parts = numberList(2, "near as lat,lng")(v, ctx);
      if (parts === z.NEVER) return z.NEVER;
      const [lat, lng] = parts as [number, number];
      if (!inRange(lat, lng)) {
        ctx.addIssue({ code: "custom", message: "near is out of range" });
        return z.NEVER;
      }
      return { lat, lng };
    }),
  radius: z.coerce
    .number()
    .int()
    .min(1)
    .max(50_000)
    .optional()
    .openapi({ description: "Meters around `near` (default 2000, max 50000)", example: 2000 }),
};

type EventFilters = {
  from?: string;
  to?: string;
  neighborhood?: string;
  region?: string;
  venue?: string;
  artist?: string;
  kind?: (typeof ARTIST_KINDS)[number];
  genre?: string;
  free?: boolean;
  bbox?: { minLng: number; minLat: number; maxLng: number; maxLat: number };
  near?: { lat: number; lng: number };
  radius?: number;
};

export const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

/** SQL conditions for the shared filters, plus the resolved date window. Throws 400 on a bad range. */
export function eventFilterConditions(f: EventFilters, now: Date): { conditions: SQL[]; from: string; to: string } {
  const from = f.from ?? currentNight(now, DEFAULT_TIME_ZONE);
  const to = f.to ?? addDays(from, MAX_RANGE_DAYS);
  if (to < from) throw new ApiError(400, "invalid_request", "to: must be on or after from");
  if (daysBetween(from, to) > MAX_RANGE_DAYS) {
    throw new ApiError(400, "invalid_request", `to: at most ${MAX_RANGE_DAYS} days after from`);
  }
  if (f.radius !== undefined && !f.near) throw new ApiError(400, "invalid_request", "radius: only valid with near");

  const conditions: SQL[] = [sql`${events.localDate} between ${from}::date and ${to}::date`];
  if (f.neighborhood) conditions.push(eq(neighborhoods.slug, f.neighborhood));
  if (f.region) conditions.push(eq(venues.region, f.region));
  if (f.venue) conditions.push(eq(venues.slug, f.venue));
  if (f.artist) conditions.push(lineupHas(eq(artists.slug, f.artist)));
  if (f.kind) conditions.push(lineupHas(eq(artists.kind, f.kind)));
  if (f.genre) conditions.push(lineupHas(sql`${f.genre} = any(${artists.genres})`));
  if (f.free !== undefined) conditions.push(eq(events.isFree, f.free));
  if (f.bbox) {
    const { minLng, minLat, maxLng, maxLat } = f.bbox;
    conditions.push(
      sql`extensions.st_intersects(${venues.location}, extensions.st_makeenvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326))`,
    );
  }
  if (f.near) {
    const point = sql`extensions.st_setsrid(extensions.st_makepoint(${f.near.lng}, ${f.near.lat}), 4326)::extensions.geography`;
    conditions.push(sql`extensions.st_dwithin(${venues.location}::extensions.geography, ${point}, ${f.radius ?? 2000})`);
  }
  return { conditions, from, to };
}
