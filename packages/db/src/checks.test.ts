import { describe, expect, it } from "vitest";
import { classifyRestRead, classifyRestWrite } from "./checks.js";

const PGRST002 = { code: "PGRST002", message: "Could not query the database for the schema cache. Retrying." };

describe("Supabase REST lockdown checks", () => {
  it("count a disabled Data API as locked down", () => {
    expect(classifyRestRead(503, PGRST002)).toEqual({ locked: true, detail: "Data API disabled (503 PGRST002)" });
    expect(classifyRestWrite(503, PGRST002)).toEqual({ locked: true, detail: "Data API disabled (503 PGRST002)" });
  });

  it("count RLS denials as locked down", () => {
    expect(classifyRestRead(200, []).locked).toBe(true);
    expect(classifyRestRead(401, { message: "Invalid API key" }).locked).toBe(true);
    expect(classifyRestWrite(401, { code: "42501", message: "new row violates row-level security policy" }).locked).toBe(true);
  });

  it("fail when data comes back or RLS lets a write through", () => {
    expect(classifyRestRead(200, [{ slug: "example-bar" }])).toEqual({ locked: false, detail: "returned 1 rows" });
    expect(classifyRestWrite(400, { code: "23502", message: "null value in column" }).locked).toBe(false);
  });

  it("fail on other errors instead of guessing", () => {
    expect(classifyRestRead(503, { code: "PGRST000" }).locked).toBe(false);
    expect(classifyRestRead(500, null).locked).toBe(false);
    expect(classifyRestWrite(502, null).locked).toBe(false);
  });
});
