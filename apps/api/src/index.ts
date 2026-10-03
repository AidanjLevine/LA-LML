// Vercel entry point: Vercel detects Hono and serves the default export.
import { createDb, type Db } from "@lalml/db";
import { requireEnv } from "@lalml/db/env";
import { createApp } from "./create-app.js";

let db: Db | undefined;

// DATABASE_URL is Supabase's transaction pooler (port 6543); the client turns prepared statements off.
const app = createApp({ db: () => (db ??= createDb(requireEnv("DATABASE_URL")).db) });

export default app;
