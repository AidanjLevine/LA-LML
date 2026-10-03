import { createRoute, z } from "@hono/zod-openapi";
import { events, neighborhoods, venues } from "@lalml/db";
import { and, asc, eq, gt, type SQL } from "drizzle-orm";
import { errorResponses } from "../lib/errors.js";
import { EventSchema, listEvents, upcoming } from "../lib/events.js";
import { decodeCursor, nextCursorSchema, paginate, PaginationQuery } from "../lib/pagination.js";
import { createRouter } from "../lib/router.js";
import { nameMatches } from "../lib/search.js";
import { findVenue, serializeVenue, SlugParam, venueColumns, VenueSchema } from "../lib/venues.js";

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
        "application/json": { schema: z.object({ data: z.array(EventSchema), next_cursor: nextCursorSchema }) },
      },
    },
    400: errorResponses[400],
    404: errorResponses[404],
  },
});

export const venuesRouter = createRouter()
  .openapi(listVenues, async (c) => {
    const { neighborhood, region, q, limit, cursor } = c.req.valid("query");
    const conditions: SQL[] = [eq(venues.status, "active")];
    if (neighborhood) conditions.push(eq(neighborhoods.slug, neighborhood));
    if (region) conditions.push(eq(venues.region, region));
    if (q) conditions.push(nameMatches(venues.name, q));
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
    const page = await listEvents(db, [eq(events.venueId, venue.id), upcoming(c.var.now(), venue.timeZone)], { limit, cursor });
    return c.json(page, 200);
  });
