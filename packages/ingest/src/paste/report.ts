// Plain-text output for `pnpm shows:paste`.
import { formatMinutes } from "@lalml/db";
import type { ApplySummary } from "./apply.js";
import type { ArtistResolution, Plan, PlannedShow } from "./plan.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function displayDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "9:00 PM", or "1:00 AM*" for times after midnight (still that night). */
const displayTime = (minutes: number | null) =>
  minutes === null ? "TBA" : `${formatMinutes(minutes)}${minutes >= 1440 ? "*" : ""}`;

function displayArtist(a: ArtistResolution): string {
  if (a.type === "new") return `${a.name} [new ${a.kind}]`;
  if (a.via === "alias") return `${a.name} [alias]`;
  if (a.via === "fuzzy") return `${a.name} [~${a.similarity}]`;
  return a.name;
}

function displayAction(p: PlannedShow): string {
  switch (p.action.type) {
    case "create":
      return "create";
    case "link":
      return `link to ${p.action.eventId.slice(0, 8)}`;
    case "link-line":
      return `link to line ${p.action.line}`;
    case "skip":
      return "skip";
  }
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

export function formatPlan(plan: Plan): string {
  const out: string[] = [];
  const byVenue = new Map<string, PlannedShow[]>();
  for (const p of plan.shows) byVenue.set(p.venue.slug, [...(byVenue.get(p.venue.slug) ?? []), p]);

  for (const [slug, shows] of byVenue) {
    out.push(`@${slug}: ${shows[0]!.venue.name}`);
    out.push(
      table(
        ["Line", "Date", "Start", "Doors", "Lineup", "Prices", "Age", "Tickets", "Action"],
        shows.map((p) => [
          String(p.show.line),
          displayDate(p.show.localDate),
          displayTime(p.show.startMinutes),
          p.show.doorsMinutes === null ? "" : displayTime(p.show.doorsMinutes),
          p.artists.map(displayArtist).join(", "),
          [p.show.isFree ? "free" : "", ...p.show.prices.map((x) => `$${(x.cents / 100).toFixed(x.cents % 100 ? 2 : 0)}${x.description ? ` ${x.description}` : ""}`)]
            .filter(Boolean)
            .join(", "),
          p.show.ageLimit ?? "",
          p.show.ticketUrl ? new URL(p.show.ticketUrl).host : "",
          displayAction(p),
        ]),
      ),
    );
    out.push("");
  }
  if (plan.shows.some((p) => (p.show.startMinutes ?? 0) >= 1440 || (p.show.doorsMinutes ?? 0) >= 1440)) {
    out.push("* after midnight, still listed on that night");
    out.push("");
  }

  const counts = { create: 0, link: 0, "link-line": 0, skip: 0 };
  for (const p of plan.shows) counts[p.action.type]++;
  out.push(
    `${plan.shows.length} show(s): ${counts.create} new, ${counts.link + counts["link-line"]} linked to an existing show, ${counts.skip} skipped`,
  );

  if (plan.errors.length) {
    out.push("", `Errors (${plan.errors.length}). Fix these first; --commit refuses while any remain:`);
    for (const e of plan.errors) out.push(`  line ${e.line}: ${e.message}`);
  }
  if (plan.warnings.length) {
    out.push("", `Warnings (${plan.warnings.length}):`);
    for (const w of plan.warnings) out.push(`  line ${w.line}: ${w.message}`);
  }
  return out.join("\n");
}

export function formatSummary(summary: ApplySummary): string {
  return (
    `Committed: ${summary.eventsCreated} event(s) created, ${summary.linkedToExisting} linked to existing, ` +
    `${summary.artistsCreated} artist(s) created, ${summary.skipped} skipped.`
  );
}
