import { createTestDb } from "@lalml/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./create-app.js";
import { CACHE_CONTROL } from "./lib/cache.js";
import { FRIDAY_8PM, seedFixtures } from "./test/fixtures.js";

let t: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof createApp>;
let ids: Record<string, string>;

/* eslint-disable @typescript-eslint/no-explicit-any */
const get = async (path: string) => {
  const res = await app.request(path);
  return { res, status: res.status, body: (await res.json()) as any };
};
const titles = (body: { data: { title: string | null; lineup: { artist: { name: string } }[] }[] }) =>
  body.data.map((e) => e.title ?? `(${e.lineup[0]?.artist.name})`);

beforeAll(async () => {
  t = await createTestDb();
  ids = await seedFixtures(t.db);
  app = createApp({ db: () => t.db, now: () => FRIDAY_8PM });
});
afterAll(() => t.close());

describe("GET /v1/events", () => {
  const list = async (query = "") => titles((await get(`/v1/events${query}`)).body);

  it("defaults to tonight through 7 days out, never draft or hidden, cancelled included", async () => {
    const { body, res } = await get("/v1/events");
    expect(titles(body)).toEqual(["Echo Friday", "Late", "(Solo Sam)", "Seaside", "Edge"]);
    expect(body.data.find((e: any) => e.title === "Seaside").status).toBe("cancelled");
    expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL);
  });

  it("returns each event with its venue summary, lineup in billing order and prices", async () => {
    const { body } = await get("/v1/events?limit=1");
    expect(body.data[0]).toMatchObject({
      id: ids["Echo Friday"],
      local_date: "2026-10-02",
      start: { minutes: 1260, time: "9:00 PM" },
      doors: { minutes: 1200, time: "8:00 PM" },
      venue: { slug: "the-echo", name: "The Echo", neighborhood: { slug: "echo-park", name: "Echo Park" }, lat: 34.0779, lng: -118.2606 },
      lineup: [
        { artist: { slug: "the-band", kind: "band" }, role: "headliner", billing_order: 0 },
        { artist: { slug: "dj-late", kind: "dj" }, role: "dj", billing_order: 1, set_start: { minutes: 1500, time: "1:00 AM" } },
      ],
      prices: [
        { cents: 1500, description: "presale" },
        { cents: 2000, description: "door" },
      ],
      last_verified_at: FRIDAY_8PM.toISOString(),
    });
  });

  it("takes an explicit window", async () => {
    expect(await list("?from=2026-10-15&to=2026-10-21")).toEqual(["Far"]);
    expect(await list("?from=2026-10-01&to=2026-10-01")).toEqual(["Past"]);
  });

  it("rejects bad windows", async () => {
    const tooLong = await get("/v1/events?from=2026-10-01&to=2026-10-09");
    expect(tooLong.status).toBe(400);
    expect(tooLong.body).toEqual({ error: { code: "invalid_request", message: "to: at most 7 days after from" } });
    expect((await get("/v1/events?from=2026-10-05&to=2026-10-04")).body.error.message).toBe("to: must be on or after from");
    expect((await get("/v1/events?from=2026-02-30")).body.error.message).toMatch(/^from: /);
    expect((await get("/v1/events?from=tomorrow")).status).toBe(400);
  });

  it.each([
    ["?neighborhood=echo-park", ["Echo Friday", "Late"]],
    ["?region=westside", ["Seaside"]],
    ["?venue=zebulon", ["(Solo Sam)", "Edge"]],
    ["?artist=dj-late", ["Echo Friday", "Late"]],
    ["?kind=solo", ["(Solo Sam)", "Edge"]],
    ["?genre=indie%20rock", ["Echo Friday", "(Solo Sam)", "Edge"]],
    ["?free=true", ["(Solo Sam)"]],
    ["?free=false", ["Echo Friday", "Late", "Seaside", "Edge"]],
    ["?bbox=-118.27,34.07,-118.25,34.09", ["Echo Friday", "Late"]],
    ["?near=34.0779,-118.2606&radius=500", ["Echo Friday", "Late"]],
    ["?near=34.0779,-118.2606&radius=5000", ["Echo Friday", "Late", "(Solo Sam)", "Edge"]],
    ["?near=34.0779,-118.2606", ["Echo Friday", "Late"]], // default radius 2000m: Zebulon is ~3km away
    ["?region=eastside&kind=dj", ["Echo Friday", "Late"]],
    ["?artist=nobody", []],
  ])("filters %s", async (query, expected) => {
    expect(await list(query)).toEqual(expected);
  });

  it("rejects bad filters", async () => {
    for (const query of ["?bbox=1,2,3", "?bbox=-118.2,34.1,-118.3,34.0", "?near=34.07", "?near=95,0", "?radius=100", "?kind=orchestra", "?free=yes"]) {
      const { status, body } = await get(`/v1/events${query}`);
      expect(status, query).toBe(400);
      expect(body.error.code, query).toBe("invalid_request");
    }
  });

  it("paginates with a cursor", async () => {
    const p1 = (await get("/v1/events?limit=2")).body;
    const p2 = (await get(`/v1/events?limit=2&cursor=${p1.next_cursor}`)).body;
    const p3 = (await get(`/v1/events?limit=2&cursor=${p2.next_cursor}`)).body;
    expect([titles(p1), titles(p2), titles(p3)]).toEqual([["Echo Friday", "Late"], ["(Solo Sam)", "Seaside"], ["Edge"]]);
    expect(p3.next_cursor).toBeNull();
  });
});

describe("GET /v1/events/{id}", () => {
  it("returns the full venue, lineup, prices, sources and last verified time", async () => {
    const { status, body, res } = await get(`/v1/events/${ids["Echo Friday"]}`);
    expect(status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL);
    expect(body.data).toMatchObject({
      id: ids["Echo Friday"],
      title: "Echo Friday",
      ticket_url: "https://tix.example/1",
      last_verified_at: FRIDAY_8PM.toISOString(),
      venue: { slug: "the-echo", address: "1822 Sunset Blvd", time_zone: "America/Los_Angeles", status: "active" },
      lineup: [{ artist: { slug: "the-band" } }, { artist: { slug: "dj-late" } }],
      prices: [{ cents: 1500 }, { cents: 2000 }],
    });
    // Two paste records with the same URL collapse into one source.
    expect(body.data.sources).toEqual([
      { kind: "manual", url: null },
      { kind: "bulk_paste", url: "https://theecho.com/calendar" },
    ]);
  });

  it("returns cancelled events", async () => {
    expect((await get(`/v1/events/${ids["Seaside"]}`)).body.data.status).toBe("cancelled");
  });

  it("404s for draft, hidden and unknown events", async () => {
    for (const id of [ids["Draft"], ids["Hidden"], "00000000-0000-4000-8000-000000000000"]) {
      const { status, body } = await get(`/v1/events/${id}`);
      expect(status).toBe(404);
      expect(body).toEqual({ error: { code: "not_found", message: `No event with id '${id}'` } });
    }
  });

  it("400s for an id that isn't a UUID", async () => {
    const { status, body } = await get("/v1/events/not-a-uuid");
    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
  });
});

describe("GET /v1/artists", () => {
  const slugs = (body: { data: { slug: string }[] }) => body.data.map((a) => a.slug);

  it("lists active artists by slug", async () => {
    expect(slugs((await get("/v1/artists")).body)).toEqual(["cover-crew", "dj-late", "solo-sam", "the-band"]);
  });

  it("filters by kind and searches names, tolerating typos", async () => {
    expect(slugs((await get("/v1/artists?kind=dj")).body)).toEqual(["dj-late"]);
    expect(slugs((await get("/v1/artists?q=sam")).body)).toEqual(["solo-sam"]);
    expect(slugs((await get("/v1/artists?q=the%20bnad")).body)).toEqual(["the-band"]);
  });

  it("paginates", async () => {
    const p1 = (await get("/v1/artists?limit=3")).body;
    const p2 = (await get(`/v1/artists?limit=3&cursor=${p1.next_cursor}`)).body;
    expect([slugs(p1), slugs(p2), p2.next_cursor]).toEqual([["cover-crew", "dj-late", "solo-sam"], ["the-band"], null]);
  });
});

describe("GET /v1/artists/{slug}", () => {
  it("returns the artist without internal fields", async () => {
    const { body, res } = await get("/v1/artists/the-band");
    expect(body.data).toMatchObject({ slug: "the-band", name: "The Band", kind: "band", aliases: ["Band, The"], genres: ["indie rock"], status: "active" });
    expect(body.data).not.toHaveProperty("proposed_genres");
    expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL);
  });

  it("404s for an unknown slug", async () => {
    const { status, body } = await get("/v1/artists/nope");
    expect(status).toBe(404);
    expect(body).toEqual({ error: { code: "not_found", message: "No artist with slug 'nope'" } });
  });
});

describe("GET /v1/artists/{slug}/events", () => {
  it("lists upcoming public events with the artist, beyond the 7-day window", async () => {
    expect(titles((await get("/v1/artists/the-band/events")).body)).toEqual(["Echo Friday", "Far"]);
    expect(titles((await get("/v1/artists/dj-late/events")).body)).toEqual(["Echo Friday", "Late"]);
  });

  it("404s for an unknown slug", async () => {
    expect((await get("/v1/artists/nope/events")).status).toBe(404);
  });
});

describe("GET /v1/venues/{slug}/events", () => {
  it("uses the shared event shape", async () => {
    const { body } = await get("/v1/venues/zebulon/events");
    expect(titles(body)).toEqual(["(Solo Sam)", "Edge"]);
    expect(body.data[0].venue).toEqual({ slug: "zebulon", name: "Zebulon", neighborhood: null, lat: 34.1045, lng: -118.2549 });
  });
});

describe("GET /v1/map", () => {
  it("returns one GeoJSON point per venue with shows, with counts and the next show", async () => {
    const { body, res } = await get("/v1/map");
    expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL);
    expect(body).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-118.2606, 34.0779] },
          properties: {
            slug: "the-echo",
            name: "The Echo",
            neighborhood: { slug: "echo-park", name: "Echo Park" },
            show_count: 2,
            next_show: { id: ids["Echo Friday"], local_date: "2026-10-02", start: { minutes: 1260, time: "9:00 PM" }, title: "Echo Friday" },
          },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-118.2549, 34.1045] },
          properties: {
            slug: "zebulon",
            name: "Zebulon",
            neighborhood: null,
            show_count: 2,
            // Untitled event: the headliner stands in.
            next_show: { id: ids["Zeb Sat"], local_date: "2026-10-03", start: { minutes: 1200, time: "8:00 PM" }, title: "Solo Sam" },
          },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-118.496, 34.0105] },
          properties: {
            slug: "seaside",
            name: "Seaside Room",
            neighborhood: { slug: "santa-monica", name: "Santa Monica" },
            show_count: 1,
            next_show: { id: ids["Seaside"], local_date: "2026-10-05", start: { minutes: 1230, time: "8:30 PM" }, title: "Seaside" },
          },
        },
      ],
    });
  });

  it("takes the same filters as /v1/events", async () => {
    const slugs = async (q: string) => (await get(`/v1/map${q}`)).body.features.map((f: any) => f.properties.slug);
    expect(await slugs("?region=westside")).toEqual(["seaside"]);
    expect(await slugs("?kind=dj")).toEqual(["the-echo"]);
    expect(await slugs("?from=2026-10-15&to=2026-10-21")).toEqual(["seaside"]);
    expect(await slugs("?artist=nobody")).toEqual([]);
    expect((await get("/v1/map?from=2026-10-01&to=2026-10-20")).status).toBe(400);
  });
});

describe("GET /v1/genres", () => {
  it("lists genres on active artists, most common first", async () => {
    const { body, res } = await get("/v1/genres");
    expect(body).toEqual({
      data: [
        { genre: "indie rock", artist_count: 2 },
        { genre: "folk", artist_count: 1 },
        { genre: "house", artist_count: 1 },
      ],
    });
    expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL);
  });
});
