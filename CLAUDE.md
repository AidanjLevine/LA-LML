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

- PostGIS and pg_trgm are installed in the `extensions` schema, not `public`. Geometry columns use the unqualified `geometry` type and rely on `extensions` being on the `search_path` (Supabase default; migration 0000 sets it elsewhere). Schema-qualify extension functions and operator classes in raw SQL, e.g. `extensions.gin_trgm_ops`, `extensions.ST_DWithin`.
- Points are `{ x: longitude, y: latitude }` in SRID 4326.
- Change the schema in `packages/db/src/schema`, then run `pnpm --filter @lalml/db db:generate` and commit the generated SQL and `drizzle/meta`. Never edit a migration that has already been applied.

## Commands

- `pnpm install`
- `pnpm dev`: run the API (http://localhost:8787) and web app (http://localhost:3000).
- `pnpm lint`, `pnpm typecheck`, `pnpm test`: the same checks CI runs on every pull request.
