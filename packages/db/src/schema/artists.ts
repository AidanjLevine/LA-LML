import { sql } from "drizzle-orm";
import { index, pgTable, text } from "drizzle-orm/pg-core";
import { id, timestamps } from "./columns.js";
import { artistKind, listingStatus } from "./enums.js";

export const artists = pgTable(
  "artists",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    kind: artistKind("kind").notNull(),
    genres: text("genres").array().notNull().default(sql`'{}'::text[]`),
    proposedGenres: text("proposed_genres").array().notNull().default(sql`'{}'::text[]`),
    spotify: text("spotify"),
    bandcamp: text("bandcamp"),
    instagram: text("instagram"),
    facebook: text("facebook"),
    tiktok: text("tiktok"),
    dice: text("dice"),
    status: listingStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [index("artists_name_trgm_idx").using("gin", sql`${t.name} extensions.gin_trgm_ops`)],
);
