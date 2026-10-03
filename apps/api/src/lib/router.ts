import { OpenAPIHono } from "@hono/zod-openapi";
import type { Db } from "@lalml/db";
import { errorBody } from "./errors.js";

export type AppEnv = {
  Variables: {
    /** Lazily connects on first use, so routes that don't need the database work without one. */
    db: () => Db;
    now: () => Date;
  };
};

/** OpenAPIHono whose request validation failures return our standard 400 error. */
export function createRouter() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const message = result.error.issues
          .map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
          .join("; ");
        return c.json(errorBody("invalid_request", message), 400);
      }
    },
  });
}
