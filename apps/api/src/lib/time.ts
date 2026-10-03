/**
 * Show times are local_date plus minutes after midnight in the venue's time zone.
 * Minutes from 1440 up are after midnight, so a 1am set on Friday's show is 1500 dated Friday.
 */

/** Before this local hour, "tonight" still means the previous date, so late sets stay listed. */
export const NIGHT_ENDS_AT_HOUR = 5;

/** 1500 -> "1:00 AM", 1230 -> "8:30 PM". */
export function formatMinutes(minutes: number): string {
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${hour24 < 12 ? "AM" : "PM"}`;
}

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
