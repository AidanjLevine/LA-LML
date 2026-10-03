import { createRoute, z } from "@hono/zod-openapi";
import { and } from "drizzle-orm";
import { errorResponses } from "../lib/errors.js";
import {
  EventFilterQuery,
  eventFilterConditions,
  eventOrder,
  eventsWithVenue,
  loadLineupsAndPrices,
  MAX_RANGE_DAYS,
  publicEvent,
} from "../lib/events.js";
import { createRouter } from "../lib/router.js";
import { latLng, TimeSchema } from "../lib/serialize.js";
import { timeOf } from "../lib/time.js";
import { NeighborhoodRefSchema } from "../lib/venues.js";

const VenueFeatureSchema = z
  .object({
    type: z.literal("Feature"),
    geometry: z.object({
      type: z.literal("Point"),
      coordinates: z.tuple([z.number(), z.number()]).openapi({ description: "[lng, lat]" }),
    }),
    properties: z.object({
      slug: z.string(),
      name: z.string(),
      neighborhood: NeighborhoodRefSchema.nullable(),
      show_count: z.number().int().openapi({ description: "Shows at this venue in the window" }),
      next_show: z
        .object({
          id: z.string().uuid(),
          local_date: z.string(),
          start: TimeSchema.nullable(),
          title: z.string().nullable().openapi({ description: "The event title, or the headliner when it has none" }),
        })
        .openapi({ description: "The earliest show in the window" }),
    }),
  })
  .openapi("VenueFeature");

const MapSchema = z
  .object({
    type: z.literal("FeatureCollection"),
    features: z.array(VenueFeatureSchema),
  })
  .openapi("VenueMap");

const mapRoute = createRoute({
  method: "get",
  path: "/v1/map",
  tags: ["map"],
  summary: "Venues with shows, as GeoJSON",
  description:
    `A GeoJSON FeatureCollection with one point per venue that has shows in the window (default: tonight to ${MAX_RANGE_DAYS} days out), ` +
    "with its show count and earliest show. Takes the same filters as /v1/events.",
  request: { query: z.object(EventFilterQuery) },
  responses: {
    200: { description: "Venues with shows", content: { "application/json": { schema: MapSchema } } },
    400: errorResponses[400],
  },
});

export const mapRouter = createRouter().openapi(mapRoute, async (c) => {
  const db = c.var.db();
  const { conditions } = eventFilterConditions(c.req.valid("query"), c.var.now());
  // The window is at most MAX_RANGE_DAYS, so this is bounded.
  const rows = await eventsWithVenue(db)
    .where(and(...publicEvent(), ...conditions))
    .orderBy(...eventOrder);

  const byVenue = new Map<string, { first: (typeof rows)[number]; count: number }>();
  for (const row of rows) {
    const entry = byVenue.get(row.venue.slug);
    if (entry) entry.count++;
    else byVenue.set(row.venue.slug, { first: row, count: 1 });
  }
  const { lineups } = await loadLineupsAndPrices(db, [...byVenue.values()].map((v) => v.first.event.id));

  const features = [...byVenue.values()].map(({ first: { event, venue, neighborhood }, count }) => {
    const { lat, lng } = latLng(venue.location);
    return {
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [lng, lat] as [number, number] },
      properties: {
        slug: venue.slug,
        name: venue.name,
        neighborhood,
        show_count: count,
        next_show: {
          id: event.id,
          local_date: event.localDate,
          start: timeOf(event.startMinutes),
          title: event.title ?? lineups.get(event.id)?.[0]?.artist.name ?? null,
        },
      },
    };
  });
  return c.json({ type: "FeatureCollection" as const, features }, 200);
});
