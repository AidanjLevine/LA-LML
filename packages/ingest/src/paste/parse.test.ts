import { describe, expect, it } from "vitest";
import { nightMinutes, parseClock, parseDate, parsePaste, todayInLosAngeles } from "./parse.js";

// Friday 2026-10-02 in Los Angeles.
const TODAY = "2026-10-02";

describe("parseDate", () => {
  it.each([
    ["2026-10-09", "2026-10-09"],
    ["Fri Oct 9", "2026-10-09"],
    ["Friday October 9", "2026-10-09"],
    ["Fri. Oct. 9th", "2026-10-09"],
    ["Oct 9", "2026-10-09"],
    ["10/9", "2026-10-09"],
    ["10/9/26", "2026-10-09"],
    ["Sat 10/10", "2026-10-10"],
    ["Mon 1/4", "2027-01-04"], // January is next year
    ["Sep 20", "2026-09-20"], // 12 days ago: still this year (late entry)
    ["Aug 1", "2027-08-01"], // more than 30 days ago: next year
  ])("%s -> %s", (text, expected) => {
    expect(parseDate(text, TODAY)).toBe(expected);
  });

  it("rejects a weekday that doesn't match the date", () => {
    expect(() => parseDate("Thu Oct 9", TODAY)).toThrow('says Thu, but 2026-10-09 is a Fri');
  });

  it("rejects impossible and unreadable dates", () => {
    expect(() => parseDate("Feb 30", TODAY)).toThrow("isn't a real date");
    expect(() => parseDate("next friday", TODAY)).toThrow("can't read the date");
    expect(() => parseDate("Smarch 3", TODAY)).toThrow('unknown month "Smarch"');
  });
});

describe("times", () => {
  it.each([
    ["9pm", 1260],
    ["9:30 PM", 1290],
    ["9:30p", 1290],
    ["21:00", 1260],
    ["noon", 720],
    ["12pm", 720],
    ["12am", 0],
    ["midnight", 0],
    ["1am", 60],
  ])("parseClock(%s) = %i", (text, minutes) => {
    expect(parseClock(text)).toBe(minutes);
  });

  it("rejects nonsense", () => {
    expect(parseClock("13pm")).toBeNull();
    expect(parseClock("25:00")).toBeNull();
    expect(parseClock("late")).toBeNull();
  });

  it("puts times before 5am on the night before", () => {
    expect(nightMinutes(0)).toBe(1440); // midnight
    expect(nightMinutes(60)).toBe(1500); // 1am
    expect(nightMinutes(4 * 60 + 59)).toBe(1739); // 4:59am
    expect(nightMinutes(5 * 60)).toBe(300); // 5am is morning
    expect(nightMinutes(21 * 60)).toBe(1260);
  });
});

describe("parsePaste", () => {
  const parse = (text: string) => parsePaste(text, TODAY);

  it("parses a full show line", () => {
    const { shows, errors } = parse(
      [
        "@the-echo",
        "source https://theecho.com/calendar",
        "Fri Oct 9 | 9pm | doors 8pm | The Band (band), DJ Late (DJ) | $15 presale, $20 door | 21+ | https://tix.example/123",
      ].join("\n"),
    );
    expect(errors).toEqual([]);
    expect(shows).toEqual([
      {
        line: 3,
        raw: "Fri Oct 9 | 9pm | doors 8pm | The Band (band), DJ Late (DJ) | $15 presale, $20 door | 21+ | https://tix.example/123",
        venueSlug: "the-echo",
        venueLine: 1,
        sourceUrl: "https://theecho.com/calendar",
        localDate: "2026-10-09",
        startMinutes: 1260,
        doorsMinutes: 1200,
        lineup: [
          { name: "The Band", kind: "band" },
          { name: "DJ Late", kind: "dj" },
        ],
        prices: [
          { cents: 1500, description: "presale" },
          { cents: 2000, description: "door" },
        ],
        isFree: false,
        ageLimit: "21+",
        ticketUrl: "https://tix.example/123",
      },
    ]);
  });

  it("keeps a 1am set on the listed night", () => {
    const { shows } = parse("@the-echo\nFri Oct 9 | 1am | doors 11pm | Night Owls (dj)");
    expect(shows[0]).toMatchObject({ localDate: "2026-10-09", startMinutes: 1500, doorsMinutes: 1380 });
  });

  it("accepts optional fields in any order, free entry, quoted names and TBA", () => {
    const { shows, errors } = parse(
      ['@zebulon', 'Oct 10 | TBA | all ages | free | "Crosby, Stills & Nosh" (cover), Opener', "10/11 | 8:30pm | Solo Act (solo) | $12.50"].join(
        "\n",
      ),
    );
    expect(errors).toEqual([]);
    expect(shows[0]).toMatchObject({
      startMinutes: null,
      isFree: true,
      prices: [],
      ageLimit: "all ages",
      lineup: [
        { name: "Crosby, Stills & Nosh", kind: "cover" },
        { name: "Opener", kind: null },
      ],
    });
    expect(shows[1]).toMatchObject({ localDate: "2026-10-11", startMinutes: 1230, prices: [{ cents: 1250, description: null }] });
  });

  it("switches venues and resets the source", () => {
    const { shows } = parse("@a\nsource https://a.example\nOct 9 | 9pm | X\n@b\nOct 9 | 9pm | Y");
    expect(shows.map((s) => [s.venueSlug, s.sourceUrl])).toEqual([
      ["a", "https://a.example/"],
      ["b", null],
    ]);
  });

  it("skips comments and blank lines", () => {
    expect(parse("# header\n\n@a\n  # note\nOct 9 | 9pm | X\n").shows).toHaveLength(1);
  });

  it("reports every bad line with its number and keeps the good ones", () => {
    const { shows, errors } = parse(
      [
        "Oct 9 | 9pm | Too Early", // 1: before any venue
        "@the-echo", // 2
        "Thu Oct 9 | 9pm | Wrong Day", // 3
        "Oct 9 | late | Bad Time", // 4
        "Oct 9 | 9pm", // 5
        "Oct 9 | 9pm | A | B", // 6
        "Oct 9 | 9pm | A, 10pm", // 7
        "Oct 9 | 9pm | A, a", // 8
        "Oct 9 | 9pm | A | $ten", // 9
        "Oct 9 | 9pm | Good", // 10
        "@The Echo", // 11
      ].join("\n"),
    );
    expect(shows.map((s) => s.line)).toEqual([10]);
    expect(errors.map((e) => e.line)).toEqual([1, 3, 4, 5, 6, 7, 8, 9, 11]);
    expect(errors[0]!.message).toBe("show line before any @venue line");
    expect(errors[1]!.message).toMatch(/says Thu, but 2026-10-09 is a Fri/);
    expect(errors[2]!.message).toMatch(/can't read the start time "late"/);
    expect(errors[4]!.message).toMatch(/two lineup fields/);
    expect(errors[5]!.message).toMatch(/"10pm" looks like a time/);
    expect(errors[6]!.message).toMatch(/listed twice/);
  });
});

describe("todayInLosAngeles", () => {
  it("uses the Los Angeles date, not UTC", () => {
    expect(todayInLosAngeles(new Date("2026-10-03T03:00:00Z"))).toBe("2026-10-02"); // 8pm PDT
  });
});
