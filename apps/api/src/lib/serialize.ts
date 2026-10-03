import { z } from "@hono/zod-openapi";
import type { Point, Polygon } from "@lalml/db";

/** PostGIS points come back as { x: lng, y: lat }; the API exposes plain lat/lng numbers. */
export const latLng = (point: Point) => ({ lat: point.y, lng: point.x });

export const LatLngSchema = z
  .object({
    lat: z.number().openapi({ example: 34.0779 }),
    lng: z.number().openapi({ example: -118.2606 }),
  })
  .openapi("LatLng");

export const geoJsonPolygon = (polygon: Polygon | null) =>
  polygon ? { type: "Polygon" as const, coordinates: polygon } : null;

export const GeoJsonPolygonSchema = z
  .object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))).openapi({ description: "Rings of [lng, lat]" }),
  })
  .openapi("GeoJsonPolygon");

export const TimeSchema = z
  .object({
    minutes: z
      .number()
      .int()
      .openapi({ description: "Minutes after midnight on local_date; 1440 and up is after midnight", example: 1500 }),
    time: z.string().openapi({ description: "Readable local time", example: "1:00 AM" }),
  })
  .openapi("LocalTime");
