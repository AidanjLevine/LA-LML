import { artists, eventArtists, events, eventSources, neighborhoods, prices, sourceRecords, sources, venues, type Db } from "@lalml/db";

/** 8pm PDT on Friday 2026-10-02. The default window is 2026-10-02..2026-10-09. */
export const FRIDAY_8PM = new Date("2026-10-03T03:00:00Z");

/**
 * Venues in two regions, artists of every kind (one inactive), and events inside and outside the
 * default window, including draft, hidden, cancelled, free and after-midnight ones.
 * Returns event ids by title.
 */
export async function seedFixtures(db: Db) {
  const [echoPark, santaMonica] = await db
    .insert(neighborhoods)
    .values([
      { slug: "echo-park", name: "Echo Park", region: "eastside", center: { x: -118.2606, y: 34.0782 }, zoom: 14 },
      { slug: "santa-monica", name: "Santa Monica", region: "westside", center: { x: -118.4912, y: 34.0195 }, zoom: 13 },
    ])
    .returning();

  const [echo, zebulon, seaside] = await db
    .insert(venues)
    .values([
      { slug: "the-echo", name: "The Echo", address: "1822 Sunset Blvd", region: "eastside", neighborhoodId: echoPark!.id, location: { x: -118.2606, y: 34.0779 } },
      { slug: "zebulon", name: "Zebulon", address: "2478 Fletcher Dr", region: "eastside", location: { x: -118.2549, y: 34.1045 } },
      { slug: "seaside", name: "Seaside Room", address: "1 Ocean Ave", region: "westside", neighborhoodId: santaMonica!.id, location: { x: -118.496, y: 34.0105 } },
    ])
    .returning();

  const [band, dj, solo, cover] = await db
    .insert(artists)
    .values([
      { slug: "the-band", name: "The Band", kind: "band", genres: ["indie rock"], aliases: ["Band, The"], proposedGenres: ["shoegaze"] },
      { slug: "dj-late", name: "DJ Late", kind: "dj", genres: ["house"] },
      { slug: "solo-sam", name: "Solo Sam", kind: "solo", genres: ["folk", "indie rock"] },
      { slug: "cover-crew", name: "Cover Crew", kind: "cover" },
      { slug: "retired", name: "Retired Act", kind: "band", genres: ["punk"], status: "inactive" },
    ])
    .returning();

  const e = (title: string | null, venueId: string, localDate: string, startMinutes: number | null, extra: Partial<typeof events.$inferInsert> = {}) => ({
    title,
    venueId,
    localDate,
    startMinutes,
    status: "confirmed" as const,
    ...extra,
  });
  const rows = await db
    .insert(events)
    .values([
      e("Echo Friday", echo!.id, "2026-10-02", 1260, { doorsMinutes: 1200, ticketUrl: "https://tix.example/1", lastVerifiedAt: FRIDAY_8PM }),
      e("Late", echo!.id, "2026-10-02", 1500),
      e(null, zebulon!.id, "2026-10-03", 1200, { isFree: true }), // "Zeb Sat": untitled, headlined by Solo Sam
      e("Seaside", seaside!.id, "2026-10-05", 1230, { status: "cancelled" }),
      e("Draft", echo!.id, "2026-10-04", 1200, { status: "draft" }),
      e("Hidden", zebulon!.id, "2026-10-04", 1200, { hidden: true }),
      e("Past", echo!.id, "2026-10-01", 1260),
      e("Far", seaside!.id, "2026-10-20", 1260),
      e("Edge", zebulon!.id, "2026-10-09", 1260),
    ])
    .returning();
  const id = Object.fromEntries(rows.map((r) => [r.title ?? "Zeb Sat", r.id])) as Record<string, string>;

  await db.insert(eventArtists).values([
    { eventId: id["Echo Friday"]!, artistId: band!.id, role: "headliner", billingOrder: 0 },
    { eventId: id["Echo Friday"]!, artistId: dj!.id, role: "dj", billingOrder: 1, setStartMinutes: 1500 },
    { eventId: id["Late"]!, artistId: dj!.id, role: "dj", billingOrder: 0 },
    { eventId: id["Zeb Sat"]!, artistId: solo!.id, role: "headliner", billingOrder: 0 },
    { eventId: id["Seaside"]!, artistId: cover!.id, role: "headliner", billingOrder: 0 },
    { eventId: id["Draft"]!, artistId: band!.id, role: "headliner", billingOrder: 0 },
    { eventId: id["Hidden"]!, artistId: band!.id, role: "headliner", billingOrder: 0 },
    { eventId: id["Past"]!, artistId: band!.id, role: "headliner", billingOrder: 0 },
    { eventId: id["Far"]!, artistId: band!.id, role: "headliner", billingOrder: 0 },
    { eventId: id["Edge"]!, artistId: solo!.id, role: "headliner", billingOrder: 0 },
  ]);
  await db.insert(prices).values([
    { eventId: id["Echo Friday"]!, cents: 2000, description: "door" },
    { eventId: id["Echo Friday"]!, cents: 1500, description: "presale" },
  ]);

  const [paste, manual] = await db
    .insert(sources)
    .values([
      { kind: "bulk_paste", name: "Bulk paste" },
      { kind: "manual", name: "Seed data" },
    ])
    .returning();
  const records = await db
    .insert(sourceRecords)
    .values([
      { sourceId: paste!.id, externalId: "a", contentHash: "a", url: "https://theecho.com/calendar", rawPayload: {}, eventId: id["Echo Friday"]! },
      { sourceId: paste!.id, externalId: "b", contentHash: "b", url: "https://theecho.com/calendar", rawPayload: {}, eventId: id["Echo Friday"]! },
      { sourceId: manual!.id, externalId: "c", contentHash: "c", rawPayload: {}, eventId: id["Echo Friday"]! },
    ])
    .returning();
  await db.insert(eventSources).values(records.map((r) => ({ eventId: id["Echo Friday"]!, sourceRecordId: r.id })));

  return id;
}
