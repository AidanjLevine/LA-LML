import { createRoute, z } from "@hono/zod-openapi";
import { events, eventSources, sourceRecords, sources } from "@lalml/db";
import { and, asc, eq } from "drizzle-orm";
import { ApiError, errorResponses } from "../lib/errors.js";
import {
  EventFilterQuery,
  eventFilterConditions,
  EventSchema,
  listEvents,
  loadLineupsAndPrices,
  MAX_RANGE_DAYS,
  publicEvent,
  serializeEventFields,
} from "../lib/events.js";
import { nextCursorSchema, PaginationQuery } from "../lib/pagination.js";
import { createRouter } from "../lib/router.js";
import { findVenueById, serializeVenue, VenueSchema } from "../lib/venues.js";

const EventSourceSchema = z
  .object({
    kind: z.enum(["manual", "bulk_paste", "venue_site", "ticketmaster", "flyer", "newsletter", "submission"]),
    url: z.string().nullable().openapi({ description: "Where the listing came from; null for manual entry" }),
  })
  .openapi("EventSource");

const EventDetailSchema = EventSchema.omit({ venue: true })
  .extend({ venue: VenueSchema, sources: z.array(EventSourceSchema) })
  .openapi("EventDetail");

const listEventsRoute = createRoute({
  method: "get",
  path: "/v1/events",
  tags: ["events"],
  summary: "List events",
  description:
    `Public events in a date window (default: tonight to ${MAX_RANGE_DAYS} days out, Los Angeles time; at most ${MAX_RANGE_DAYS} days), ` +
    "ordered by night and start time. Filters combine with AND. Draft and hidden events are never returned; " +
    "cancelled events are, with status `cancelled`.",
  request: { query: z.object({ ...EventFilterQuery, ...PaginationQuery }) },
  responses: {
    200: {
      description: "A page of events",
      content: {
        "application/json": { schema: z.object({ data: z.array(EventSchema), next_cursor: nextCursorSchema }) },
      },
    },
    400: errorResponses[400],
  },
});

const getEventRoute = createRoute({
  method: "get",
  path: "/v1/events/{id}",
  tags: ["events"],
  summary: "Get an event",
  description: "One event with its full venue, lineup, prices, where the listing came from, and when it was last verified.",
  request: {
    params: z.object({ id: z.string().uuid().openapi({ param: { name: "id", in: "path" } }) }),
  },
  responses: {
    200: { description: "The event", content: { "application/json": { schema: z.object({ data: EventDetailSchema }) } } },
    400: errorResponses[400],
    404: errorResponses[404],
  },
});

export const eventsRouter = createRouter()
  .openapi(listEventsRoute, async (c) => {
    const { limit, cursor, ...filters } = c.req.valid("query");
    const { conditions } = eventFilterConditions(filters, c.var.now());
    return c.json(await listEvents(c.var.db(), conditions, { limit, cursor }), 200);
  })
  .openapi(getEventRoute, async (c) => {
    const db = c.var.db();
    const { id } = c.req.valid("param");
    const [event] = await db
      .select()
      .from(events)
      .where(and(eq(events.id, id), ...publicEvent()))
      .limit(1);
    if (!event) throw new ApiError(404, "not_found", `No event with id '${id}'`);

    const [venue, details, sourceRows] = await Promise.all([
      findVenueById(db, event.venueId),
      loadLineupsAndPrices(db, [event.id]),
      db
        .selectDistinct({ kind: sources.kind, url: sourceRecords.url })
        .from(eventSources)
        .innerJoin(sourceRecords, eq(eventSources.sourceRecordId, sourceRecords.id))
        .innerJoin(sources, eq(sourceRecords.sourceId, sources.id))
        .where(eq(eventSources.eventId, event.id))
        .orderBy(asc(sources.kind), asc(sourceRecords.url)),
    ]);

    return c.json(
      { data: { ...serializeEventFields(event, details), venue: serializeVenue(venue), sources: sourceRows } },
      200,
    );
  });
