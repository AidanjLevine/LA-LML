# LA-LML

LA-LML is a public API and mobile-first web app for finding live shows by small bands and DJs at bars and venues in Los Angeles. Shows are gathered from manual entry, venue websites and ticketing sources into a Postgres + PostGIS database, served through a versioned, OpenAPI-documented API under `/v1`, and shown on a map with synced lists of venues, artists and events. See [`docs/PLAN.md`](docs/PLAN.md) for the architecture and roadmap.

## Running locally

Requirements: Node 24+ and pnpm (via Corepack).

```sh
corepack enable
pnpm install
cp .env.example .env   # DATABASE_URL isn't used yet
pnpm dev
```

- API: http://localhost:8787/v1/health (OpenAPI spec at `/v1/openapi.json`)
- Web: http://localhost:3000

Checks (the same ones CI runs on pull requests):

```sh
pnpm lint
pnpm typecheck
pnpm test
```

Database migrations live in `packages/db/drizzle`. After changing the schema in `packages/db/src/schema`, run `pnpm --filter @lalml/db db:generate`.

## Layout

| Path | What |
| --- | --- |
| `apps/api` | Hono API (Vercel) |
| `apps/web` | Next.js web app (Vercel) |
| `packages/db` | Drizzle schema and migrations (Postgres + PostGIS) |
| `packages/ingest` | Ingestion adapters and jobs |
