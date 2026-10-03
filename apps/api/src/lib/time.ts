/**
 * Show times are local_date plus minutes after midnight in the venue's time zone.
 * Minutes from 1440 up are after midnight, so a 1am set on Friday's show is 1500 dated Friday.
 */

import { formatMinutes, NIGHT_ENDS_AT_HOUR } from "@lalml/db";

export { formatMinutes } from "@lalml/db";

export const timeOf = (minutes: number | null) =>
  minutes === null ? null : { minutes, time: formatMinutes(minutes) };

/** The date (YYYY-MM-DD) of the current night in `timeZone`. At 1:30am Saturday it's Friday. */
export function currentNight(now: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  if (Number(parts.hour) < NIGHT_ENDS_AT_HOUR) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
