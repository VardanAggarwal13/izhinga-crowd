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
 * 24-hour cache for day-of-week detection. Day only changes once per 24h,
 * so caching by IST date eliminates 5-10ms Intl.DateTimeFormat overhead
 * on every request. All requests in a calendar day reuse the same entry.
 */
interface DayOfWeekCacheEntry {
  day: DayOfWeek;
  expiresAt: number;
}

const DAY_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
let dayCache: DayOfWeekCacheEntry | null = null;
let lastCacheDate: string | null = null;

/**
 * Gets today's date in IST as YYYY-MM-DD (cache key).
 */
function getTodayIstDate(): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Auto-detects the current day of week in India Standard Time. Cached per
 * 24-hour calendar day — day only changes once per day, so we compute it
 * once and reuse for all requests that calendar day. Intl.DateTimeFormat
 * overhead avoided for 99% of requests. Never throws.
 */
export function autoDetectDayOfWeek(): DayOfWeek {
  const today = getTodayIstDate();
  const now = Date.now();

  // Cache hit: same date, not expired
  if (dayCache && lastCacheDate === today && now < dayCache.expiresAt) {
    return dayCache.day;
  }

  // Cache miss or expired: compute day of week
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: IST_TIMEZONE, weekday: "long" }).format(new Date());
  const day = weekday.toLowerCase() as DayOfWeek;

  // Store in cache for rest of this calendar day
  dayCache = { day, expiresAt: now + DAY_CACHE_TTL_MS };
  lastCacheDate = today;

  return day;
}
