import { Collection } from "mongodb";
import { getDb } from "./mongo";
import { EventType, HolidayType, RangedInput } from "../formulas/types";

/**
 * One "calendar" collection holds both festival/holiday entries and
 * city-specific event entries for a given date, discriminated by `kind` — a
 * single place for the calling team (or whoever maintains this) to manage
 * the whole year, instead of two separate stores for two closely related
 * concepts. See src/data/calendarEvents.ts for the seed content and
 * src/db/seedCalendar.ts for the one-time load script.
 *
 * `city: null` means "applies everywhere" (a true national holiday — Republic
 * Day, Independence Day, Christmas, etc.). A specific city name means it only
 * applies to POIs in that city — most Indian festivals are regional, not
 * national (Baisakhi matters hugely in Punjab and barely registers
 * elsewhere; Onam is Kerala-specific; Durga Puja's biggest crowds are West
 * Bengal). A single nationwide calendar was wrong for exactly this reason.
 *
 * `event_id` is a stable key (e.g. "AMR_GURPURAB" — deliberately NOT
 * year-suffixed) that poi_event_overrides.ts's overrides reference — one
 * event can affect different POIs very differently even within the same
 * city (Guru Nanak Jayanti hits Golden Temple far harder than a restaurant
 * three streets away), so the per-POI layer needs something more specific
 * than (date, city) to hang off of. Keeping it year-stable means next year's
 * reseed only has to update dates in this file, not touch every POI
 * override too — the override still applies once this event's id shows up
 * again with a new year's dates.
 *
 * `start_date`/`end_date` (same day for a single-day event) rather than one
 * `date` — many real festivals/seasons genuinely span a range (Kanwar Yatra
 * runs the whole Shravan month; a hill station's "summer season" spans
 * months), and forcing those into one arbitrary day would misrepresent them.
 */
export interface CalendarDoc {
  start_date: string; // YYYY-MM-DD, IST
  end_date: string; // YYYY-MM-DD, IST — same as start_date for a single-day event
  name: string;
  kind: "holiday" | "event";
  city: string | null; // null = nationwide; otherwise a specific city (matched case-insensitively against the POI's scraped address)
  event_id?: string; // referenced by poi_event_overrides for POI-specific overrides of this exact event
  holiday?: RangedInput<HolidayType>; // present when kind === "holiday"
  event?: RangedInput<EventType>; // present when kind === "event"
}

/**
 * A POI-specific override for a given calendar event — used when we have
 * real, specific knowledge that a particular POI is affected differently
 * than the generic city-wide value (e.g. Golden Temple during Guru Nanak
 * Jayanti gets a far bigger surge than an average Amritsar POI on the same
 * day). Looked up by (event_id, place_id); if no row matches, the generic
 * city/nationwide value from `calendar_events` is used instead — this is a
 * pure enhancement layer, never a requirement.
 */
export interface PoiEventOverride {
  event_id: string;
  place_id: string; // Google place_id (ChIJ...) or CID (0x...:0x...) — whichever this POI was scraped/identified with
  poi_name?: string; // for readability when browsing the collection directly
  holiday?: RangedInput<HolidayType>;
  event?: RangedInput<EventType>;
}

const CALENDAR_COLLECTION = "calendar_events";
const POI_OVERRIDES_COLLECTION = "poi_event_overrides";

async function getCalendarCollection(): Promise<Collection<CalendarDoc>> {
  const db = await getDb();
  return db.collection<CalendarDoc>(CALENDAR_COLLECTION);
}

async function getPoiOverridesCollection(): Promise<Collection<PoiEventOverride>> {
  const db = await getDb();
  return db.collection<PoiEventOverride>(POI_OVERRIDES_COLLECTION);
}

/**
 * "Today" in India (UTC+5:30), as YYYY-MM-DD — a fixed offset rather than
 * trusting the server machine's own OS timezone, so this stays correct
 * wherever the server is actually hosted (cloud VMs commonly default to
 * UTC). See DOCUMENTATION.md for the same reasoning applied to place_id
 * timezone handling.
 */
function getTodayIst(): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export interface TodayCalendarOverrides {
  holiday?: RangedInput<HolidayType>;
  event?: RangedInput<EventType>;
}

interface CacheEntry {
  value: TodayCalendarOverrides;
  expiresAt: number;
}

// Calendar data (festivals/events) changes only when the team manually
// updates it — typically once every few days at most. A 24-hour cache is
// safe and eliminates 100-200ms of DB queries. All requests in a calendar
// day reuse the same cached result. Keyed by (date, city, placeId) since
// the result can differ per POI, not just per city.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const cache = new Map<string, CacheEntry>();

// POI-specific event override cache: 24 hours. Same reasoning — overrides
// are manually curated and rarely change. Keyed by (place_id, event_id).
interface PoiOverrideCacheEntry {
  data: PoiEventOverride[];
  expiresAt: number;
}
const overrideCache = new Map<string, PoiOverrideCacheEntry>();
const OVERRIDE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// The list of cities we have ANY calendar data for changes only when someone
// edits calendarEvents.ts and re-seeds — essentially never during a
// server's lifetime. Caching it means matchCityFromAddress does zero DB work
// on the common path (cache hit), instead of a distinct() query on every
// single request regardless of whether the final answer was already cached.
const KNOWN_CITIES_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let knownCitiesCache: { value: string[]; expiresAt: number } | null = null;

async function getKnownCities(): Promise<string[]> {
  if (knownCitiesCache && knownCitiesCache.expiresAt > Date.now()) {
    return knownCitiesCache.value;
  }
  const collection = await getCalendarCollection();
  const value = (await collection.distinct("city", { city: { $ne: null } })) as string[];
  knownCitiesCache = { value, expiresAt: Date.now() + KNOWN_CITIES_CACHE_TTL_MS };
  return value;
}

/**
 * Finds which of our known calendar cities (if any) `text` mentions.
 * Deliberately a substring match against a small, known list rather than a
 * general address parser or exact-equality check — this now normally
 * receives the caller's own clean `city` value (e.g. "Amritsar"), but still
 * has to tolerate minor real-world variance (extra whitespace, a trailing
 * state name someone appends anyway) without a hard mismatch, and remains
 * usable as a fallback against a messier scraped address on the rare path
 * that still needs one. We only need to recognize the handful of cities we
 * actually have calendar data for, not solve general geocoding.
 */
async function matchKnownCity(text: string | null | undefined): Promise<string | null> {
  if (!text) return null;
  const knownCities = await getKnownCities();
  const lowerText = text.toLowerCase();
  return knownCities.find((city) => lowerText.includes(city.toLowerCase())) ?? null;
}

/**
 * What the calling team would otherwise have had to send as `holiday`/`event`
 * today, looked up from our own calendar instead. Caller-supplied values
 * always take priority over this — see mdCategoryEngine.ts and the route
 * files that call this — this only fills in what's actually missing.
 *
 * Three-tier fallback, most specific wins:
 * 1. A POI-specific override for today's event, if `placeId` is given and
 *    one exists (`poi_event_overrides`) — e.g. Golden Temple's own number
 *    for Guru Nanak Jayanti, not the generic Amritsar-wide one.
 * 2. Otherwise, the city-specific calendar entry for `cityHint`.
 * 3. Otherwise, the nationwide calendar entry for today, if any.
 *
 * `cityHint` is normally the caller's own required `city` field now (see
 * validation.ts) — authoritative, not guessed. Still accepts a messier
 * scraped address on any path that doesn't have a caller-supplied city
 * (e.g. /api/crowd/estimate never scrapes at all), since the substring match
 * behaves the same either way.
 *
 * Never throws: if MongoDB isn't configured or the query fails, this logs
 * and returns {} (no override), so a DB hiccup degrades to "caller must
 * supply holiday/event themselves" rather than breaking every request.
 */
export async function getTodayCalendarOverrides(
  cityHint?: string | null,
  placeId?: string | null
): Promise<TodayCalendarOverrides> {
  const today = getTodayIst();

  try {
    const city = await matchKnownCity(cityHint);
    const cacheKey = `${today}:${city ?? "nationwide"}:${placeId ?? "none"}`;

    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const collection = await getCalendarCollection();
    const docs = await collection
      .find({
        start_date: { $lte: today },
        end_date: { $gte: today },
        $or: [{ city: null }, ...(city ? [{ city }] : [])],
      })
      .toArray();

    // City-specific entries take priority over nationwide ones for the same
    // date — sort so they're considered first below.
    docs.sort((a, b) => (a.city === null ? 1 : 0) - (b.city === null ? 1 : 0));

    const winningHolidayDoc = docs.find((d) => d.kind === "holiday" && d.holiday);
    const winningEventDoc = docs.find((d) => d.kind === "event" && d.event);

    let holiday = winningHolidayDoc?.holiday;
    let event = winningEventDoc?.event;

    const eventIds = [winningHolidayDoc?.event_id, winningEventDoc?.event_id].filter(
      (id): id is string => Boolean(id)
    );

    if (placeId && eventIds.length > 0) {
      // Tier 1: Check override cache (24h TTL)
      const overrideCacheKey = `${placeId}:${eventIds.join(",")}`;
      const cachedOverrides = overrideCache.get(overrideCacheKey);
      let overrides: PoiEventOverride[] = [];

      if (cachedOverrides && cachedOverrides.expiresAt > Date.now()) {
        // Cache hit
        overrides = cachedOverrides.data;
      } else {
        // Cache miss: query DB
        const poiCollection = await getPoiOverridesCollection();
        overrides = await poiCollection.find({ place_id: placeId, event_id: { $in: eventIds } }).toArray();
        // Store in cache
        overrideCache.set(overrideCacheKey, { data: overrides, expiresAt: Date.now() + OVERRIDE_CACHE_TTL_MS });
      }

      const overrideByEventId = new Map(overrides.map((o) => [o.event_id, o]));

      const holidayOverride = winningHolidayDoc?.event_id
        ? overrideByEventId.get(winningHolidayDoc.event_id)
        : undefined;
      if (holidayOverride?.holiday) holiday = holidayOverride.holiday;

      const eventOverride = winningEventDoc?.event_id
        ? overrideByEventId.get(winningEventDoc.event_id)
        : undefined;
      if (eventOverride?.event) event = eventOverride.event;
    }

    const value: TodayCalendarOverrides = {};
    if (holiday) value.holiday = holiday;
    if (event) value.event = event;

    cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (err) {
    console.error("[calendarRepository] Failed to look up today's calendar overrides:", err);
    return {};
  }
}
