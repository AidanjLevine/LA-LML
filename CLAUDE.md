# LA-LML

Read `docs/PLAN.md` for the architecture, data model and roadmap before starting work.

## Conventions

- The web app reads data only through the public API, never straight from the database. `apps/web` must not depend on `@lalml/db`.
- Never delete events. Set `status` to `cancelled` instead.
- Show times are `local_date` plus minutes after midnight in the venue's time zone, so a 1am set stays on the right night. Minutes run 0–2879: values from 1440 up are after midnight (a 1am set on Friday's show is `1500` with Friday's date).
- New data enters through `source_records` or `proposals`. Only admin edits write canonical tables directly.
- Every API route is versioned under `/v1` and documented with `@hono/zod-openapi` (`createRoute` + `app.openapi`). The spec is served at `/v1/openapi.json`.
- No secrets in the repo. Use `.env` (gitignored) and keep `.env.example` up to date with placeholder values.

## Repo layout

- `apps/api`: Hono API, deployed to Vercel as its own project.
- `apps/web`: Next.js App Router app, deployed to Vercel as a separate project.
- `packages/db`: Drizzle schema (`src/schema`) and SQL migrations (`drizzle/`).
- `packages/ingest`: ingestion adapters and jobs.

## Database notes

- Every table in `public` has row level security enabled with no policies, so Supabase's auto-generated REST and GraphQL APIs can't read or write anything. Our server connects as the table owner and isn't affected. New tables must call `.enableRLS()` on the `pgTable`; tests fail otherwise.
- `updated_at` is set by the `set_updated_at` trigger (migration 0003), not app code. New tables need a `CREATE TRIGGER <table>_set_updated_at` line in a custom migration; tests fail otherwise.
- Two connection strings: `DATABASE_URL` (transaction pooler, port 6543, API runtime, prepared statements off) and `DATABASE_URL_SESSION` (session pooler, port 5432, migrations and seed). Both live in `.env` only.

- PostGIS and pg_trgm are installed in the `extensions` schema, not `public`. Geometry columns use the unqualified `geometry` type and rely on `extensions` being on the `search_path` (Supabase default; migration 0000 sets it elsewhere). Schema-qualify extension functions and operator classes in raw SQL, e.g. `extensions.gin_trgm_ops`, `extensions.ST_DWithin`.
- Points are `{ x: longitude, y: latitude }` in SRID 4326.
- Change the schema in `packages/db/src/schema`, then run `pnpm --filter @lalml/db db:generate` and commit the generated SQL and `drizzle/meta`. Never edit a migration that has already been applied.

## Commands

- `pnpm install`
- `pnpm dev`: run the API (http://localhost:8787) and web app (http://localhost:3000).
- `pnpm lint`, `pnpm typecheck`, `pnpm test`: the same checks CI runs on every pull request. Database tests run on PGlite (in-memory Postgres with PostGIS) via `@lalml/db/testing`, never a real database.
- `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:verify`: apply migrations, seed neighborhoods and `data/venues.csv`, and check the live database (extensions, search_path, RLS, triggers).

## API notes

- Errors are always `{ error: { code, message } }`. Throw `ApiError` from handlers; build routers with `createRouter()` so validation errors use the same shape.
- Every GET response gets `Cache-Control` from `lib/cache.ts`. List endpoints use opaque cursors (`lib/pagination.ts`) and return `{ data, next_cursor }`.
- "Tonight" for a venue lasts until 5am local time (`currentNight` in `lib/time.ts`), so late sets stay listed under their night.
