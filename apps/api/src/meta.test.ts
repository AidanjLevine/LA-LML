import { describe, expect, it } from "vitest";
import { createApp } from "./create-app.js";
import { CACHE_CONTROL } from "./lib/cache.js";

// No database: these routes must never connect.
const app = createApp({
  db: () => {
    throw new Error("database should not be used");
  },
});

describe("GET /v1/health", () => {
  it("returns status ok with cache headers", async () => {
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL);
  });
});

describe("GET /v1/openapi.json", () => {
  it("documents every route", async () => {
    const res = await app.request("/v1/openapi.json");
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths).sort()).toEqual([
      "/v1/health",
      "/v1/neighborhoods",
      "/v1/venues",
      "/v1/venues/{slug}",
      "/v1/venues/{slug}/events",
    ]);
  });
});

describe("errors", () => {
  it("returns the standard error shape for unknown routes", async () => {
    const res = await app.request("/v1/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "No route for GET /v1/nope" } });
  });

  it("hides internal errors and doesn't cache them", async () => {
    const res = await app.request("/v1/neighborhoods");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "internal_error", message: "Something went wrong" } });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
