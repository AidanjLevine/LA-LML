import { z } from "@hono/zod-openapi";
import { neighborhoods, venues, type Db } from "@lalml/db";
import { eq, type SQL } from "drizzle-orm";
import { ApiError } from "./errors.js";
import { latLng } from "./serialize.js";

export const SlugParam = z.object({
  slug: z.string().min(1).openapi({ param: { name: "slug", in: "path" }, example: "the-echo" }),
});

export const NeighborhoodRefSchema = z.object({ slug: z.string(), name: z.string() }).openapi("NeighborhoodRef");

export const VenueSchema = z
  .object({
    id: z.string().uuid(),
    slug: z.string().openapi({ example: "the-echo" }),
    name: z.string().openapi({ example: "The Echo" }),
    address: z.string(),
    neighborhood: NeighborhoodRefSchema.nullable(),
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

export const venueColumns = {
  venue: venues,
  neighborhood: { slug: neighborhoods.slug, name: neighborhoods.name },
};

export type VenueRow = {
  venue: typeof venues.$inferSelect;
  neighborhood: { slug: string; name: string } | null;
};

export function serializeVenue({ venue: v, neighborhood }: VenueRow): z.infer<typeof VenueSchema> {
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

async function findVenueWhere(db: Db, where: SQL): Promise<VenueRow | undefined> {
  const [row] = await db
    .select(venueColumns)
    .from(venues)
    .leftJoin(neighborhoods, eq(venues.neighborhoodId, neighborhoods.id))
    .where(where)
    .limit(1);
  return row;
}

/** The venue with this slug, or a 404. */
export async function findVenue(db: Db, slug: string): Promise<VenueRow> {
  const row = await findVenueWhere(db, eq(venues.slug, slug));
  if (!row) throw new ApiError(404, "not_found", `No venue with slug '${slug}'`);
  return row;
}

export async function findVenueById(db: Db, id: string): Promise<VenueRow> {
  const row = await findVenueWhere(db, eq(venues.id, id));
  if (!row) throw new Error(`venue ${id} not found`);
  return row;
}
