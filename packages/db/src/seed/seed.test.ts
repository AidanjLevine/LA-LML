import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../env.js";
import { neighborhoods, sources, venues } from "../schema/index.js";
import { createTestDb } from "../testing.js";
import { seed, slugify } from "./seed.js";

const HEADER =
  "area,neighborhood,venue_name,address,latitude,longitude,capacity,age_policy,website,instagram,facebook,dice_url," +
  "calendar_lives_on,website_platform,has_ical_or_json_feed,newsletter_signup_url,shows_per_week_estimate,notes";

const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");

const ROWS = {
  echo: 'Eastside,Echo Park,The Echo,"1822 Sunset Blvd, Los Angeles, CA 90026",34.0779,-118.2606,350,21+,https://theecho.com,@theecho,,https://dice.fm/venue/the-echo,website,,no,,5,',
  noCoords: 'Eastside,Silver Lake,No Coords Bar,"1 Main St, Los Angeles, CA",,,100,21+,,,,,,,,,,',
  unknownHood: 'Eastside,Atwater Village,Atwater Spot,"2 Glendale Blvd, Los Angeles, CA",34.1165,-118.2564,,All ages,,https://www.instagram.com/atwaterspot/,,,,,,,,',
  westside: 'Westside,Santa Monica,Seaside Room,"3 Ocean Ave, Santa Monica, CA",34.0105,-118.4960,abc,21+,,,,,,,,,,',
  duplicate: 'Eastside,Echo Park,The Echo,"Somewhere else",34.07,-118.26,,,,,,,,,,,,',
};

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

describe("seed", () => {
  it("seeds neighborhoods, the manual source and venues", async () => {
    const report = await seed(t.db, csv(ROWS.echo, ROWS.westside));

    expect(report.neighborhoods).toBe(7);
    expect(report.venuesInserted).toEqual(["the-echo", "seaside-room"]);
    expect(await t.db.select().from(sources)).toMatchObject([{ kind: "manual", name: "Seed data" }]);

    const [echo] = await t.db.select().from(venues).where(eq(venues.slug, "the-echo"));
    const [echoPark] = await t.db.select().from(neighborhoods).where(eq(neighborhoods.slug, "echo-park"));
    expect(echo).toMatchObject({
      name: "The Echo",
      address: "1822 Sunset Blvd, Los Angeles, CA 90026",
      neighborhoodId: echoPark!.id,
      region: "eastside",
      timeZone: "America/Los_Angeles",
      location: { x: -118.2606, y: 34.0779 },
      capacity: 350,
      agePolicy: "21+",
      instagram: "theecho",
      dice: "https://dice.fm/venue/the-echo",
      facebook: null,
      status: "active",
    });
  });

  it("is idempotent", async () => {
    await seed(t.db, csv(ROWS.echo, ROWS.westside));
    const second = await seed(t.db, csv(ROWS.echo, ROWS.westside));

    expect(second.venuesInserted).toEqual([]);
    expect(second.venuesUpdated).toEqual(["the-echo", "seaside-room"]);
    expect(await t.db.$count(venues)).toBe(2);
    expect(await t.db.$count(neighborhoods)).toBe(7);
    expect(await t.db.$count(sources)).toBe(1);
  });

  it("updates changed fields on re-run", async () => {
    await seed(t.db, csv(ROWS.echo));
    await seed(t.db, csv(ROWS.echo.replace(",350,", ",400,")));
    const [echo] = await t.db.select().from(venues).where(eq(venues.slug, "the-echo"));
    expect(echo!.capacity).toBe(400);
  });

  it("skips and reports rows without coordinates and duplicate venues", async () => {
    const report = await seed(t.db, csv(ROWS.echo, ROWS.noCoords, ROWS.duplicate));
    expect(report.venuesInserted).toEqual(["the-echo"]);
    expect(report.skipped).toEqual([
      { line: 3, venue: "No Coords Bar", reason: "missing coordinates" },
      { line: 4, venue: "The Echo", reason: 'duplicate venue (slug "the-echo" already used earlier in the CSV)' },
    ]);
  });

  it("imports unmatched neighborhoods without one and warns", async () => {
    const report = await seed(t.db, csv(ROWS.unknownHood, ROWS.westside));
    const [atwater] = await t.db.select().from(venues).where(eq(venues.slug, "atwater-spot"));
    expect(atwater).toMatchObject({ neighborhoodId: null, region: "eastside", instagram: "atwaterspot" });
    expect(report.warnings).toEqual([
      'line 2 Atwater Spot: neighborhood "Atwater Village" not found; imported without one',
      'line 3 Seaside Room: capacity "abc" isn\'t a number; left empty',
    ]);
  });

  it("reads the committed template CSV", async () => {
    const report = await seed(t.db, readFileSync(`${REPO_ROOT}data/venues.csv`, "utf8"));
    expect(report.skipped).toEqual([]);
    expect(report.venuesInserted.length).toBeGreaterThan(0);
  });

  it("rejects a CSV missing required columns", async () => {
    await expect(seed(t.db, "venue_name,address\nX,Y")).rejects.toThrow(/missing columns: area, neighborhood/);
  });
});

describe("slugify", () => {
  it("makes URL-safe slugs", () => {
    expect(slugify("The Echo")).toBe("the-echo");
    expect(slugify("Zebulon & Friends!")).toBe("zebulon-and-friends");
    expect(slugify("  Café Tropical ")).toBe("cafe-tropical");
  });
});
