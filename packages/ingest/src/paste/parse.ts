// Parser for the bulk-paste show format (docs/BULK_PASTE.md). Pure: no database, no clock.
import { NIGHT_ENDS_AT_HOUR } from "@lalml/db";

export const ARTIST_KINDS = ["band", "dj", "solo", "cover"] as const;
export type ArtistKind = (typeof ARTIST_KINDS)[number];

export type PastedArtist = { name: string; kind: ArtistKind | null };
export type PastedPrice = { cents: number; description: string | null };

export type PastedShow = {
  line: number;
  raw: string;
  venueSlug: string;
  /** Line of the `@venue` directive this show belongs to. */
  venueLine: number;
  /** From a `source <url>` directive: where the listing came from. */
  sourceUrl: string | null;
  localDate: string;
  /** Minutes after midnight on localDate; 1440+ means after midnight. Null for TBA. */
  startMinutes: number | null;
  doorsMinutes: number | null;
  lineup: PastedArtist[];
  prices: PastedPrice[];
  isFree: boolean;
  ageLimit: string | null;
  ticketUrl: string | null;
};

export type PasteIssue = { line: number; message: string };
export type ParseResult = { shows: PastedShow[]; errors: PasteIssue[] };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Without a year, a date this many days in the past still counts as this year (late entries). */
const PAST_GRACE_DAYS = 30;

class LineError extends Error {}

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function validDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const weekdayOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const daysBetween = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

/** "Fri Oct 9", "October 9", "10/9", "10/9/2026", "2026-10-09" -> "2026-10-09". `today` is YYYY-MM-DD. */
export function parseDate(text: string, today: string): string {
  let rest = text.trim().replace(/\s+/g, " ");
  let weekday: number | null = null;

  const first = rest.split(" ")[0]!.replace(/[.,]$/, "").toLowerCase();
  if (/^[a-z]{3,}$/.test(first)) {
    const index = WEEKDAYS.findIndex((w) => w.startsWith(first));
    if (index >= 0 && !MONTHS.some((m) => first.startsWith(m))) {
      weekday = index;
      rest = rest.slice(rest.indexOf(" ") + 1).trim();
      if (rest === text.trim()) throw new LineError(`no date after the weekday in "${text}"`);
    }
  }

  let year: number | null = null;
  let month: number;
  let day: number;
  let m: RegExpMatchArray | null;
  if ((m = rest.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = rest.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/))) {
    [month, day] = [Number(m[1]), Number(m[2])];
    if (m[3]) year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  } else if ((m = rest.match(/^([a-z]{3,})\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?$/i))) {
    const monthIndex = MONTHS.findIndex((name) => m![1]!.toLowerCase().startsWith(name));
    if (monthIndex < 0) throw new LineError(`unknown month "${m[1]}"`);
    [month, day] = [monthIndex + 1, Number(m[2])];
    if (m[3]) year = Number(m[3]);
  } else {
    throw new LineError(`can't read the date "${text}" (try "Fri Oct 9", "10/9" or "2026-10-09")`);
  }

  const todayYear = Number(today.slice(0, 4));
  if (year === null) {
    year = todayYear;
    if (validDate(year, month, day) && daysBetween(isoDate(year, month, day), today) > PAST_GRACE_DAYS) year += 1;
  }
  if (!validDate(year, month, day)) throw new LineError(`"${text}" isn't a real date`);
  const iso = isoDate(year, month, day);

  if (weekday !== null && weekdayOf(iso) !== weekday) {
    throw new LineError(
      `"${text}" says ${WEEKDAY_SHORT[weekday]}, but ${iso} is a ${WEEKDAY_SHORT[weekdayOf(iso)]}; check the date`,
    );
  }
  return iso;
}

/** "9pm", "9:30 pm", "21:00", "noon", "midnight" -> minutes on a 24-hour clock (0-1439). */
export function parseClock(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\./g, "");
  if (t === "noon") return 720;
  if (t === "midnight") return 0;
  let m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)$/);
  if (m) {
    const hour = Number(m[1]);
    const minute = Number(m[2] ?? 0);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    return ((hour % 12) + (m[3]!.startsWith("p") ? 12 : 0)) * 60 + minute;
  }
  m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    return hour < 24 && minute < 60 ? hour * 60 + minute : null;
  }
  return null;
}

/** Clock time -> minutes on the show's night: before 5am belongs to the night before (1am -> 1500). */
export const nightMinutes = (clock: number) => (clock < NIGHT_ENDS_AT_HOUR * 60 ? clock + 1440 : clock);

function parseTime(text: string, label: string): number {
  const clock = parseClock(text);
  if (clock === null) throw new LineError(`can't read the ${label} time "${text}" (try "9pm" or "21:00")`);
  return nightMinutes(clock);
}

/** Splits on commas that aren't inside double quotes. */
function splitOutsideQuotes(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (char === "," && !quoted) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (quoted) throw new LineError(`unclosed quote in "${text}"`);
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseLineup(text: string): PastedArtist[] {
  const artists = splitOutsideQuotes(text).map((item): PastedArtist => {
    const m = item.match(/^(.*?)\s*\((band|dj|solo|cover)\)$/i);
    const rawName = (m ? m[1]! : item).trim();
    const name = rawName.replace(/^"(.*)"$/, "$1").replace(/\s+/g, " ").trim();
    if (!name) throw new LineError(`empty artist name in "${text}"`);
    if (parseClock(name) !== null || /^\$/.test(name) || /^doors?\b/i.test(name)) {
      throw new LineError(`"${name}" looks like a time or price, not an artist; put it in its own | field`);
    }
    return { name, kind: m ? (m[2]!.toLowerCase() as ArtistKind) : null };
  });
  const seen = new Set<string>();
  for (const a of artists) {
    const key = a.name.toLowerCase();
    if (seen.has(key)) throw new LineError(`"${a.name}" is listed twice in the lineup`);
    seen.add(key);
  }
  return artists;
}

function parsePrices(text: string): { prices: PastedPrice[]; isFree: boolean } {
  const prices: PastedPrice[] = [];
  let isFree = false;
  for (const part of splitOutsideQuotes(text)) {
    if (/^free$/i.test(part)) {
      isFree = true;
      continue;
    }
    const m = part.match(/^\$(\d+(?:\.\d{1,2})?)\s*(.*)$/);
    if (!m) throw new LineError(`can't read the price "${part}" (try "$15 presale" or "free")`);
    prices.push({ cents: Math.round(Number(m[1]) * 100), description: m[2]!.trim() || null });
  }
  return { prices, isFree };
}

function parseShowLine(raw: string): Omit<PastedShow, "line" | "raw" | "venueSlug" | "venueLine" | "sourceUrl"> & { dateText: string } {
  const fields = raw.split("|").map((f) => f.trim()).filter(Boolean);
  if (fields.length < 3) throw new LineError("a show needs at least date | start time | lineup");
  const [dateText, startText, ...rest] = fields as [string, string, ...string[]];

  const startMinutes = /^(tba|tbd)$/i.test(startText) ? null : parseTime(startText, "start");
  let doorsMinutes: number | null = null;
  let lineup: PastedArtist[] | null = null;
  let prices: PastedPrice[] = [];
  let isFree = false;
  let ageLimit: string | null = null;
  let ticketUrl: string | null = null;

  for (const field of rest) {
    let m: RegExpMatchArray | null;
    if ((m = field.match(/^doors?\s+(.+)$/i))) {
      doorsMinutes = parseTime(m[1]!, "doors");
    } else if (/^(\$|free\b)/i.test(field)) {
      ({ prices, isFree } = parsePrices(field));
    } else if ((m = field.match(/^(\d{2})\s*\+$/))) {
      ageLimit = `${m[1]}+`;
    } else if (/^all[\s-]ages$/i.test(field)) {
      ageLimit = "all ages";
    } else if (/^https?:\/\//i.test(field)) {
      try {
        ticketUrl = new URL(field).toString();
      } catch {
        throw new LineError(`"${field}" isn't a valid URL`);
      }
    } else if (lineup) {
      throw new LineError(`two lineup fields ("${field}"); separate artists with commas, not |`);
    } else {
      lineup = parseLineup(field);
    }
  }
  if (!lineup) throw new LineError("no lineup");
  return { dateText, localDate: "", startMinutes, doorsMinutes, lineup, prices, isFree, ageLimit, ticketUrl };
}

/**
 * Parses a bulk-paste file. `today` (YYYY-MM-DD, Los Angeles) resolves dates written without a year.
 * Every problem is reported with its line number; a line with an error produces no show.
 */
export function parsePaste(text: string, today: string): ParseResult {
  const shows: PastedShow[] = [];
  const errors: PasteIssue[] = [];
  let venue: { slug: string; line: number } | null = null;
  let sourceUrl: string | null = null;

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = index + 1;
    const raw = rawLine.trim();
    if (!raw || raw.startsWith("#")) return;
    try {
      let m: RegExpMatchArray | null;
      if ((m = raw.match(/^@\s*(\S+)$/))) {
        const slug = m[1]!.toLowerCase();
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new LineError(`"${m[1]}" isn't a venue slug (like @the-echo)`);
        venue = { slug, line };
        sourceUrl = null;
      } else if ((m = raw.match(/^source:?\s+(\S+)$/i))) {
        if (!venue) throw new LineError("`source` must come after an @venue line");
        try {
          sourceUrl = new URL(m[1]!).toString();
        } catch {
          throw new LineError(`"${m[1]}" isn't a valid URL`);
        }
      } else {
        if (!venue) throw new LineError("show line before any @venue line");
        const { dateText, ...show } = parseShowLine(raw);
        show.localDate = parseDate(dateText, todayOrThrow(today));
        shows.push({ line, raw, venueSlug: venue.slug, venueLine: venue.line, sourceUrl, ...show });
      }
    } catch (error) {
      if (!(error instanceof LineError)) throw error;
      errors.push({ line, message: error.message });
    }
  });

  return { shows, errors };
}

function todayOrThrow(today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error(`today must be YYYY-MM-DD, got "${today}"`);
  return today;
}

/** The date in Los Angeles right now (YYYY-MM-DD), for resolving dates written without a year. */
export function todayInLosAngeles(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);
}
