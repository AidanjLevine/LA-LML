# LA-LML

LA-LML is a public API and mobile-first web app for finding live shows by small bands and DJs at bars and venues in Los Angeles. Shows are gathered from manual entry, venue websites and ticketing sources into a Postgres + PostGIS database, served through a versioned, OpenAPI-documented API under `/v1`, and shown on a map with synced lists of venues, artists and events. See [`docs/PLAN.md`](docs/PLAN.md) for the architecture and roadmap.

## Running locally

Requirements: Node 24+ and pnpm (via Corepack).

```sh
corepack enable
pnpm install
cp .env.example .env   # then fill in the Supabase connection strings
pnpm db:migrate        # apply migrations (session pooler)
pnpm db:seed           # neighborhoods + venues from data/venues.csv; safe to re-run
pnpm db:verify         # check extensions, RLS and triggers on the live database
pnpm dev
```

- API: http://localhost:8787/v1/health (OpenAPI spec at `/v1/openapi.json`)
- Web: http://localhost:3000

Tests don't need a database: they run against PGlite, an in-memory Postgres with PostGIS.

Checks (the same ones CI runs on pull requests):

```sh
pnpm lint
pnpm typecheck
pnpm test
```

Database migrations live in `packages/db/drizzle`. After changing the schema in `packages/db/src/schema`, run `pnpm db:generate`.

## Layout

| Path | What |
| --- | --- |
| `apps/api` | Hono API (Vercel) |
| `apps/web` | Next.js web app (Vercel) |
| `packages/db` | Drizzle schema and migrations (Postgres + PostGIS) |
| `packages/ingest` | Ingestion adapters and jobs |
