import { createRoute, z } from "@hono/zod-openapi";
import { artists } from "@lalml/db";
import { sql } from "drizzle-orm";
import { createRouter } from "../lib/router.js";

const GenreSchema = z
  .object({
    genre: z.string().openapi({ example: "indie rock" }),
    artist_count: z.number().int().openapi({ description: "Active artists tagged with this genre" }),
  })
  .openapi("Genre");

const listGenresRoute = createRoute({
  method: "get",
  path: "/v1/genres",
  tags: ["filters"],
  summary: "List genres in use",
  description: "Genres on active artists, most common first. Use with the `genre` filter on /v1/events and /v1/map.",
  responses: {
    200: { description: "All genres in use", content: { "application/json": { schema: z.object({ data: z.array(GenreSchema) }) } } },
  },
});

export const genresRouter = createRouter().openapi(listGenresRoute, async (c) => {
  const genre = sql<string>`g.genre`;
  const count = sql<number>`count(*)::int`;
  const rows = await c.var
    .db()
    .select({ genre, artist_count: count })
    .from(sql`${artists}, unnest(${artists.genres}) as g(genre)`)
    .where(sql`${artists.status} = 'active'`)
    .groupBy(genre)
    .orderBy(sql`${count} desc`, genre);
  return c.json({ data: rows }, 200);
});
