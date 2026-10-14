import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events, proposals, series, venues } from "../schema/index.js";
import { createTestDb } from "../testing.js";
import { removeVenue } from "./remove-venue.js";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

let exampleId: string;
let echoId: string;
beforeEach(async () => {
  await t.reset();
  const rows = await t.db
    .insert(venues)
    .values([
      { slug: "example-bar", name: "Example Bar", address: "123 Example Ave", region: "eastside", location: { x: -118.26, y: 34.078 } },
      { slug: "the-echo", name: "The Echo", address: "1822 W Sunset Blvd", region: "eastside", location: { x: -118.26, y: 34.078 } },
    ])
    .returning({ id: venues.id, slug: venues.slug });
  exampleId = rows.find((r) => r.slug === "example-bar")!.id;
  echoId = rows.find((r) => r.slug === "the-echo")!.id;
});

const slugsLeft = async () => (await t.db.select({ slug: venues.slug }).from(venues).orderBy(venues.slug)).map((r) => r.slug);

describe("removeVenue", () => {
  it("dry run reports the venue and deletes nothing", async () => {
    const result = await removeVenue(t.db, "example-bar");
    expect(result).toEqual({
      status: "would_delete",
      venue: { id: exampleId, slug: "example-bar", name: "Example Bar", address: "123 Example Ave" },
    });
    expect(await slugsLeft()).toEqual(["example-bar", "the-echo"]);
  });

  it("deletes an unreferenced venue on commit and leaves others alone", async () => {
    await t.db.insert(events).values({ venueId: echoId, localDate: "2026-10-16", status: "confirmed" });
    const result = await removeVenue(t.db, "example-bar", { commit: true });
    expect(result).toMatchObject({ status: "deleted", venue: { id: exampleId, slug: "example-bar" } });
    expect(await slugsLeft()).toEqual(["the-echo"]);
    expect(await t.db.$count(events)).toBe(1);
  });

  it("refuses a venue with events, even cancelled ones", async () => {
    await t.db.insert(events).values({ venueId: exampleId, localDate: "2026-10-16", status: "cancelled" });
    const result = await removeVenue(t.db, "example-bar", { commit: true });
    expect(result).toMatchObject({ status: "blocked", events: 1, series: 0, proposals: 0 });
    expect(await slugsLeft()).toEqual(["example-bar", "the-echo"]);
  });

  it("refuses a venue with a series", async () => {
    await t.db.insert(series).values({ venueId: exampleId, name: "Motown Mondays" });
    const result = await removeVenue(t.db, "example-bar", { commit: true });
    expect(result).toMatchObject({ status: "blocked", events: 0, series: 1, proposals: 0 });
    expect(await slugsLeft()).toContain("example-bar");
  });

  it("refuses a venue that a proposal targets", async () => {
    await t.db.insert(proposals).values({ targetType: "venue", targetId: exampleId, proposedAttributes: { capacity: 200 } });
    // A proposal for another kind of record with the same id doesn't count.
    await t.db.insert(proposals).values({ targetType: "artist", targetId: exampleId, proposedAttributes: {} });
    const result = await removeVenue(t.db, "example-bar", { commit: true });
    expect(result).toMatchObject({ status: "blocked", events: 0, series: 0, proposals: 1 });
    expect(await slugsLeft()).toContain("example-bar");
  });

  it("reports an unknown slug", async () => {
    expect(await removeVenue(t.db, "nope", { commit: true })).toEqual({ status: "not_found", slug: "nope" });
    expect(await t.db.$count(venues)).toBe(2);
  });
});
