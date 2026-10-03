import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "../lib/router.js";

const HealthSchema = z
  .object({
    status: z.literal("ok").openapi({ example: "ok" }),
  })
  .openapi("Health");

const healthRoute = createRoute({
  method: "get",
  path: "/v1/health",
  tags: ["meta"],
  summary: "Health check",
  responses: {
    200: {
      description: "The API is up",
      content: { "application/json": { schema: HealthSchema } },
    },
  },
});

export const healthRouter = createRouter().openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));
