import { createRoute, z } from "@hono/zod-openapi";
import { neighborhoods } from "@lalml/db";
import { asc } from "drizzle-orm";
import { createRouter } from "../lib/router.js";
import { geoJsonPolygon, GeoJsonPolygonSchema, latLng, LatLngSchema } from "../lib/serialize.js";

export const NeighborhoodSchema = z
  .object({
    slug: z.string().openapi({ example: "echo-park" }),
    name: z.string().openapi({ example: "Echo Park" }),
    region: z.string().openapi({ example: "eastside" }),
    center: LatLngSchema,
    zoom: z.number().openapi({ example: 14 }),
    boundary: GeoJsonPolygonSchema.nullable(),
  })
  .openapi("Neighborhood");

const listNeighborhoods = createRoute({
  method: "get",
  path: "/v1/neighborhoods",
  tags: ["neighborhoods"],
  summary: "List neighborhoods",
  description: "Every neighborhood, for area switchers and filters. Ordered by region, then name.",
  responses: {
    200: {
      description: "All neighborhoods",
      content: { "application/json": { schema: z.object({ data: z.array(NeighborhoodSchema) }) } },
    },
  },
});

export const neighborhoodsRouter = createRouter().openapi(listNeighborhoods, async (c) => {
  const rows = await c.var
    .db()
    .select()
    .from(neighborhoods)
    .orderBy(asc(neighborhoods.region), asc(neighborhoods.name));
  return c.json(
    {
      data: rows.map((n) => ({
        slug: n.slug,
        name: n.name,
        region: n.region,
        center: latLng(n.center),
        zoom: n.zoom,
        boundary: geoJsonPolygon(n.boundary),
      })),
    },
    200,
  );
});
