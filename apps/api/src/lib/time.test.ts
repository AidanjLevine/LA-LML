import { describe, expect, it } from "vitest";
import { currentNight, formatMinutes } from "./time.js";

describe("formatMinutes", () => {
  it.each([
    [0, "12:00 AM"],
    [570, "9:30 AM"],
    [720, "12:00 PM"],
    [1260, "9:00 PM"],
    [1440, "12:00 AM"],
    [1500, "1:00 AM"],
    [1625, "3:05 AM"],
  ])("%i -> %s", (minutes, expected) => {
    expect(formatMinutes(minutes)).toBe(expected);
  });
});

describe("currentNight", () => {
  const la = "America/Los_Angeles";
  it("is the local date in the evening", () => {
    expect(currentNight(new Date("2026-10-03T03:00:00Z"), la)).toBe("2026-10-02"); // 8pm PDT Oct 2
  });
  it("is still the previous date before 5am", () => {
    expect(currentNight(new Date("2026-10-03T08:30:00Z"), la)).toBe("2026-10-02"); // 1:30am PDT Oct 3
  });
  it("rolls over at 5am", () => {
    expect(currentNight(new Date("2026-10-03T12:00:00Z"), la)).toBe("2026-10-03"); // 5am PDT Oct 3
  });
  it("handles month boundaries", () => {
    expect(currentNight(new Date("2026-11-01T09:00:00Z"), la)).toBe("2026-10-31"); // 2am PDT Nov 1
  });
});
