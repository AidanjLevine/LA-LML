import { createRoute, z } from "@hono/zod-openapi";
import { artists, type Db } from "@lalml/db";
import { and, asc, eq, gt, type SQL } from "drizzle-orm";
import { ApiError, errorResponses } from "../lib/errors.js";
import { ARTIST_KINDS, EventSchema, lineupIncludesArtist, listEvents, upcoming } from "../lib/events.js";
import { decodeCursor, nextCursorSchema, paginate, PaginationQuery } from "../lib/pagination.js";
import { createRouter } from "../lib/router.js";
import { nameMatches } from "../lib/search.js";

const SlugParam = z.object({
  slug: z.string().min(1).openapi({ param: { name: "slug", in: "path" }, example: "the-band" }),
});

export const ArtistSchema = z
  .object({
    id: z.string().uuid(),
    slug: z.string().openapi({ example: "the-band" }),
    name: z.string().openapi({ example: "The Band" }),
    aliases: z.array(z.string()),
    kind: z.enum(ARTIST_KINDS),
    genres: z.array(z.string()).openapi({ example: ["indie rock"] }),
    spotify: z.string().nullable(),
    bandcamp: z.string().nullable(),
    instagram: z.string().nullable(),
    facebook: z.string().nullable(),
    tiktok: z.string().nullable(),
    dice: z.string().nullable(),
    status: z.enum(["active", "inactive"]),
  })
  .openapi("Artist");

type ArtistRow = typeof artists.$inferSelect;

// proposed_genres is internal (unreviewed suggestions) and never returned.
const serializeArtist = (a: ArtistRow): z.infer<typeof ArtistSchema> => ({
  id: a.id,
  slug: a.slug,
  name: a.name,
  aliases: a.aliases,
  kind: a.kind,
  genres: a.genres,
  spotify: a.spotify,
  bandcamp: a.bandcamp,
  instagram: a.instagram,
  facebook: a.facebook,
  tiktok: a.tiktok,
  dice: a.dice,
  status: a.status,
});

async function findArtist(db: Db, slug: string): Promise<ArtistRow> {
  const [row] = await db.select().from(artists).where(eq(artists.slug, slug)).limit(1);
  if (!row) throw new ApiError(404, "not_found", `No artist with slug '${slug}'`);
  return row;
}

const listArtistsRoute = createRoute({
  method: "get",
  path: "/v1/artists",
  tags: ["artists"],
  summary: "List artists",
  description: "Active artists, ordered by slug. `q` matches names by substring or similarity (typo-tolerant).",
  request: {
    query: z.object({
      q: z.string().trim().min(1).max(100).optional().openapi({ description: "Name search", example: "band" }),
      kind: z.enum(ARTIST_KINDS).optional(),
      ...PaginationQuery,
    }),
  },
  responses: {
    200: {
      description: "A page of artists",
      content: {
        "application/json": { schema: z.object({ data: z.array(ArtistSchema), next_cursor: nextCursorSchema }) },
      },
    },
    400: errorResponses[400],
  },
});

const getArtistRoute = createRoute({
  method: "get",
  path: "/v1/artists/{slug}",
  tags: ["artists"],
  summary: "Get an artist",
  request: { params: SlugParam },
  responses: {
    200: { description: "The artist", content: { "application/json": { schema: z.object({ data: ArtistSchema }) } } },
    404: errorResponses[404],
  },
});

const listArtistEventsRoute = createRoute({
  method: "get",
  path: "/v1/artists/{slug}/events",
  tags: ["artists", "events"],
  summary: "Upcoming events for an artist",
  description: "Events from tonight onward (Los Angeles time) with this artist in the lineup, ordered by night and start time.",
  request: { params: SlugParam, query: z.object(PaginationQuery) },
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

export const artistsRouter = createRouter()
  .openapi(listArtistsRoute, async (c) => {
    const { q, kind, limit, cursor } = c.req.valid("query");
    const conditions: SQL[] = [eq(artists.status, "active")];
    if (q) conditions.push(nameMatches(artists.name, q));
    if (kind) conditions.push(eq(artists.kind, kind));
    if (cursor) conditions.push(gt(artists.slug, decodeCursor(cursor, z.object({ slug: z.string() })).slug));
    const rows = await c.var
      .db()
      .select()
      .from(artists)
      .where(and(...conditions))
      .orderBy(asc(artists.slug))
      .limit(limit + 1);
    const { page, nextCursor } = paginate(rows, limit, (last) => ({ slug: last.slug }));
    return c.json({ data: page.map(serializeArtist), next_cursor: nextCursor }, 200);
  })
  .openapi(getArtistRoute, async (c) => {
    const artist = await findArtist(c.var.db(), c.req.valid("param").slug);
    return c.json({ data: serializeArtist(artist) }, 200);
  })
  .openapi(listArtistEventsRoute, async (c) => {
    const db = c.var.db();
    const artist = await findArtist(db, c.req.valid("param").slug);
    const { limit, cursor } = c.req.valid("query");
    const page = await listEvents(db, [lineupIncludesArtist(artist.id), upcoming(c.var.now())], { limit, cursor });
    return c.json(page, 200);
  });
