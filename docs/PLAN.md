# LA-LML build plan

Reference for anyone working in this repo. It's a condensed copy of the full MVP build plan (decisions made 2026-10-02). For the rules every session must follow, see `CLAUDE.md`.

## What we're building

A public API and a mobile-first web app for finding live shows by small bands and DJs at bars and venues in Los Angeles.

- Launch areas: 10 venues on the Eastside (Echo Park, Silver Lake, Highland Park, Eagle Rock) and 10 in Santa Monica and Venice.
- Launch features: a map of tonight's and this week's shows with a synced list, a venue list and venue pages, an artist list and artist pages, event pages, and an admin area.

## Architecture

```
Sources (manual + bulk paste, Ticketmaster API, venue websites; later flyers, newsletters, submit form, Instagram)
   -> ingestion jobs (packages/ingest, nightly GitHub Actions)
   -> Postgres + PostGIS on Supabase
        raw layer:       sources, source_records, proposals
        canonical layer: venues, artists, events, event_artists, prices, series, neighborhoods
   -> public API /v1 (apps/api, Hono, OpenAPI)
   -> clients: web app (apps/web, Next.js + MapLibre), admin pages; later a mobile app and partner developers
```

Monorepo: `apps/web`, `apps/api`, `packages/db` (Drizzle schema and migrations), `packages/ingest` (adapters and jobs). TypeScript, pnpm workspaces, Turborepo.

## Hosting (free to start, paid tiers when scaling)

| Piece | Service |
| --- | --- |
| Database and admin login | Supabase free tier (500 MB, pauses after a week with no activity) |
| API | Vercel Hobby, its own project, Hono with zero config |
| Web app | Vercel Hobby, separate project |
| Scheduled imports | GitHub Actions cron (free on a public repo); pg-boss later if jobs need to run more often |
| Map tiles | OpenFreeMap or Protomaps with MapLibre GL |

## Data model

Canonical tables (what the API serves):

| Table | Key fields |
| --- | --- |
| venues | slug, name, address, neighborhood, region, time_zone, location (PostGIS point), capacity, age_policy, website, instagram, facebook, tiktok, dice, status |
| artists | slug, name, aliases, kind (band, dj, solo, cover), genres, proposed_genres, spotify, bandcamp, instagram, facebook, tiktok, dice, status |
| events | venue_id, series_id, title, local_date, start_minutes, doors_minutes, end_minutes, is_free, age_limit, ticket_url, status (draft, confirmed, cancelled), ticket_status (selling_fast, sold_out), hidden, checked, last_verified_at |
| event_artists | event_id, artist_id, billing_order, role (headliner, support, dj), set_start_minutes, stage |
| prices | event_id, cents, description (presale, door, student) |
| series | venue_id, name, recurrence_rule |
| neighborhoods | name, slug, region, boundary polygon, center, zoom |

Ingestion tables (where data lands first):

| Table | Key fields |
| --- | --- |
| sources | kind (manual, bulk_paste, venue_site, ticketmaster, flyer, newsletter, submission), name, config, trust_level |
| source_records | source_id, external_id, url, fetched_at, raw_payload, content_hash, extracted, confidence, review_status, event_id |
| event_sources | event_id, source_record_id |
| proposals | target_type, target_id (empty for a new record), proposed_attributes, status, submitted_by, reviewed_by, reviewer_note |

Show times are the venue's local date plus minutes after midnight, so a 1am set stays on the right night. GiST index on venue locations, trigram indexes on venue and artist names.

## API (read-only, versioned, OpenAPI)

| Endpoint | Returns |
| --- | --- |
| GET /v1/map | GeoJSON, one feature per venue with a show count (bbox, from, to, filters) |
| GET /v1/events | Event list (bbox or near + radius, from, to, neighborhood, genre, artist kind, free, cursor) |
| GET /v1/events/{id} | One event with lineup, venue, prices, sources, last verified |
| GET /v1/venues, /v1/venues/{slug}, /v1/venues/{slug}/events | Venue list, one venue, its upcoming events |
| GET /v1/artists, /v1/artists/{slug}, /v1/artists/{slug}/events | Artist list, one artist, their upcoming events |
| GET /v1/neighborhoods, /v1/genres | Filter options |

Admin endpoints live under `/v1/admin` behind login (CRUD, bulk paste, review queue). Cursor pagination, cache headers, per-IP rate limits, 7-day window without an API key, attribution requested. Breaking changes go to `/v2`.

## Ingestion

Every adapter does two steps: fetch (store raw items in `source_records` with a content hash) and parse (turn each into a candidate event). The shared pipeline then matches the venue and artists (fuzzy match plus aliases), dedupes (same venue, start within two hours, overlapping lineup), and routes: trusted, clean items publish; anything uncertain becomes a proposal for review.

Fast human entry comes first, as it does for Melbourne's Live Music Locator. Phase 1 has a bulk-paste tool with a simple text format; LLM parsing of text and flyers comes in Phase 4. No Instagram scraping. Link back to every source and don't re-host images.

## Roadmap

| Phase | Work | Gate |
| --- | --- | --- |
| 0. Venue audit | Record where each of the 20 venues' calendars lives; enter two weeks of shows as seed data | Seed data for 20 venues in two areas |
| 1. Foundation | Monorepo, schema, seed import, bulk-paste entry, API skeleton with OpenAPI, CI, first deploy | API serves seeded shows from a public URL |
| 2. Base features | Map with synced list and filters, area switcher, venue and artist lists, venue, artist and event pages with JSON-LD, coverage panel | Map and lists work on a phone with real data |
| 3. Ingestion v1 | Ticketmaster adapter, top venue-platform adapter, nightly jobs, artist matching, dedupe, proposals review queue | Public launch, most shows imported automatically |
| 4. Pipeline v2 | LLM flyer extraction with an eval set, newsletter inbox, public submit form, freshness checks | Extraction accuracy published, freshness checks live |
| 5. Growth | Saves, follows, accounts, weekly email, recommendations, Instagram Business Discovery, more areas, mobile app | |
