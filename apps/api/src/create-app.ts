import type { Db } from "@lalml/db";
import { Scalar } from "@scalar/hono-api-reference";
import type { ErrorHandler, NotFoundHandler } from "hono";
import { cacheHeaders } from "./lib/cache.js";
import { corsMiddleware } from "./lib/cors.js";
import { ApiError, errorBody } from "./lib/errors.js";
import { logError } from "./lib/redact.js";
import { createRouter } from "./lib/router.js";
import { artistsRouter } from "./routes/artists.js";
import { eventsRouter } from "./routes/events.js";
import { genresRouter } from "./routes/genres.js";
import { healthRouter } from "./routes/health.js";
import { mapRouter } from "./routes/map.js";
import { neighborhoodsRouter } from "./routes/neighborhoods.js";
import { venuesRouter } from "./routes/venues.js";

export type AppDeps = {
  /** Called on first use; returns the per-instance client. Routes that don't need it never connect. */
  db: () => Db;
  /** Injectable clock for tests. */
  now?: () => Date;
  /** How long /v1/health waits for the database (ms). */
  dbTimeoutMs?: number;
};

export const notFoundHandler: NotFoundHandler = (c) =>
  c.json(errorBody("not_found", `No route for ${c.req.method} ${c.req.path}`), 404);

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof ApiError) return c.json(errorBody(err.code, err.message), err.status);
  logError(`${c.req.method} ${c.req.path}`, err);
  return c.json(errorBody("internal_error", "Something went wrong"), 500);
};

export function createApp({ db, now = () => new Date(), dbTimeoutMs = 5_000 }: AppDeps) {
  const app = createRouter();

  app.use("*", cacheHeaders);
  app.use("/v1/*", corsMiddleware);
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("now", now);
    c.set("dbTimeoutMs", dbTimeoutMs);
    await next();
  });

  app.route("/", healthRouter);
  app.route("/", neighborhoodsRouter);
  app.route("/", venuesRouter);
  app.route("/", eventsRouter);
  app.route("/", artistsRouter);
  app.route("/", mapRouter);
  app.route("/", genresRouter);

  app.doc31("/v1/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "LA-LML API",
      version: "1.0.0",
      description: "Public API for live shows by small bands and DJs at Los Angeles bars and venues.",
    },
  });

  // Interactive docs, rendered from the spec above. Not part of the spec itself.
  app.get("/docs", Scalar({ url: "/v1/openapi.json", pageTitle: "LA-LML API" }));

  app.notFound(notFoundHandler);
  app.onError(errorHandler);

  return app;
}
