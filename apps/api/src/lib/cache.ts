import type { MiddlewareHandler } from "hono";

/** Public data, so browsers and the CDN may cache it briefly; the CDN can serve stale while it refreshes. */
export const CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

/** Adds CACHE_CONTROL to GET responses unless the handler set its own (e.g. health uses no-store). */
export const cacheHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return;
  if (c.res.status >= 500) c.header("Cache-Control", "no-store");
  else if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", CACHE_CONTROL);
};
