import type { Db } from "@lalml/db";
import { cacheHeaders } from "./lib/cache.js";
import { ApiError, errorBody } from "./lib/errors.js";
import { createRouter } from "./lib/router.js";
import { healthRouter } from "./routes/health.js";
import { neighborhoodsRouter } from "./routes/neighborhoods.js";
import { venuesRouter } from "./routes/venues.js";

export type AppDeps = {
  /** Called on first use per request; health checks never connect. */
  db: () => Db;
  /** Injectable clock for tests. */
  now?: () => Date;
};

export function createApp({ db, now = () => new Date() }: AppDeps) {
  const app = createRouter();

  app.use("*", cacheHeaders);
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("now", now);
    await next();
  });

  app.route("/", healthRouter);
  app.route("/", neighborhoodsRouter);
  app.route("/", venuesRouter);

  app.doc31("/v1/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "LA-LML API",
      version: "1.0.0",
      description: "Public API for live shows by small bands and DJs at Los Angeles bars and venues.",
    },
  });

  app.notFound((c) => c.json(errorBody("not_found", `No route for ${c.req.method} ${c.req.path}`), 404));
  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(errorBody(err.code, err.message), err.status);
    console.error(err);
    return c.json(errorBody("internal_error", "Something went wrong"), 500);
  });

  return app;
}
