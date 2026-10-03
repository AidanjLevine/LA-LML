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

## Deploying the API

`apps/api` deploys to Vercel as its own project (the web app will be a separate project). Vercel builds it from this monorepo with `apps/api` as the root directory: it installs the whole pnpm workspace, compiles `@lalml/db` to JavaScript (`pnpm run build`), then builds `src/index.ts` with its Hono preset. `apps/api/vercel.json` pins the framework, the build command and the `sfo1` region (close to the Supabase database in Northern California).

In the Vercel dashboard:

1. **Add New… → Project**, then import the `AidanjLevine/LA-LML` GitHub repository.
2. **Project Name:** anything, e.g. `la-lml-api`.
3. **Root Directory:** click **Edit** and choose `apps/api`.
4. **Framework Preset:** `Hono` (it's also set in `vercel.json`).
5. **Build and Output Settings:** leave every override off. The build command comes from `vercel.json` (`pnpm run build`); the install command is Vercel's default, which runs `pnpm install` for the workspace.
6. **Environment Variables** (add both for Production and Preview):
   - `DATABASE_URL`: the Supabase **transaction pooler** connection string (port 6543)
   - `ENABLE_EXPERIMENTAL_COREPACK`: `1` (makes Vercel use the pnpm version pinned in `package.json`)
7. **Deploy.**
8. After the first deploy, under **Settings → General**, check that **Node.js Version** is `24.x` and that **Include files outside the root directory in the Build Step** is enabled (both are the defaults). Under **Settings → Functions**, the region should show `sfo1`.

Once it's live:

- `https://<your-deployment>/v1/health` returns `{ "status": "ok", "db": "ok" }`. `db: "error"` (HTTP 503) means the database didn't answer; check `DATABASE_URL`.
- `https://<your-deployment>/docs` shows the interactive API docs, rendered from `/v1/openapi.json`.

To check a production build locally without deploying, see "Building like Vercel" in `CLAUDE.md`.

## Layout

| Path | What |
| --- | --- |
| `apps/api` | Hono API (Vercel) |
| `apps/web` | Next.js web app (Vercel) |
| `packages/db` | Drizzle schema and migrations (Postgres + PostGIS) |
| `packages/ingest` | Ingestion adapters and jobs |
