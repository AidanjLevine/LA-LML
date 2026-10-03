// Show times are minutes after midnight on local_date (see schema/events.ts). Shared formatting.

/** 1500 -> "1:00 AM", 1230 -> "8:30 PM". */
export function formatMinutes(minutes: number): string {
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${hour24 < 12 ? "AM" : "PM"}`;
}
