import type { Db } from "@lalml/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./create-app.js";
import { CACHE_CONTROL } from "./lib/cache.js";

const SECRET_URL = "postgresql://postgres.abcdefghijklmnopqrst:s3cret-pw@aws-0-us-west-1.pooler.supabase.com:6543/postgres";

/** A db whose only supported call is `execute`, which is all /v1/health uses. */
const fakeDb = (execute: () => Promise<unknown>) => () => ({ execute }) as unknown as Db;
const brokenDb = () => {
  throw new Error(`could not connect to ${SECRET_URL}`);
};

afterEach(() => vi.restoreAllMocks());

describe("GET /v1/health", () => {
  it("reports ok when the database answers, and is never cached", async () => {
    const app = createApp({ db: fakeDb(async () => [{ "?column?": 1 }]) });
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "ok" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("reports degraded without error details when the database fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = createApp({ db: fakeDb(async () => Promise.reject(new Error(`timeout talking to ${SECRET_URL}`))) });
    const res = await app.request("/v1/health");
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: "degraded", db: "error" });
    expect(text).not.toContain("timeout");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]![0]).not.toContain("s3cret-pw");
    expect(log.mock.calls[0]![0]).toContain("postgresql://<redacted>@aws-0-us-west-1");
  });

  it("reports degraded when the database hangs past the timeout", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = createApp({ db: fakeDb(() => new Promise(() => {})), dbTimeoutMs: 20 });
    const res = await app.request("/v1/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded", db: "error" });
  });

  it("reports degraded when the client can't be created", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await createApp({ db: brokenDb }).request("/v1/health");
    expect(res.status).toBe(503);
  });
});

describe("errors", () => {
  it("returns the standard error shape for unknown routes", async () => {
    const res = await createApp({ db: brokenDb }).request("/v1/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "No route for GET /v1/nope" } });
  });

  it("hides internal errors, redacts the log and doesn't cache", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await createApp({ db: brokenDb }).request("/v1/neighborhoods");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "internal_error", message: "Something went wrong" } });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(log.mock.calls[0]![0]).toMatch(/^GET \/v1\/neighborhoods: /);
    expect(log.mock.calls[0]![0]).not.toContain("s3cret-pw");
  });
});

describe("CORS", () => {
  const app = createApp({ db: fakeDb(async () => []) });

  it("lets any origin GET public routes", async () => {
    const res = await app.request("/v1/health", { headers: { Origin: "https://example.org" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers preflight requests for GET", async () => {
    const res = await app.request("/v1/venues", {
      method: "OPTIONS",
      headers: { Origin: "https://example.org", "Access-Control-Request-Method": "GET" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET,HEAD,OPTIONS");
  });

  it("gives /v1/admin no CORS headers", async () => {
    const res = await app.request("/v1/admin/venues", { headers: { Origin: "https://example.org" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("docs", () => {
  const app = createApp({ db: brokenDb });

  it("documents every route", async () => {
    const res = await app.request("/v1/openapi.json");
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths).sort()).toEqual([
      "/v1/artists",
      "/v1/artists/{slug}",
      "/v1/artists/{slug}/events",
      "/v1/events",
      "/v1/events/{id}",
      "/v1/genres",
      "/v1/health",
      "/v1/map",
      "/v1/neighborhoods",
      "/v1/venues",
      "/v1/venues/{slug}",
      "/v1/venues/{slug}/events",
    ]);
    expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL);
  });

  it("serves interactive docs at /docs from the spec", async () => {
    const res = await app.request("/docs");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toContain("/v1/openapi.json");
  });
});
