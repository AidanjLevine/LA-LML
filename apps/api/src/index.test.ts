import { beforeAll, describe, expect, it, vi } from "vitest";

// The real Vercel entry, with no database configured.
let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  app = (await import("./index.js")).default;
});

describe("Vercel entry (src/index.ts)", () => {
  it("serves health, reporting the missing database as degraded", async () => {
    const res = await app.request("/v1/health", { headers: { Origin: "https://example.org" } });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded", db: "error" });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns JSON 404s for unknown paths, inside and outside /v1", async () => {
    for (const path of ["/v1/nope", "/nope"]) {
      const res = await app.request(path);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_found");
    }
  });

  it("serves the spec and the docs", async () => {
    expect((await app.request("/v1/openapi.json")).status).toBe(200);
    expect((await app.request("/docs")).status).toBe(200);
  });
});
