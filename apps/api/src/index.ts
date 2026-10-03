// Vercel entry point. Vercel's Hono preset looks for a file like src/index.ts that imports `hono`
// and default-exports the app. The local Node server lives in dev.ts.
import { createDb, type Db } from "@lalml/db";
import { requireEnv } from "@lalml/db/env";
import { Hono } from "hono";
import { createApp, errorHandler, notFoundHandler } from "./create-app.js";

// One client per function instance, created on first use and reused across requests.
// DATABASE_URL is Supabase's transaction pooler (port 6543); see createDb for the serverless settings.
let db: Db | undefined;
const api = createApp({ db: () => (db ??= createDb(requireEnv("DATABASE_URL")).db) });

const app = new Hono();
app.route("/", api);
// Paths that match no route are handled by the root app, so it needs the same JSON 404/500 handlers.
app.notFound(notFoundHandler);
app.onError(errorHandler);

export default app;
