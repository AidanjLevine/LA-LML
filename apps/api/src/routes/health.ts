import { createRoute, z } from "@hono/zod-openapi";
import type { Db } from "@lalml/db";
import { sql } from "drizzle-orm";
import { logError } from "../lib/redact.js";
import { createRouter } from "../lib/router.js";

const HealthSchema = z
  .object({
    status: z.enum(["ok", "degraded"]).openapi({ example: "ok" }),
    db: z.enum(["ok", "error"]).openapi({ description: "Whether the database answered", example: "ok" }),
  })
  .openapi("Health");

const healthRoute = createRoute({
  method: "get",
  path: "/v1/health",
  tags: ["meta"],
  summary: "Health check",
  description: "Reports whether the API is up and the database answered. Never cached.",
  responses: {
    200: { description: "API and database are up", content: { "application/json": { schema: HealthSchema } } },
    503: { description: "The database didn't answer", content: { "application/json": { schema: HealthSchema } } },
  },
});

/** True if `select 1` answers within `timeoutMs`. Failures are logged (redacted), never returned. */
async function pingDb(getDb: () => Db, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getDb().execute(sql`select 1`),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`database ping timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return true;
  } catch (error) {
    logError("health: database check failed", error);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export const healthRouter = createRouter().openapi(healthRoute, async (c) => {
  const dbOk = await pingDb(c.var.db, c.var.dbTimeoutMs);
  c.header("Cache-Control", "no-store");
  return dbOk
    ? c.json({ status: "ok" as const, db: "ok" as const }, 200)
    : c.json({ status: "degraded" as const, db: "error" as const }, 503);
});
