import { sql } from "drizzle-orm";
import { index, integer, pgTable, real, text, uuid } from "drizzle-orm/pg-core";
import { id, point, polygon, timestamps } from "./columns.js";
import { listingStatus } from "./enums.js";

export const neighborhoods = pgTable("neighborhoods", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  region: text("region").notNull(),
  boundary: polygon("boundary"),
  center: point("center").notNull(),
  zoom: real("zoom").notNull(),
  ...timestamps,
}).enableRLS();

export const venues = pgTable(
  "venues",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    address: text("address").notNull(),
    neighborhoodId: uuid("neighborhood_id").references(() => neighborhoods.id, { onDelete: "restrict" }),
    region: text("region").notNull(),
    timeZone: text("time_zone").notNull().default("America/Los_Angeles"),
    location: point("location").notNull(),
    capacity: integer("capacity"),
    agePolicy: text("age_policy"),
    website: text("website"),
    instagram: text("instagram"),
    facebook: text("facebook"),
    tiktok: text("tiktok"),
    dice: text("dice"),
    status: listingStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    index("venues_location_gist_idx").using("gist", t.location),
    index("venues_name_trgm_idx").using("gin", sql`${t.name} extensions.gin_trgm_ops`),
    index("venues_neighborhood_id_idx").on(t.neighborhoodId),
  ],
).enableRLS();
