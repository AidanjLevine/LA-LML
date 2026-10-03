import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

/** Public read API: any origin may GET. No cookies or credentials are involved. */
const publicCors = cors({
  origin: "*",
  allowMethods: ["GET", "HEAD", "OPTIONS"],
  maxAge: 86_400,
});

const isAdminPath = (path: string) => path === "/v1/admin" || path.startsWith("/v1/admin/");

export const corsMiddleware: MiddlewareHandler = (c, next) => {
  if (isAdminPath(c.req.path)) {
    // /v1/admin: restrict origins here. Admin routes must never get the public wildcard.
    // When they exist, return cors({ origin: [<admin web origin>], credentials: true, ... })(c, next).
    // Until then they get no CORS headers, so browsers on other origins can't call them.
    return next();
  }
  return publicCors(c, next);
};
