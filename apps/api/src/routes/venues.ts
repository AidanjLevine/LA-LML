import { createRoute, z } from "@hono/zod-openapi";
import { artists, eventArtists, events, neighborhoods, prices, venues, type Db } from "@lalml/db";
import { and, asc, eq, gt, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { ApiError, errorResponses } from "../lib/errors.js";
import { decodeCursor, nextCursorSchema, paginate, PaginationQuery } from "../lib/pagination.js";
import { createRouter } from "../lib/router.js";
import { latLng, TimeSchema } from "../lib/serialize.js";
import { currentNight, timeOf } from "../lib/time.js";

// ---------- Schemas ----------

const SlugParam = z.object({
  slug: z.string().min(1).openapi({ param: { name: "slug", in: "path" }, example: "the-echo" }),
});

export const VenueSchema = z
  .object({
    id: z.string().uuid(),
    slug: z.string().openapi({ example: "the-echo" }),
    name: z.string().openapi({ example: "The Echo" }),
    address: z.string(),
    neighborhood: z.object({ slug: z.string(), name: z.string() }).nullable(),
    region: z.string().openapi({ example: "eastside" }),
    time_zone: z.string().openapi({ example: "America/Los_Angeles" }),
    lat: z.number().openapi({ example: 34.0779 }),
    lng: z.number().openapi({ example: -118.2606 }),
    capacity: z.number().int().nullable(),
    age_policy: z.string().nullable().openapi({ example: "21+" }),
    website: z.string().nullable(),
    instagram: z.string().nullable().openapi({ description: "Handle without @" }),
    facebook: z.string().nullable(),
    tiktok: z.string().nullable(),
    dice: z.string().nullable(),
    status: z.enum(["active", "inactive"]),
  })
  .openapi("Venue");

const PriceSchema = z
  .object({
    cents: z.number().int().openapi({ example: 1500 }),
    description: z.string().nullable().openapi({ example: "door" }),
  })
  .openapi("Price");

const LineupEntrySchema = z
  .object({
    artist: z.object({
      slug: z.string(),
      name: z.string(),
      kind: z.enum(["band", "dj", "solo", "cover"]),
    }),
    role: z.enum(["headliner", "support", "dj"]),
    billing_order: z.number().int(),
    set_start: TimeSchema.nullable(),
    stage: z.string().nullable(),
  })
  .openapi("LineupEntry");

export const VenueEventSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().nullable(),
    local_date: z.string().openapi({ description: "The night of the show in the venue's time zone", example: "2026-10-02" }),
    start: TimeSchema.nullable(),
    doors: TimeSchema.nullable(),
    end: TimeSchema.nullable(),
    status: z.enum(["confirmed", "cancelled"]).openapi({ description: "Cancelled shows stay listed so people know" }),
    ticket_status: z.enum(["selling_fast", "sold_out"]).nullable(),
    is_free: z.boolean(),
    age_limit: z.string().nullable(),
    ticket_url: z.string().nullable(),
    lineup: z.array(LineupEntrySchema),
    prices: z.array(PriceSchema),
    last_verified_at: z.string().nullable().openapi({ description: "ISO timestamp" }),
  })
  .openapi("VenueEvent");

// ---------- Queries ----------

const venueColumns = {
  venue: venues,
  neighborhood: { slug: neighborhoods.slug, name: neighborhoods.name },
};

type VenueRow = {
  venue: typeof venues.$inferSelect;
  neighborhood: { slug: string; name: string } | null;
};

function serializeVenue({ venue: v, neighborhood }: VenueRow): z.infer<typeof VenueSchema> {
  const { lat, lng } = latLng(v.location);
  return {
    id: v.id,
    slug: v.slug,
    name: v.name,
    address: v.address,
    neighborhood,
    region: v.region,
    time_zone: v.timeZone,
    lat,
    lng,
    capacity: v.capacity,
    age_policy: v.agePolicy,
    website: v.website,
    instagram: v.instagram,
    facebook: v.facebook,
    tiktok: v.tiktok,
    dice: v.dice,
    status: v.status,
  };
}

async function findVenue(db: Db, slug: string): Promise<VenueRow> {
  const [row] = await db
    .select(venueColumns)
    .from(venues)
    .leftJoin(neighborhoods, eq(venues.neighborhoodId, neighborhoods.id))
    .where(eq(venues.slug, slug))
    .limit(1);
  if (!row) throw new ApiError(404, "not_found", `No venue with slug '${slug}'`);
  return row;
}

/** Escapes LIKE wildcards so `q` is matched literally. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

// Events sort by night, then start time with unknown times last, then id. The cursor is that tuple.
const UNKNOWN_START = 100_000;
const eventSortKey = sql`coalesce(${events.startMinutes}, ${sql.raw(String(UNKNOWN_START))})`;
const EventCursor = z.object({ d: z.string(), m: z.number(), id: z.string().uuid() });

// ---------- Routes ----------

const listVenues = createRoute({
  method: "get",
  path: "/v1/venues",
  tags: ["venues"],
  summary: "List venues",
  description: "Active venues, ordered by slug. `q` matches names by substring or similarity (typo-tolerant).",
  request: {
    query: z.object({
      neighborhood: z.string().optional().openapi({ description: "Neighborhood slug", example: "echo-park" }),
      region: z.string().optional().openapi({ example: "eastside" }),
      q: z.string().trim().min(1).max(100).optional().openapi({ description: "Name search", example: "echo" }),
      ...PaginationQuery,
    }),
  },
  responses: {
    200: {
      description: "A page of venues",
      content: {
        "application/json": { schema: z.object({ data: z.array(VenueSchema), next_cursor: nextCursorSchema }) },
      },
    },
    400: errorResponses[400],
  },
});

const getVenue = createRoute({
  method: "get",
  path: "/v1/venues/{slug}",
  tags: ["venues"],
  summary: "Get a venue",
  request: { params: SlugParam },
  responses: {
    200: { description: "The venue", content: { "application/json": { schema: z.object({ data: VenueSchema }) } } },
    404: errorResponses[404],
  },
});

const listVenueEvents = createRoute({
  method: "get",
  path: "/v1/venues/{slug}/events",
  tags: ["venues", "events"],
  summary: "Upcoming events at a venue",
  description:
    "Events from tonight onward in the venue's time zone, ordered by night and start time. " +
    "Tonight lasts until 5am, so a set after midnight stays listed under the night it belongs to. " +
    "Draft and hidden events are never returned; cancelled events are, with status `cancelled`.",
  request: {
    params: SlugParam,
    query: z.object(PaginationQuery),
  },
  responses: {
    200: {
      description: "A page of upcoming events",
      content: {
        "application/json": { schema: z.object({ data: z.array(VenueEventSchema), next_cursor: nextCursorSchema }) },
      },
    },
    400: errorResponses[400],
    404: errorResponses[404],
  },
});

export const venuesRouter = createRouter()
  .openapi(listVenues, async (c) => {
    const { neighborhood, region, q, limit, cursor } = c.req.valid("query");
    const conditions: (SQL | undefined)[] = [eq(venues.status, "active")];
    if (neighborhood) conditions.push(eq(neighborhoods.slug, neighborhood));
    if (region) conditions.push(eq(venues.region, region));
    if (q) {
      // Both predicates can use the trigram GIN index on venues.name.
      conditions.push(or(ilike(venues.name, `%${escapeLike(q)}%`), sql`${venues.name} OPERATOR(extensions.%) ${q}`));
    }
    if (cursor) conditions.push(gt(venues.slug, decodeCursor(cursor, z.object({ slug: z.string() })).slug));

    const rows = await c.var
      .db()
      .select(venueColumns)
      .from(venues)
      .leftJoin(neighborhoods, eq(venues.neighborhoodId, neighborhoods.id))
      .where(and(...conditions))
      .orderBy(asc(venues.slug))
      .limit(limit + 1);

    const { page, nextCursor } = paginate(rows, limit, (last) => ({ slug: last.venue.slug }));
    return c.json({ data: page.map(serializeVenue), next_cursor: nextCursor }, 200);
  })
  .openapi(getVenue, async (c) => {
    const venue = await findVenue(c.var.db(), c.req.valid("param").slug);
    return c.json({ data: serializeVenue(venue) }, 200);
  })
  .openapi(listVenueEvents, async (c) => {
    const db = c.var.db();
    const { venue } = await findVenue(db, c.req.valid("param").slug);
    const { limit, cursor } = c.req.valid("query");
    const tonight = currentNight(c.var.now(), venue.timeZone);

    const conditions: SQL[] = [
      eq(events.venueId, venue.id),
      sql`${events.localDate} >= ${tonight}::date`,
      ne(events.status, "draft"),
      eq(events.hidden, false),
    ];
    if (cursor) {
      const after = decodeCursor(cursor, EventCursor);
      conditions.push(sql`(${events.localDate}, ${eventSortKey}, ${events.id}) > (${after.d}::date, ${after.m}, ${after.id}::uuid)`);
    }

    const rows = await db
      .select()
      .from(events)
      .where(and(...conditions))
      .orderBy(asc(events.localDate), asc(eventSortKey), asc(events.id))
      .limit(limit + 1);
    const { page, nextCursor } = paginate(rows, limit, (last) => ({
      d: last.localDate,
      m: last.startMinutes ?? UNKNOWN_START,
      id: last.id,
    }));

    // Lineups and prices for the whole page in two queries.
    const ids = page.map((e) => e.id);
    const [lineupRows, priceRows] = ids.length
      ? await Promise.all([
          db
            .select({ entry: eventArtists, artist: { slug: artists.slug, name: artists.name, kind: artists.kind } })
            .from(eventArtists)
            .innerJoin(artists, eq(eventArtists.artistId, artists.id))
            .where(inArray(eventArtists.eventId, ids))
            .orderBy(asc(eventArtists.billingOrder), asc(artists.name)),
          db.select().from(prices).where(inArray(prices.eventId, ids)).orderBy(asc(prices.cents)),
        ])
      : [[], []];

    const data = page.map((e) => ({
      id: e.id,
      title: e.title,
      local_date: e.localDate,
      start: timeOf(e.startMinutes),
      doors: timeOf(e.doorsMinutes),
      end: timeOf(e.endMinutes),
      // Drafts are filtered out above.
      status: e.status as "confirmed" | "cancelled",
      ticket_status: e.ticketStatus,
      is_free: e.isFree,
      age_limit: e.ageLimit,
      ticket_url: e.ticketUrl,
      lineup: lineupRows
        .filter((r) => r.entry.eventId === e.id)
        .map((r) => ({
          artist: r.artist,
          role: r.entry.role,
          billing_order: r.entry.billingOrder,
          set_start: timeOf(r.entry.setStartMinutes),
          stage: r.entry.stage,
        })),
      prices: priceRows.filter((p) => p.eventId === e.id).map((p) => ({ cents: p.cents, description: p.description })),
      last_verified_at: e.lastVerifiedAt?.toISOString() ?? null,
    }));

    return c.json({ data, next_cursor: nextCursor }, 200);
  });
