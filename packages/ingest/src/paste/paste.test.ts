import { artists, eventArtists, events, eventSources, prices, sourceRecords, sources, venues } from "@lalml/db";
import { createTestDb } from "@lalml/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { commitPaste } from "./apply.js";
import { parsePaste } from "./parse.js";
import { planPaste } from "./plan.js";
import { formatPlan } from "./report.js";

const TODAY = "2026-10-02";
const NOW = new Date("2026-10-03T03:00:00Z");
const parse = (text: string) => parsePaste(text, TODAY);
const commit = (text: string) => commitPaste(t.db, parse(text), { file: "test.txt", now: NOW });

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

beforeEach(async () => {
  await t.reset();
  await t.db.insert(venues).values([
    { slug: "the-echo", name: "The Echo", address: "1822 Sunset Blvd", region: "eastside", location: { x: -118.26, y: 34.08 } },
    { slug: "zebulon", name: "Zebulon", address: "2478 Fletcher Dr", region: "eastside", location: { x: -118.25, y: 34.1 } },
  ]);
  await t.db.insert(artists).values([
    { slug: "the-band", name: "The Band", kind: "band", aliases: ["Band, The", "TB"] },
    { slug: "night-owls", name: "Night Owls", kind: "dj" },
    { slug: "sunset-strip-kids", name: "Sunset Strip Kids", kind: "band" },
  ]);
});

const counts = async () => ({
  sources: await t.db.$count(sources),
  sourceRecords: await t.db.$count(sourceRecords),
  events: await t.db.$count(events),
  artists: await t.db.$count(artists),
  eventArtists: await t.db.$count(eventArtists),
  prices: await t.db.$count(prices),
  eventSources: await t.db.$count(eventSources),
});

const SHOWS = [
  "@the-echo",
  "source https://theecho.com/calendar",
  "Fri Oct 9 | 9pm | doors 8pm | The Band, Brand New Act (solo) | $15 presale, $20 door | 21+ | https://tix.example/1",
  "Sat Oct 10 | 1am | Night Owls (dj) | free | all ages",
].join("\n");

describe("dry run (plan)", () => {
  it("writes nothing", async () => {
    const before = await counts();
    const plan = await planPaste(t.db, parse(SHOWS));
    expect(plan.errors).toEqual([]);
    expect(plan.shows.map((p) => p.action.type)).toEqual(["create", "create"]);
    expect(await counts()).toEqual(before);
  });

  it("warns about new artists and prints a readable table", async () => {
    const plan = await planPaste(t.db, parse(SHOWS));
    expect(plan.warnings).toEqual([{ line: 3, message: 'new artist "Brand New Act" will be created (solo)' }]);
    const text = formatPlan(plan);
    expect(text).toContain("@the-echo: The Echo");
    expect(text).toContain("Fri Oct 9");
    expect(text).toContain("The Band, Brand New Act [new solo]");
    expect(text).toContain("1:00 AM*");
    expect(text).toContain("2 show(s): 2 new, 0 linked to an existing show, 0 skipped");
  });

  it("reports an unknown venue as an error and skips its shows", async () => {
    const plan = await planPaste(t.db, parse("@nowhere\nOct 9 | 9pm | The Band\nOct 10 | 9pm | The Band"));
    expect(plan.errors).toEqual([{ line: 1, message: 'unknown venue "@nowhere" (2 shows not processed)' }]);
    expect(plan.shows).toEqual([]);
  });
});

describe("artist matching", () => {
  const resolve = async (name: string, kind = "") => {
    const plan = await planPaste(t.db, parse(`@zebulon\nOct 9 | 9pm | ${name}${kind}`));
    return { artist: plan.shows[0]!.artists[0]!, warnings: plan.warnings.map((w) => w.message) };
  };

  it("matches by slug, ignoring case and punctuation", async () => {
    expect((await resolve("the band")).artist).toMatchObject({ type: "existing", slug: "the-band", via: "slug" });
  });

  it("matches by alias and says so", async () => {
    const { artist, warnings } = await resolve('"Band, The"');
    expect(artist).toMatchObject({ type: "existing", slug: "the-band", via: "alias" });
    expect(warnings).toEqual(['"Band, The" matched existing artist "The Band" by alias']);
  });

  it("matches a close misspelling at or above 0.7 similarity", async () => {
    const { artist, warnings } = await resolve("Sunset Strip Kidz");
    expect(artist).toMatchObject({ type: "existing", slug: "sunset-strip-kids", via: "fuzzy" });
    expect((artist as { similarity: number }).similarity).toBeGreaterThanOrEqual(0.7);
    expect(warnings[0]).toMatch(/^"Sunset Strip Kidz" matched existing artist "Sunset Strip Kids" \(similarity 0\.\d+\)$/);
  });

  it("creates a new artist for a near miss below 0.7, with a warning", async () => {
    const { artist, warnings } = await resolve("Night Owl Club", " (dj)");
    expect(artist).toMatchObject({ type: "new", slug: "night-owl-club", kind: "dj" });
    expect(warnings).toEqual([
      'new artist "Night Owl Club" will be created (dj)',
      expect.stringMatching(/^"Night Owl Club" looks like existing artist "Night Owls" \(similarity 0\.\d+, below 0\.7\)/),
    ]);
  });

  it("matches a misspelling of an artist created earlier in the same paste", async () => {
    const plan = await planPaste(t.db, parse("@zebulon\nOct 9 | 9pm | The Lagoons\nOct 16 | 9pm | The Lagoonz\nOct 17 | 9pm | Lagoons"));
    const [first, second, third] = plan.shows.map((p) => p.artists[0]!);
    expect(second).toBe(first);
    expect(third).toMatchObject({ type: "new", slug: "lagoons" });
    expect(plan.warnings.map((w) => w.message)).toEqual([
      'new artist "The Lagoons" will be created, kind not given so assuming band',
      expect.stringMatching(/^"The Lagoonz" matched "The Lagoons", a new artist earlier in this paste \(similarity 0\.\d+\)$/),
      'new artist "Lagoons" will be created, kind not given so assuming band',
      expect.stringMatching(/^"Lagoons" looks like existing artist "The Lagoons \(new in this paste\)" \(similarity 0\.6\d, below 0\.7\)/),
    ]);
  });

  it("assumes band for a new artist without a kind", async () => {
    const { artist, warnings } = await resolve("Totally Unknown");
    expect(artist).toMatchObject({ type: "new", kind: "band", kindAssumed: true });
    expect(warnings).toEqual(['new artist "Totally Unknown" will be created, kind not given so assuming band']);
  });
});

describe("--commit", () => {
  it("writes the source, records, events, artists, lineup, prices and links", async () => {
    const before = await counts();
    const { plan, summary } = await commit(SHOWS);
    expect(plan.errors).toEqual([]);
    expect(summary).toEqual({ eventsCreated: 2, linkedToExisting: 0, artistsCreated: 1, skipped: 0 });
    expect(await counts()).toEqual({
      sources: before.sources + 1,
      sourceRecords: 2,
      events: 2,
      artists: before.artists + 1,
      eventArtists: 3,
      prices: 2,
      eventSources: 2,
    });

    const [source] = await t.db.select().from(sources);
    expect(source).toMatchObject({ kind: "bulk_paste", name: "Bulk paste" });

    const rows = await t.db.select().from(events).orderBy(events.localDate);
    expect(rows[0]).toMatchObject({
      localDate: "2026-10-09",
      startMinutes: 1260,
      doorsMinutes: 1200,
      isFree: false,
      ageLimit: "21+",
      ticketUrl: "https://tix.example/1",
      status: "confirmed",
      checked: false,
      hidden: false,
      title: null,
    });
    expect(rows[0]!.lastVerifiedAt).toEqual(NOW);
    // The 1am set stays on Saturday's date.
    expect(rows[1]).toMatchObject({ localDate: "2026-10-10", startMinutes: 1500, isFree: true, ageLimit: "all ages" });

    const lineup = await t.db
      .select({ slug: artists.slug, role: eventArtists.role, order: eventArtists.billingOrder })
      .from(eventArtists)
      .innerJoin(artists, eq(artists.id, eventArtists.artistId))
      .where(eq(eventArtists.eventId, rows[0]!.id))
      .orderBy(eventArtists.billingOrder);
    expect(lineup).toEqual([
      { slug: "the-band", role: "headliner", order: 0 },
      { slug: "brand-new-act", role: "support", order: 1 },
    ]);

    const records = await t.db.select().from(sourceRecords).orderBy(sourceRecords.fetchedAt);
    expect(records.every((r) => r.reviewStatus === "approved" && r.url === "https://theecho.com/calendar")).toBe(true);
    expect(records.every((r) => r.externalId === r.contentHash && /^[0-9a-f]{64}$/.test(r.contentHash))).toBe(true);
  });

  it("is idempotent: pasting the same file twice creates nothing new", async () => {
    await commit(SHOWS);
    const after = await counts();
    const { plan, summary } = await commit(SHOWS);
    expect(plan.shows.map((p) => p.action.type)).toEqual(["skip", "skip"]);
    expect(summary).toEqual({ eventsCreated: 0, linkedToExisting: 0, artistsCreated: 0, skipped: 2 });
    expect(await counts()).toEqual(after);
  });

  it("links an edited re-paste to the existing event instead of duplicating it", async () => {
    await commit(SHOWS);
    const [original] = await t.db.select().from(events).where(eq(events.localDate, "2026-10-09"));
    const edited = SHOWS.replace("$20 door", "$25 door");
    const { plan, summary } = await commit(edited);

    expect(plan.shows.map((p) => p.action.type)).toEqual(["link", "skip"]);
    expect(plan.warnings.map((w) => w.message)).toContainEqual(expect.stringMatching(/^possible duplicate: existing event .* also has The Band, Brand New Act; will link/));
    expect(summary).toMatchObject({ eventsCreated: 0, linkedToExisting: 1 });
    expect(await t.db.$count(events)).toBe(2);

    const records = await t.db.select().from(sourceRecords).where(eq(sourceRecords.eventId, original!.id));
    expect(records.map((r) => r.reviewStatus).sort()).toEqual(["approved", "merged"]);
    expect(await t.db.$count(eventSources, eq(eventSources.eventId, original!.id))).toBe(2);
    // The event itself is unchanged: still the original door price.
    expect((await t.db.select().from(prices).where(eq(prices.eventId, original!.id))).map((p) => p.cents).sort()).toEqual([1500, 2000]);
  });

  it("handles duplicates within one paste", async () => {
    const { plan, summary } = await commit(
      ["@the-echo", "Oct 9 | 9pm | The Band", "Oct 9 | 9pm | The Band", "Oct 9 | 9:30pm | The Band, Opener"].join("\n"),
    );
    expect(plan.shows.map((p) => p.action)).toEqual([
      { type: "create" },
      { type: "skip", reason: "identical to line 2" },
      { type: "link-line", line: 2 },
    ]);
    expect(summary).toMatchObject({ eventsCreated: 1, linkedToExisting: 1, skipped: 1 });
    expect(await t.db.$count(events)).toBe(1);
  });

  it("refuses to write anything when the paste has errors", async () => {
    const before = await counts();
    const { plan, summary } = await commit(`${SHOWS}\nThu Oct 9 | 9pm | Wrong Day`);
    expect(plan.errors).toHaveLength(1);
    expect(summary).toBeNull();
    expect(await counts()).toEqual(before);
  });

  it("rolls everything back if a write fails part way", async () => {
    const before = await counts();
    // The second show fails its insert (violates events_start_minutes_range) after the first succeeded.
    const parsed = parse(SHOWS);
    parsed.shows[1]!.startMinutes = 5000;
    await expect(commitPaste(t.db, parsed, { file: "test.txt", now: NOW })).rejects.toThrow();
    expect(await counts()).toEqual(before);
  });
});
