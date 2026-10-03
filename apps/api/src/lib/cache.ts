import type { MiddlewareHandler } from "hono";

/** Public data, so browsers and the CDN may cache it briefly; the CDN can serve stale while it refreshes. */
export const CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

export const cacheHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return;
  c.header("Cache-Control", c.res.status >= 500 ? "no-store" : CACHE_CONTROL);
};
