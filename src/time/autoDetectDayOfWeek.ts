import { DayOfWeek } from "../formulas/types";

// This product currently only serves India-based POIs, all in a single,
// fixed, non-DST timezone (UTC+5:30) — a per-POI real-timezone lookup from
// coordinates would be real complexity for zero behavioral difference today.
// If the product ever expands outside India, this is the one place to
// revisit (see git history for the coordinate-based tz-lookup version this
// replaced). Uses `Intl.DateTimeFormat`'s `timeZone` option rather than the
// server's own OS timezone, so this stays correct wherever the server is
// actually hosted — cloud VMs commonly default to UTC — same reasoning
// calendarRepository.ts uses for "today".
const IST_TIMEZONE = "Asia/Kolkata";

/**
 * Auto-detects the current day of week in India Standard Time. No network
 * call, no coordinates needed, never throws.
 */
export function autoDetectDayOfWeek(): DayOfWeek {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: IST_TIMEZONE, weekday: "long" }).format(new Date());
  return weekday.toLowerCase() as DayOfWeek;
}
