import { artists, eventArtists, events, neighborhoods, prices, venues } from "@lalml/db";
import { createTestDb } from "@lalml/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./create-app.js";
import { CACHE_CONTROL } from "./lib/cache.js";

// 8pm PDT on Friday 2026-10-02.
const FRIDAY_8PM = new Date("2026-10-03T03:00:00Z");

let t: Awaited<ReturnType<typeof createTestDb>>;
let clock = FRIDAY_8PM;
let app: ReturnType<typeof createApp>;

const get = async (path: string) => {
  const res = await app.request(path);
  return { res, status: res.status, body: (await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

beforeAll(async () => {
  t = await createTestDb();
  app = createApp({ db: () => t.db, now: () => clock });

  const [echoPark, santaMonica] = await t.db
    .insert(neighborhoods)
    .values([
      { slug: "echo-park", name: "Echo Park", region: "eastside", center: { x: -118.2606, y: 34.0782 }, zoom: 14 },
      { slug: "santa-monica", name: "Santa Monica", region: "westside", center: { x: -118.4912, y: 34.0195 }, zoom: 13 },
    ])
    .returning();

  const venue = (slug: string, name: string, extra: Partial<typeof venues.$inferInsert> = {}) => ({
    slug,
    name,
    address: `${name} address`,
    region: "eastside",
    location: { x: -118.26, y: 34.07 },
    ...extra,
  });
  const [theEcho] = await t.db
    .insert(venues)
    .values([
      venue("the-echo", "The Echo", { neighborhoodId: echoPark!.id, location: { x: -118.2606, y: 34.0779 }, capacity: 350 }),
      venue("echoplex", "Echoplex", { neighborhoodId: echoPark!.id }),
      venue("zebulon", "Zebulon"),
      venue("seaside-room", "Seaside Room", { neighborhoodId: santaMonica!.id, region: "westside" }),
      venue("closed-bar", "Closed Echo Bar", { status: "inactive" }),
      venue("100-percent", "100% Bar"),
    ])
    .returning();

  const [band, dj] = await t.db
    .insert(artists)
    .values([
      { slug: "the-band", name: "The Band", kind: "band" },
      { slug: "dj-late", name: "DJ Late", kind: "dj" },
    ])
    .returning();

  const event = (title: string, localDate: string, startMinutes: number | null, extra: Partial<typeof events.$inferInsert> = {}) => ({
    venueId: theEcho!.id,
    title,
    localDate,
    startMinutes,
    status: "confirmed" as const,
    ...extra,
  });
  const inserted = await t.db
    .insert(events)
    .values([
      event("Last night", "2026-10-01", 1260),
      event("Tonight", "2026-10-02", 1260, { doorsMinutes: 1200, ticketUrl: "https://tix.example/1" }),
      event("Late set", "2026-10-02", 1500),
      event("Draft show", "2026-10-03", 1200, { status: "draft" }),
      event("Hidden show", "2026-10-03", 1200, { hidden: true }),
      event("Cancelled show", "2026-10-04", 1200, { status: "cancelled" }),
      event("Time TBA", "2026-10-04", null),
    ])
    .returning();
  const byTitle = Object.fromEntries(inserted.map((e) => [e.title, e]));

  await t.db.insert(eventArtists).values([
    { eventId: byTitle["Tonight"]!.id, artistId: band!.id, role: "headliner", billingOrder: 0, setStartMinutes: 1320 },
    { eventId: byTitle["Tonight"]!.id, artistId: dj!.id, role: "dj", billingOrder: 1, setStartMinutes: 1500, stage: "Patio" },
  ]);
  await t.db.insert(prices).values([
    { eventId: byTitle["Tonight"]!.id, cents: 2000, description: "door" },
    { eventId: byTitle["Tonight"]!.id, cents: 1500, description: "presale" },
  ]);
});

afterAll(() => t.close());

describe("GET /v1/neighborhoods", () => {
  it("lists neighborhoods with plain lat/lng", async () => {
    const { status, body, res } = await get("/v1/neighborhoods");
    expect(status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL);
    expect(body.data).toEqual([
      { slug: "echo-park", name: "Echo Park", region: "eastside", center: { lat: 34.0782, lng: -118.2606 }, zoom: 14, boundary: null },
      { slug: "santa-monica", name: "Santa Monica", region: "westside", center: { lat: 34.0195, lng: -118.4912 }, zoom: 13, boundary: null },
    ]);
  });
});

describe("GET /v1/venues", () => {
  const slugs = (body: { data: { slug: string }[] }) => body.data.map((v) => v.slug);

  it("lists active venues by slug", async () => {
    const { body, res } = await get("/v1/venues");
    expect(slugs(body)).toEqual(["100-percent", "echoplex", "seaside-room", "the-echo", "zebulon"]);
    expect(body.next_cursor).toBeNull();
    expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL);
  });

  it("filters by neighborhood slug", async () => {
    expect(slugs((await get("/v1/venues?neighborhood=echo-park")).body)).toEqual(["echoplex", "the-echo"]);
    expect(slugs((await get("/v1/venues?neighborhood=nowhere")).body)).toEqual([]);
  });

  it("filters by region", async () => {
    expect(slugs((await get("/v1/venues?region=westside")).body)).toEqual(["seaside-room"]);
  });

  it("searches names by substring, case-insensitively", async () => {
    expect(slugs((await get("/v1/venues?q=ECHO")).body)).toEqual(["echoplex", "the-echo"]);
  });

  it("searches names by similarity, tolerating typos", async () => {
    expect(slugs((await get("/v1/venues?q=the%20ekho")).body)).toEqual(["the-echo"]);
  });

  it("treats LIKE wildcards in q literally", async () => {
    expect(slugs((await get("/v1/venues?q=100%25")).body)).toEqual(["100-percent"]);
    expect(slugs((await get("/v1/venues?q=_")).body)).toEqual([]);
  });

  it("combines filters", async () => {
    expect(slugs((await get("/v1/venues?region=eastside&q=echo&neighborhood=echo-park")).body)).toEqual([
      "echoplex",
      "the-echo",
    ]);
  });

  it("paginates with a cursor", async () => {
    const page1 = (await get("/v1/venues?limit=2")).body;
    const page2 = (await get(`/v1/venues?limit=2&cursor=${page1.next_cursor}`)).body;
    const page3 = (await get(`/v1/venues?limit=2&cursor=${page2.next_cursor}`)).body;
    expect([slugs(page1), slugs(page2), slugs(page3)]).toEqual([
      ["100-percent", "echoplex"],
      ["seaside-room", "the-echo"],
      ["zebulon"],
    ]);
    expect(page3.next_cursor).toBeNull();
  });

  it("rejects invalid parameters with the standard error", async () => {
    const tooBig = await get("/v1/venues?limit=500");
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.code).toBe("invalid_request");
    expect(tooBig.body.error.message).toMatch(/^limit: /);

    const badCursor = await get("/v1/venues?cursor=not-a-cursor");
    expect(badCursor.status).toBe(400);
    expect(badCursor.body).toEqual({ error: { code: "invalid_request", message: "cursor: invalid cursor" } });
  });
});

describe("GET /v1/venues/{slug}", () => {
  it("returns the venue with lat/lng as numbers", async () => {
    const { status, body } = await get("/v1/venues/the-echo");
    expect(status).toBe(200);
    expect(body.data).toMatchObject({
      slug: "the-echo",
      name: "The Echo",
      neighborhood: { slug: "echo-park", name: "Echo Park" },
      region: "eastside",
      time_zone: "America/Los_Angeles",
      lat: 34.0779,
      lng: -118.2606,
      capacity: 350,
      status: "active",
    });
    expect(body.data).not.toHaveProperty("location");
  });

  it("returns inactive venues too", async () => {
    expect((await get("/v1/venues/closed-bar")).body.data.status).toBe("inactive");
  });

  it("404s for an unknown slug", async () => {
    const { status, body } = await get("/v1/venues/nope");
    expect(status).toBe(404);
    expect(body).toEqual({ error: { code: "not_found", message: "No venue with slug 'nope'" } });
  });
});

describe("GET /v1/venues/{slug}/events", () => {
  const titles = (body: { data: { title: string }[] }) => body.data.map((e) => e.title);
  const at = async (time: Date, path = "/v1/venues/the-echo/events") => {
    clock = time;
    try {
      return await get(path);
    } finally {
      clock = FRIDAY_8PM;
    }
  };

  it("lists upcoming events, excluding past, draft and hidden ones", async () => {
    const { status, body } = await get("/v1/venues/the-echo/events");
    expect(status).toBe(200);
    expect(titles(body)).toEqual(["Tonight", "Late set", "Cancelled show", "Time TBA"]);
  });

  it("keeps cancelled events, marked as cancelled", async () => {
    const { body } = await get("/v1/venues/the-echo/events");
    expect(body.data.find((e: { title: string }) => e.title === "Cancelled show").status).toBe("cancelled");
  });

  it("returns times as minutes and readable local time, with lineup and prices", async () => {
    const { body } = await get("/v1/venues/the-echo/events");
    expect(body.data[0]).toEqual({
      id: expect.any(String),
      title: "Tonight",
      local_date: "2026-10-02",
      start: { minutes: 1260, time: "9:00 PM" },
      doors: { minutes: 1200, time: "8:00 PM" },
      end: null,
      status: "confirmed",
      ticket_status: null,
      is_free: false,
      age_limit: null,
      ticket_url: "https://tix.example/1",
      lineup: [
        {
          artist: { slug: "the-band", name: "The Band", kind: "band" },
          role: "headliner",
          billing_order: 0,
          set_start: { minutes: 1320, time: "10:00 PM" },
          stage: null,
        },
        {
          artist: { slug: "dj-late", name: "DJ Late", kind: "dj" },
          role: "dj",
          billing_order: 1,
          set_start: { minutes: 1500, time: "1:00 AM" },
          stage: "Patio",
        },
      ],
      prices: [
        { cents: 1500, description: "presale" },
        { cents: 2000, description: "door" },
      ],
      last_verified_at: null,
      venue: {
        slug: "the-echo",
        name: "The Echo",
        neighborhood: { slug: "echo-park", name: "Echo Park" },
        lat: 34.0779,
        lng: -118.2606,
      },
    });
    expect(body.data[3]).toMatchObject({ title: "Time TBA", start: null, lineup: [], prices: [] });
  });

  it("keeps a late-night set on the night it belongs to", async () => {
    const friday = await get("/v1/venues/the-echo/events");
    expect(friday.body.data[1]).toMatchObject({
      title: "Late set",
      local_date: "2026-10-02",
      start: { minutes: 1500, time: "1:00 AM" },
    });

    // 1:30am PDT Saturday: still Friday night, so the 1am set is still listed.
    const duringSet = await at(new Date("2026-10-03T08:30:00Z"));
    expect(titles(duringSet.body)).toEqual(["Tonight", "Late set", "Cancelled show", "Time TBA"]);

    // Noon Saturday: Friday night is over.
    const saturday = await at(new Date("2026-10-03T19:00:00Z"));
    expect(titles(saturday.body)).toEqual(["Cancelled show", "Time TBA"]);
  });

  it("paginates in date and start-time order", async () => {
    const page1 = (await get("/v1/venues/the-echo/events?limit=3")).body;
    const page2 = (await get(`/v1/venues/the-echo/events?limit=3&cursor=${page1.next_cursor}`)).body;
    expect(titles(page1)).toEqual(["Tonight", "Late set", "Cancelled show"]);
    expect(titles(page2)).toEqual(["Time TBA"]);
    expect(page2.next_cursor).toBeNull();
  });

  it("returns an empty list for a venue with no events", async () => {
    expect((await get("/v1/venues/zebulon/events")).body).toEqual({ data: [], next_cursor: null });
  });

  it("404s for an unknown slug", async () => {
    const { status, body } = await get("/v1/venues/nope/events");
    expect(status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });
});
