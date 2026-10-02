import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

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

export const app = new OpenAPIHono();

app.openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));

app.doc31("/v1/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "LA-LML API",
    version: "1.0.0",
    description: "Public API for live shows by small bands and DJs at Los Angeles bars and venues.",
  },
});

export default app;
