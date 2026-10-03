import { describe, expect, it } from "vitest";
import { app } from "./app.js";

describe("GET /v1/health", () => {
  it("returns status ok", async () => {
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("GET /v1/openapi.json", () => {
  it("documents the health route", async () => {
    const res = await app.request("/v1/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths).toHaveProperty("/v1/health");
  });
});
