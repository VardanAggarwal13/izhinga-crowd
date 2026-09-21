import { CalendarDoc } from "../db/calendarRepository";

/**
 * Seed data for the `calendar_events` MongoDB collection, loaded via
 * `npm run seed:calendar` (src/db/seedCalendar.ts). The DB is the actual
 * runtime source of truth (see calendarRepository.ts); this file exists so
 * the mapping itself is reviewable/version-controlled, not read directly by
 * the running app.
 *
 * `city: null` = nationwide (applies to every POI). A specific city name =
 * this entry's real crowd impact is concentrated there.
 *
 * `kind: "holiday"` vs `kind: "event"` — these drive two DIFFERENT formula
 * multipliers (D_holiday vs D_event, see DOCUMENTATION.md §3/§15), so this
 * isn't just a label:
 * - `holiday`: public holidays and religious festivals (Diwali, Durga Puja,
 *   Eid, Republic Day, temple melas tied to an auspicious date, etc.).
 * - `event`: secular happenings — trade fairs, marathons, book/film/arts
 *   festivals, tourism-board-organized festivals, conventions. Genuinely
 *   different from a religious/civic holiday even when both draw big
 *   crowds. A POI can have BOTH active on the same day (e.g. a trade fair
 *   during Diwali week) — they're independent multipliers, not a single
 *   "pick one" field, so this split is also more expressive, not just more
 *   correct in name.
 * Both use the same `city`/date-range/event_id mechanics either way.
 *
 * `event_id` is intentionally YEAR-STABLE (e.g. "AMR_GURPURAB", not
 * "AMR_GURPURAB_2026") — poi_event_overrides.ts references it, and keeping
 * it stable means next year's reseed only has to update dates here, not
 * touch every POI override too.
 *
 * `start_date`/`end_date` (same day for a single-day event) rather than one
 * `date` — many real festivals/seasons genuinely span a range (Kanwar Yatra
 * runs the whole Shravan month; a hill station's "summer season" spans
 * months); forcing those into one arbitrary day would misrepresent them.
 *
 * === TRANSLATING SOURCE DATA INTO THIS SCHEMA — READ BEFORE EDITING ===
 * Much of this was compiled from a large batch of city/event data supplied
 * as a ChatGPT-drafted JSON using ITS OWN multiplier scale (1.2x-5.0x) —
 * DIFFERENT from and not directly compatible with this project's actual
 * documented multiplier ranges (Livecrowd.md: major_festival 2.0x-3.0x,
 * extreme_event 3.0x-5.0x, event city_wide 2.0x-4.0x). Every number below is
 * a manual translation of that source's relative severity (its
 * "level"/"score" fields) into our real type+intensity model — NOT a
 * copy-paste of its raw multiplier. Rough translation table used throughout
 * (source score → our type/intensity):
 *   95-100 → extreme_event, intensity 0.85-1.0  (or event city_wide 0.6-0.8)
 *   85-94  → extreme_event, intensity 0.4-0.7   (or event city_wide 0.4-0.6)
 *   75-84  → major_festival, intensity 0.7-1.0  (or event city_wide 0.3-0.5)
 *   65-74  → major_festival, intensity 0.3-0.6  (or event city_wide 0.2-0.4)
 *   55-64  → major_festival, intensity 0.1-0.3  (or event city_wide 0.1-0.2)
 * The source data did not distinguish holiday vs event at all (everything
 * was one flat "crowd_impact" field) — the holiday/event split below, and
 * which of the two scales a given entry maps onto, is a judgment call made
 * while building this file, not something present in the source.
 *
 * DATES: the source rarely gave explicit dates (most are "variable" —
 * lunar-calendar-based, or "seasonal" — spanning months). Every such date
 * below is MY OWN best-effort estimate from general knowledge, marked
 * "(estimated)" in the name, not sourced from the batch itself. Verify
 * before relying on any of these close to the actual date, especially the
 * ones with no strong basis (city-specific cultural festivals with no fixed
 * civil calendar anchor).
 *
 * DELIBERATELY EXCLUDED — events in the source batches that are NOT annual,
 * so seeding a 2026 date for them would fabricate a crowd spike that never
 * happens that year:
 * - "Kumbh Mela" (Haridwar, Prayagraj, Nashik/Simhastha, Ujjain/Simhastha) —
 *   rotates between these 4 on a ~12-year cycle with a half-cycle Ardh Kumbh.
 *   Prayagraj hosted a Maha Kumbh in Jan-Feb 2025, Haridwar's last was 2021,
 *   Nashik's 2015, Ujjain's 2016. None recurs in 2026.
 * - "Kalachakra Teaching" (Bodh Gaya) — scheduled irregularly whenever a
 *   qualified teacher holds one (historically the Dalai Lama), sometimes
 *   years apart, not always at Bodh Gaya. No confirmed 2026 occurrence.
 * - "Amavasya Pilgrimage Days" (Rameswaram) — every new-moon day (~12x/year)
 *   is considered auspicious there; this is a recurring monthly pattern, not
 *   a once-a-year date, so it doesn't fit this "annual event" model honestly.
 * - Kochi-Muziris Biennale is held once every TWO years, not annually — the
 *   entry below models the specific edition that opened Dec 2025 and runs
 *   into early 2026, not a fresh 2026 edition.
 * - "Auto Expo" (Delhi) — biennial (odd years — 2023, 2025, 2027...), so not
 *   included for 2026 for the same reason as the items above. Not in the
 *   original source batches either; mentioned here only in case someone is
 *   tempted to add it from general knowledge later.
 *
 * This covers 2026 only. Re-run the seed script with next year's dates
 * before this goes stale — it does not compute anything automatically.
 */
export const CALENDAR_EVENTS_2026: CalendarDoc[] = [
  // =========================================================================
  // NATIONWIDE (gazetted national holidays — apply to every city)
  // =========================================================================
  { start_date: "2026-01-01", end_date: "2026-01-01", name: "New Year's Day", kind: "holiday", city: null, event_id: "NAT_NEW_YEAR", holiday: { type: "long_weekend" } },
  { start_date: "2026-01-23", end_date: "2026-01-23", name: "Republic Day weekend", kind: "holiday", city: null, event_id: "NAT_REPUBLIC_DAY_WKND", holiday: { type: "long_weekend" } },
  { start_date: "2026-01-26", end_date: "2026-01-26", name: "Republic Day", kind: "holiday", city: null, event_id: "NAT_REPUBLIC_DAY", holiday: { type: "long_weekend" } },
  { start_date: "2026-01-14", end_date: "2026-01-14", name: "Makar Sankranti", kind: "holiday", city: null, event_id: "NAT_MAKAR_SANKRANTI", holiday: { type: "major_festival", intensity: 0.4 } },
  { start_date: "2026-01-23", end_date: "2026-01-23", name: "Basant Panchami / Saraswati Puja (estimated)", kind: "holiday", city: null, event_id: "NAT_BASANT_PANCHAMI", holiday: { type: "major_festival", intensity: 0.3 } },
  { start_date: "2026-03-19", end_date: "2026-03-27", name: "Chaitra Navratri (estimated)", kind: "holiday", city: null, event_id: "NAT_CHAITRA_NAVRATRI", holiday: { type: "major_festival", intensity: 0.3 } },
  { start_date: "2026-03-20", end_date: "2026-03-20", name: "Eid-ul-Fitr (estimated)", kind: "holiday", city: null, event_id: "NAT_EID_FITR", holiday: { type: "extreme_event", intensity: 0.6 } },
  { start_date: "2026-04-01", end_date: "2026-04-01", name: "Hanuman Jayanti (estimated, Chaitra Purnima)", kind: "holiday", city: null, event_id: "NAT_HANUMAN_JAYANTI", holiday: { type: "major_festival", intensity: 0.3 } },
  { start_date: "2026-04-20", end_date: "2026-04-20", name: "Akshaya Tritiya (estimated — gold/jewellery shopping surge)", kind: "holiday", city: null, event_id: "NAT_AKSHAYA_TRITIYA", holiday: { type: "major_festival", intensity: 0.3 } },
  { start_date: "2026-04-03", end_date: "2026-04-03", name: "Mahavir Jayanti", kind: "holiday", city: null, event_id: "NAT_MAHAVIR_JAYANTI", holiday: { type: "major_festival", intensity: 0.3 } },
  { start_date: "2026-04-03", end_date: "2026-04-03", name: "Good Friday", kind: "holiday", city: null, event_id: "NAT_GOOD_FRIDAY", holiday: { type: "long_weekend" } },
  { start_date: "2026-04-14", end_date: "2026-04-14", name: "Dr. Ambedkar Jayanti", kind: "holiday", city: null, event_id: "NAT_AMBEDKAR_JAYANTI", holiday: { type: "long_weekend" } },
  { start_date: "2026-05-01", end_date: "2026-05-01", name: "Buddha Purnima", kind: "holiday", city: null, event_id: "NAT_BUDDHA_PURNIMA", holiday: { type: "major_festival", intensity: 0.4 } },
  { start_date: "2026-05-27", end_date: "2026-05-27", name: "Eid-ul-Adha / Bakrid (estimated)", kind: "holiday", city: null, event_id: "NAT_EID_ADHA", holiday: { type: "extreme_event", intensity: 0.6 } },
  { start_date: "2026-06-17", end_date: "2026-06-17", name: "Muharram (estimated)", kind: "holiday", city: null, event_id: "NAT_MUHARRAM", holiday: { type: "major_festival", intensity: 0.4 } },
  { start_date: "2026-07-29", end_date: "2026-07-29", name: "Guru Purnima (estimated, Ashadh Purnima)", kind: "holiday", city: null, event_id: "NAT_GURU_PURNIMA", holiday: { type: "major_festival", intensity: 0.3 } },
  { start_date: "2026-08-15", end_date: "2026-08-15", name: "Independence Day", kind: "holiday", city: null, event_id: "NAT_INDEPENDENCE_DAY", holiday: { type: "long_weekend" } },
  { start_date: "2026-08-28", end_date: "2026-08-28", name: "Raksha Bandhan", kind: "holiday", city: null, event_id: "NAT_RAKSHA_BANDHAN", holiday: { type: "major_festival", intensity: 0.4 } },
  { start_date: "2026-09-25", end_date: "2026-09-25", name: "Milad-un-Nabi (estimated)", kind: "holiday", city: null, event_id: "NAT_MILAD_UN_NABI", holiday: { type: "major_festival", intensity: 0.3 } },
  { start_date: "2026-10-02", end_date: "2026-10-02", name: "Gandhi Jayanti", kind: "holiday", city: null, event_id: "NAT_GANDHI_JAYANTI", holiday: { type: "long_weekend" } },
  { start_date: "2026-10-20", end_date: "2026-10-20", name: "Dussehra / Vijayadashami", kind: "holiday", city: null, event_id: "NAT_DUSSEHRA", holiday: { type: "major_festival", intensity: 0.5 } },
  { start_date: "2026-11-08", end_date: "2026-11-08", name: "Diwali (estimated)", kind: "holiday", city: null, event_id: "NAT_DIWALI", holiday: { type: "extreme_event", intensity: 0.9 } },
  { start_date: "2026-11-06", end_date: "2026-11-06", name: "Dhanteras (estimated — major gold/utensil/shops surge)", kind: "holiday", city: null, event_id: "NAT_DHANTERAS", holiday: { type: "major_festival", intensity: 0.6 } },
  { start_date: "2026-11-09", end_date: "2026-11-09", name: "Govardhan Puja / Diwali holiday period", kind: "holiday", city: null, event_id: "NAT_GOVARDHAN_PUJA", holiday: { type: "major_festival", intensity: 0.5 } },
  { start_date: "2026-11-10", end_date: "2026-11-10", name: "Bhai Dooj (estimated)", kind: "holiday", city: null, event_id: "NAT_BHAI_DOOJ", holiday: { type: "major_festival", intensity: 0.2 } },
  { start_date: "2026-12-25", end_date: "2026-12-25", name: "Christmas", kind: "holiday", city: null, event_id: "NAT_CHRISTMAS", holiday: { type: "major_festival", intensity: 0.6 } },
  { start_date: "2026-12-31", end_date: "2026-12-31", name: "New Year's Eve", kind: "holiday", city: null, event_id: "NAT_NEW_YEAR_EVE", holiday: { type: "long_weekend" } },

  // --- Nationwide secular events ---
  { start_date: "2026-11-14", end_date: "2026-11-27", name: "India International Trade Fair, Pragati Maidan (estimated)", kind: "event", city: "Delhi", event_id: "DEL_IITF", event: { type: "city_wide", intensity: 0.6 } },
  { start_date: "2026-10-18", end_date: "2026-10-18", name: "Delhi Half Marathon (estimated)", kind: "event", city: "Delhi", event_id: "DEL_HALF_MARATHON", event: { type: "city_wide", intensity: 0.35 } },

  // =========================================================================
  // NORTH INDIA
  // =========================================================================

  // --- Amritsar / Punjab ---
  { start_date: "2026-01-13", end_date: "2026-01-13", name: "Lohri", kind: "holiday", city: "Amritsar", event_id: "AMR_LOHRI", holiday: { type: "extreme_event", intensity: 0.6 } },
  { start_date: "2026-10-28", end_date: "2026-10-28", name: "Karva Chauth (estimated)", kind: "holiday", city: "Amritsar", event_id: "AMR_KARVA_CHAUTH", holiday: { type: "major_festival", intensity: 0.5 } },
  { start_date: "2026-02-15", end_date: "2026-02-15", name: "Maha Shivratri", kind: "holiday", city: "Amritsar", event_id: "AMR_SHIVRATRI", holiday: { type: "major_festival", intensity: 0.5 } },
  { start_date: "2026-03-04", end_date: "2026-03-04", name: "Holi", kind: "holiday", city: "Amritsar", event_id: "AMR_HOLI", holiday: { type: "extreme_event", intensity: 0.5 } },
  { start_date: "2026-03-26", end_date: "2026-03-26", name: "Ram Navami", kind: "holiday", city: "Amritsar", event_id: "AMR_RAM_NAVAMI", holiday: { type: "major_festival", intensity: 0.4 } },
  { start_date: "2026-04-14", end_date: "2026-04-14", name: "Baisakhi / Vaisakhi", kind: "holiday", city: "Amritsar", event_id: "AMR_BAISAKHI", holiday: { type: "extreme_event", intensity: 0.7 } },
  { start_date: "2026-10-11", end_date: "2026-10-19", name: "Navratri", kind: "holiday", city: "Amritsar", event_id: "AMR_NAVRATRI", holiday: { type: "major_festival", intensity: 0.4 } },
  { start_date: "2026-11-24", end_date: "2026-11-24", name: "Guru Nanak Jayanti", kind: "holiday", city: "Amritsar", event_id: "AMR_GURPURAB", holiday: { type: "extreme_event", intensity: 0.9 } },
  { start_date: "2026-11-20", end_date: "2026-11-20", name: "Ram Tirath Mela (estimated)", kind: "holiday", city: "Amritsar", event_id: "AMR_RAM_TIRATH_MELA", holiday: { type: "major_festival", intensity: 0.3 } },
  { start_date: "2026-12-03", end_date: "2026-12-07", name: "PITEX Trade Fair", kind: "event", city: "Amritsar", event_id: "AMR_PITEX", event: { type: "city_wide", intensity: 0.3 } },

  // --- Delhi ---
  { start_date: "2026-10-28", end_date: "2026-10-28", name: "Karva Chauth (estimated)", kind: "holiday", city: "Delhi", event_id: "DEL_KARVA_CHAUTH", holiday: { type: "major_festival", intensity: 0.5 } },
  { start_date: "2026-01-26", end_date: "2026-01-26", name: "Republic Day Parade (India Gate/Kartavya Path)", kind: "holiday", city: "Delhi", event_id: "DEL_REPUBLIC_DAY_PARADE", holiday: { type: "extreme_event", intensity: 0.6 } },
  { start_date: "2026-10-20", end_date: "2026-10-20", name: "Durga Puja (Delhi pandals)", kind: "holiday", city: "Delhi", event_id: "DEL_DURGA_PUJA", holiday: { type: "major_festival", intensity: 0.2 } },
  { start_date: "2026-11-08", end_date: "2026-11-08", name: "Diwali (Delhi markets/fireworks, estimated)", kind: "holiday", city: "Delhi", event_id: "DEL_DIWALI", holiday: { type: "extreme_event", intensity: 0.85 } },

  // --- Chandigarh (dates estimated, no source dates given) ---
  { start_date: "2026-11-14", end_date: "2026-11-16", name: "Chandigarh Carnival (estimated)", kind: "event", city: "Chandigarh", event_id: "CHD_CARNIVAL", event: { type: "city_wide", intensity: 0.2 } },
  { start_date: "2026-02-27", end_date: "2026-03-01", name: "Rose Festival (estimated)", kind: "event", city: "Chandigarh", event_id: "CHD_ROSE_FESTIVAL", event: { type: "city_wide", intensity: 0.5 } },

  // --- Jaipur ---
  { start_date: "2026-10-28", end_date: "2026-10-28", name: "Karva Chauth (estimated)", kind: "holiday", city: "Jaipur", event_id: "JAI_KARVA_CHAUTH", holiday: { type: "major_festival", intensity: 0.5 } },
  { start_date: "2026-01-22", end_date: "2026-01-26", name: "Jaipur Literature Festival (estimated dates)", kind: "event", city: "Jaipur", event_id: "JAI_LITERATURE_FESTIVAL", event: { type: "city_wide", intensity: 0.55 } },
  { start_date: "2026-01-14", end_date: "2026-01-14", name: "Jaipur Kite Festival", kind: "event", city: "Jaipur", event_id: "JAI_KITE_FESTIVAL", event: { type: "city_wide", intensity: 0.35 } },
  { start_date: "2026-03-21", end_date: "2026-03-21", name: "Gangaur Festival (estimated)", kind: "holiday", city: "Jaipur", event_id: "JAI_GANGAUR", holiday: { type: "major_festival", intensity: 0.7 } },
  { start_date: "2026-08-16", end_date: "2026-08-16", name: "Teej Festival (estimated)", kind: "holiday", city: "Jaipur", event_id: "JAI_TEEJ", holiday: { type: "major_festival", intensity: 0.6 } },
  { start_date: "2026-11-08", end_date: "2026-11-08", name: "Diwali (Jaipur — Johari/Bapu Bazaar)", kind: "holiday", city: "Jaipur", event_id: "JAI_DIWALI", holiday: { type: "extreme_event", intensity: 0.5 } },

  // --- Udaipur ---
  { start_date: "2026-12-21", end_date: "2026-12-30", name: "Shilpgram Festival (estimated)", kind: "event", city: "Udaipur", event_id: "UDA_SHILPGRAM", event: { type: "city_wide", intensity: 0.45 } },
  { start_date: "2026-02-06", end_date: "2026-02-08", name: "Udaipur World Music Festival (estimated)", kind: "event", city: "Udaipur", event_id: "UDA_WORLD_MUSIC", event: { type: "city_wide", intensity: 0.3 } },
  { start_date: "2026-02-15", end_date: "2026-02-15", name: "Maha Shivratri (Udaipur)", kind: "holiday", city: "Udaipur", event_id: "UDA_MAHASHIVRATRI", holiday: { type: "major_festival", intensity: 0.3 } },

  // --- Jodhpur ---
  { start_date: "2026-10-24", end_date: "2026-10-27", name: "Rajasthan International Folk Festival (estimated)", kind: "event", city: "Jodhpur", event_id: "JOD_RIFF", event: { type: "city_wide", intensity: 0.55 } },
  { start_date: "2026-10-24", end_date: "2026-10-26", name: "Marwar Festival (estimated)", kind: "event", city: "Jodhpur", event_id: "JOD_MARWAR_FESTIVAL", event: { type: "city_wide", intensity: 0.45 } },
  { start_date: "2026-03-04", end_date: "2026-03-04", name: "Holi (Jodhpur)", kind: "holiday", city: "Jodhpur", event_id: "JOD_HOLI", holiday: { type: "major_festival", intensity: 0.4 } },

  // --- Jaisalmer ---
  { start_date: "2026-02-01", end_date: "2026-02-03", name: "Jaisalmer Desert Festival (estimated)", kind: "event", city: "Jaisalmer", event_id: "JSM_DESERT_FESTIVAL", event: { type: "city_wide", intensity: 0.4 } },
  { start_date: "2026-12-31", end_date: "2026-12-31", name: "New Year Desert Celebration", kind: "holiday", city: "Jaisalmer", event_id: "JSM_NEW_YEAR", holiday: { type: "extreme_event", intensity: 0.4 } },

  // --- Pushkar ---
  { start_date: "2026-11-19", end_date: "2026-11-24", name: "Pushkar Camel Fair (estimated)", kind: "holiday", city: "Pushkar", event_id: "PUS_CAMEL_FAIR", holiday: { type: "extreme_event", intensity: 0.95 } },
  { start_date: "2026-03-04", end_date: "2026-03-04", name: "Holi (Pushkar)", kind: "holiday", city: "Pushkar", event_id: "PUS_HOLI", holiday: { type: "major_festival", intensity: 0.4 } },

  // --- Agra ---
  { start_date: "2026-02-18", end_date: "2026-02-27", name: "Taj Mahotsav (estimated exact days)", kind: "event", city: "Agra", event_id: "AGR_TAJ_MAHOTSAV", event: { type: "city_wide", intensity: 0.5 } },
  { start_date: "2026-11-08", end_date: "2026-11-08", name: "Diwali (Agra)", kind: "holiday", city: "Agra", event_id: "AGR_DIWALI", holiday: { type: "major_festival", intensity: 0.4 } },

  // --- Varanasi ---
  { start_date: "2026-11-24", end_date: "2026-11-24", name: "Dev Deepawali (estimated)", kind: "holiday", city: "Varanasi", event_id: "VNS_DEV_DEEPAVALI", holiday: { type: "extreme_event", intensity: 0.95 } },
  { start_date: "2026-02-15", end_date: "2026-02-15", name: "Maha Shivratri (Varanasi)", kind: "holiday", city: "Varanasi", event_id: "VNS_MAHASHIVRATRI", holiday: { type: "extreme_event", intensity: 0.6 } },
  { start_date: "2026-10-01", end_date: "2026-12-31", name: "Festival Season Ganga Aarti Rush (estimated season)", kind: "holiday", city: "Varanasi", event_id: "VNS_GANGA_AARTI_SEASON", holiday: { type: "major_festival", intensity: 0.7 } },

  // --- Ayodhya ---
  { start_date: "2026-03-26", end_date: "2026-03-26", name: "Ram Navami (Ayodhya)", kind: "holiday", city: "Ayodhya", event_id: "AYO_RAM_NAVAMI", holiday: { type: "extreme_event", intensity: 1.0 } },
  { start_date: "2026-11-06", end_date: "2026-11-06", name: "Ayodhya Deepotsav (estimated)", kind: "holiday", city: "Ayodhya", event_id: "AYO_DEEPOTSAV", holiday: { type: "extreme_event", intensity: 1.0 } },

  // --- Mathura ---
  { start_date: "2026-09-04", end_date: "2026-09-04", name: "Janmashtami", kind: "holiday", city: "Mathura", event_id: "MTH_JANMASHTAMI", holiday: { type: "extreme_event", intensity: 0.9 } },

  // --- Vrindavan (distinct town from Mathura — Banke Bihari Temple is here) ---
  { start_date: "2026-02-25", end_date: "2026-03-04", name: "Braj Holi / Lathmar Holi (estimated)", kind: "holiday", city: "Vrindavan", event_id: "VRN_BRAJ_HOLI", holiday: { type: "extreme_event", intensity: 0.85 } },
  { start_date: "2026-09-04", end_date: "2026-09-04", name: "Janmashtami (Vrindavan)", kind: "holiday", city: "Vrindavan", event_id: "VRN_JANMASHTAMI", holiday: { type: "extreme_event", intensity: 0.9 } },

  // --- Haridwar (Kumbh Mela excluded — not occurring in 2026, see header note) ---
  { start_date: "2026-07-14", end_date: "2026-08-09", name: "Kanwar Yatra (estimated Shravan month)", kind: "holiday", city: "Haridwar", event_id: "HAR_KANWAR_YATRA", holiday: { type: "extreme_event", intensity: 0.9 } },
  { start_date: "2026-06-14", end_date: "2026-06-14", name: "Ganga Dussehra (estimated)", kind: "holiday", city: "Haridwar", event_id: "HAR_GANGA_DUSSEHRA", holiday: { type: "major_festival", intensity: 0.7 } },

  // --- Rishikesh ---
  { start_date: "2026-06-21", end_date: "2026-06-21", name: "International Yoga Day", kind: "event", city: "Rishikesh", event_id: "RIS_YOGA_DAY", event: { type: "city_wide", intensity: 0.3 } },
  { start_date: "2026-09-15", end_date: "2026-12-31", name: "Adventure Tourism Season (estimated, partial year)", kind: "holiday", city: "Rishikesh", event_id: "RIS_ADVENTURE_SEASON", holiday: { type: "major_festival", intensity: 0.7 } },

  // --- Shimla ---
  { start_date: "2026-04-01", end_date: "2026-06-30", name: "Summer Tourism Season (estimated)", kind: "holiday", city: "Shimla", event_id: "SHI_SUMMER_TOURISM", holiday: { type: "extreme_event", intensity: 0.5 } },
  { start_date: "2026-05-08", end_date: "2026-05-10", name: "Shimla Summer Festival (estimated)", kind: "event", city: "Shimla", event_id: "SHI_SUMMER_FESTIVAL", event: { type: "city_wide", intensity: 0.4 } },

  // --- Manali ---
  { start_date: "2026-04-01", end_date: "2026-06-30", name: "Summer Tourist Season (estimated)", kind: "holiday", city: "Manali", event_id: "MAN_SUMMER_PEAK", holiday: { type: "extreme_event", intensity: 0.5 } },
  { start_date: "2026-12-01", end_date: "2026-12-31", name: "Winter Snow Tourism Season (estimated, partial year)", kind: "holiday", city: "Manali", event_id: "MAN_WINTER_SNOW_SEASON", holiday: { type: "extreme_event", intensity: 0.4 } },

  // --- Mussoorie ---
  { start_date: "2026-04-01", end_date: "2026-06-30", name: "Summer Tourism Season (estimated)", kind: "holiday", city: "Mussoorie", event_id: "MUS_SUMMER_PEAK", holiday: { type: "extreme_event", intensity: 0.5 } },
  { start_date: "2026-12-25", end_date: "2026-12-31", name: "Winterline Carnival (estimated)", kind: "event", city: "Mussoorie", event_id: "MUS_WINTERLINE_CARNIVAL", event: { type: "city_wide", intensity: 0.4 } },

  // --- Srinagar ---
  { start_date: "2026-04-01", end_date: "2026-04-15", name: "Tulip Festival (estimated)", kind: "event", city: "Srinagar", event_id: "SRI_TULIP_FESTIVAL", event: { type: "city_wide", intensity: 0.6 } },
  { start_date: "2026-06-29", end_date: "2026-08-09", name: "Amarnath Yatra (estimated)", kind: "holiday", city: "Srinagar", event_id: "SRI_AMARNATH_YATRA", holiday: { type: "extreme_event", intensity: 0.6 } },

  // --- Leh ---
  { start_date: "2026-06-24", end_date: "2026-06-25", name: "Hemis Festival (estimated)", kind: "holiday", city: "Leh", event_id: "LEH_HEMIS_FESTIVAL", holiday: { type: "major_festival", intensity: 0.7 } },
  { start_date: "2026-05-15", end_date: "2026-09-15", name: "Ladakh Tourism Season (estimated)", kind: "holiday", city: "Leh", event_id: "LEH_SUMMER_SEASON", holiday: { type: "extreme_event", intensity: 0.4 } },

  // --- Lucknow ---
  { start_date: "2026-10-28", end_date: "2026-10-28", name: "Karva Chauth (estimated)", kind: "holiday", city: "Lucknow", event_id: "LKO_KARVA_CHAUTH", holiday: { type: "major_festival", intensity: 0.5 } },
  { start_date: "2026-10-20", end_date: "2026-10-20", name: "Dussehra (Lucknow)", kind: "holiday", city: "Lucknow", event_id: "LKO_DUSSEHRA", holiday: { type: "major_festival", intensity: 0.6 } },
  { start_date: "2026-12-24", end_date: "2026-12-31", name: "Christmas and New Year Celebration", kind: "holiday", city: "Lucknow", event_id: "LKO_CHRISTMAS_NEW_YEAR", holiday: { type: "major_festival", intensity: 0.4 } },

  // --- Prayagraj (Kumbh Mela excluded — not occurring in 2026, see header note) ---
  { start_date: "2026-01-14", end_date: "2026-02-12", name: "Magh Mela (estimated)", kind: "holiday", city: "Prayagraj", event_id: "PRA_MAGH_MELA", holiday: { type: "extreme_event", intensity: 0.4 } },

  // =========================================================================
  // WEST INDIA
  // =========================================================================

  // --- Mumbai ---
  { start_date: "2026-03-19", end_date: "2026-03-19", name: "Gudi Padwa (Marathi New Year, estimated)", kind: "holiday", city: "Mumbai", event_id: "MUM_GUDI_PADWA", holiday: { type: "major_festival", intensity: 0.5 } },
  { start_date: "2026-09-14", end_date: "2026-09-14", name: "Ganesh Chaturthi", kind: "holiday", city: "Mumbai", event_id: "MUM_GANESH_CHATURTHI", holiday: { type: "extreme_event", intensity: 0.9 } },
  { start_date: "2026-09-24", end_date: "2026-09-24", name: "Ganesh Visarjan (estimated, Anant Chaturdashi)", kind: "holiday", city: "Mumbai", event_id: "MUM_GANESH_VISARJAN", holiday: { type: "extreme_event", intensity: 1.0 } },
  { start_date: "2026-02-07", end_date: "2026-02-15", name: "Kala Ghoda Arts Festival (estimated)", kind: "event", city: "Mumbai", event_id: "MUM_KALA_GHODA", event: { type: "city_wide", intensity: 0.45 } },
  { start_date: "2026-01-18", end_date: "2026-01-18", name: "Mumbai Marathon (estimated)", kind: "event", city: "Mumbai", event_id: "MUM_MARATHON", event: { type: "city_wide", intensity: 0.5 } },
  { start_date: "2026-10-11", end_date: "2026-10-19", name: "Navratri Garba Festival", kind: "holiday", city: "Mumbai", event_id: "MUM_NAVRATRI", holiday: { type: "major_festival", intensity: 0.9 } },

  // --- Goa ---
  { start_date: "2026-02-14", end_date: "2026-02-17", name: "Goa Carnival (estimated, pre-Lent)", kind: "holiday", city: "Goa", event_id: "GOA_CARNIVAL", holiday: { type: "extreme_event", intensity: 0.5 } },
  { start_date: "2026-12-28", end_date: "2026-12-30", name: "Sunburn Festival (estimated)", kind: "event", city: "Goa", event_id: "GOA_SUNBURN", event: { type: "city_wide", intensity: 0.7 } },
  { start_date: "2026-12-24", end_date: "2026-12-31", name: "Christmas and New Year Celebration (Goa beach parties)", kind: "holiday", city: "Goa", event_id: "GOA_CHRISTMAS_NEW_YEAR", holiday: { type: "extreme_event", intensity: 1.0 } },
  { start_date: "2026-03-04", end_date: "2026-03-14", name: "Shigmo Festival (estimated)", kind: "holiday", city: "Goa", event_id: "GOA_SHIGMO", holiday: { type: "major_festival", intensity: 0.7 } },
  { start_date: "2026-06-24", end_date: "2026-06-24", name: "Sao Joao Festival", kind: "holiday", city: "Goa", event_id: "GOA_SAO_JOAO", holiday: { type: "major_festival", intensity: 0.4 } },

  // --- Pune ---
  { start_date: "2026-03-19", end_date: "2026-03-19", name: "Gudi Padwa (Marathi New Year, estimated)", kind: "holiday", city: "Pune", event_id: "PUN_GUDI_PADWA", holiday: { type: "major_festival", intensity: 0.5 } },
  { start_date: "2026-09-14", end_date: "2026-09-14", name: "Ganeshotsav", kind: "holiday", city: "Pune", event_id: "PUN_GANESHOTSAV", holiday: { type: "extreme_event", intensity: 1.0 } },
  { start_date: "2026-12-11", end_date: "2026-12-14", name: "Sawai Gandharva Bhimsen Mahotsav (estimated)", kind: "event", city: "Pune", event_id: "PUN_SAWAI_GANDHARVA", event: { type: "city_wide", intensity: 0.3 } },
  { start_date: "2026-01-08", end_date: "2026-01-15", name: "Pune International Film Festival (estimated)", kind: "event", city: "Pune", event_id: "PUN_FILM_FESTIVAL", event: { type: "city_wide", intensity: 0.15 } },

  // --- Ahmedabad ---
  { start_date: "2026-11-09", end_date: "2026-11-09", name: "Bestu Varas (Gujarati New Year, estimated)", kind: "holiday", city: "Ahmedabad", event_id: "AMD_BESTU_VARAS", holiday: { type: "major_festival", intensity: 0.5 } },
  { start_date: "2026-10-11", end_date: "2026-10-19", name: "Navratri Garba Festival", kind: "holiday", city: "Ahmedabad", event_id: "AMD_NAVRATRI", holiday: { type: "extreme_event", intensity: 1.0 } },
  { start_date: "2026-01-14", end_date: "2026-01-14", name: "International Kite Festival (Uttarayan)", kind: "event", city: "Ahmedabad", event_id: "AMD_UTTARAYAN", event: { type: "city_wide", intensity: 0.5 } },
  { start_date: "2026-07-16", end_date: "2026-07-16", name: "Jagannath Rath Yatra (estimated)", kind: "holiday", city: "Ahmedabad", event_id: "AMD_RATH_YATRA", holiday: { type: "extreme_event", intensity: 0.8 } },

  // --- Vadodara ---
  { start_date: "2026-11-09", end_date: "2026-11-09", name: "Bestu Varas (Gujarati New Year, estimated)", kind: "holiday", city: "Vadodara", event_id: "VAD_BESTU_VARAS", holiday: { type: "major_festival", intensity: 0.4 } },
  { start_date: "2026-10-11", end_date: "2026-10-19", name: "Navratri Garba Festival", kind: "holiday", city: "Vadodara", event_id: "VAD_NAVRATRI", holiday: { type: "extreme_event", intensity: 0.5 } },
  { start_date: "2026-11-08", end_date: "2026-11-08", name: "Diwali (Vadodara)", kind: "holiday", city: "Vadodara", event_id: "VAD_DIWALI", holiday: { type: "major_festival", intensity: 0.4 } },

  // --- Surat ---
  { start_date: "2026-11-09", end_date: "2026-11-09", name: "Bestu Varas (Gujarati New Year, estimated)", kind: "holiday", city: "Surat", event_id: "SUR_BESTU_VARAS", holiday: { type: "major_festival", intensity: 0.4 } },
  { start_date: "2026-10-11", end_date: "2026-10-19", name: "Navratri Celebration", kind: "holiday", city: "Surat", event_id: "SUR_NAVRATRI", holiday: { type: "major_festival", intensity: 0.9 } },
  { start_date: "2026-01-15", end_date: "2026-01-20", name: "Diamond and Jewellery Exhibitions (estimated)", kind: "event", city: "Surat", event_id: "SUR_DIAMOND_EXHIBITION", event: { type: "city_wide", intensity: 0.15 } },

  // --- Nashik (Simhastha Kumbh excluded — not occurring in 2026, see header note) ---
  { start_date: "2026-02-06", end_date: "2026-02-08", name: "Sula Fest (estimated)", kind: "event", city: "Nashik", event_id: "NAS_SULA_FEST", event: { type: "city_wide", intensity: 0.45 } },

  // --- Rajkot ---
  { start_date: "2026-11-09", end_date: "2026-11-09", name: "Bestu Varas (Gujarati New Year, estimated)", kind: "holiday", city: "Rajkot", event_id: "RAJ_BESTU_VARAS", holiday: { type: "major_festival", intensity: 0.4 } },
  { start_date: "2026-10-11", end_date: "2026-10-19", name: "Navratri Festival", kind: "holiday", city: "Rajkot", event_id: "RAJ_NAVRATRI", holiday: { type: "major_festival", intensity: 0.7 } },
  { start_date: "2026-09-04", end_date: "2026-09-04", name: "Janmashtami (Rajkot)", kind: "holiday", city: "Rajkot", event_id: "RAJ_JANMASHTAMI", holiday: { type: "major_festival", intensity: 0.4 } },

  // --- Kutch (Bhuj) ---
  { start_date: "2026-11-01", end_date: "2026-12-31", name: "Rann Utsav (estimated, partial season within 2026)", kind: "event", city: "Kutch", event_id: "KUTCH_RANN_UTSAV", event: { type: "city_wide", intensity: 0.5 } },
  { start_date: "2026-02-01", end_date: "2026-02-03", name: "Kutch Festival (estimated)", kind: "event", city: "Kutch", event_id: "KUTCH_FESTIVAL", event: { type: "city_wide", intensity: 0.35 } },

  // =========================================================================
  // SOUTH INDIA
  // =========================================================================

  // --- Chennai ---
  { start_date: "2026-01-14", end_date: "2026-01-17", name: "Pongal", kind: "holiday", city: "Chennai", event_id: "CHN_PONGAL", holiday: { type: "extreme_event", intensity: 0.75 } },
  { start_date: "2026-12-16", end_date: "2026-12-31", name: "Margazhi Music and Dance Festival (estimated, season continues into Jan)", kind: "event", city: "Chennai", event_id: "CHE_MARGAZHI", event: { type: "city_wide", intensity: 0.4 } },
  { start_date: "2026-01-09", end_date: "2026-01-19", name: "Chennai Book Fair (estimated)", kind: "event", city: "Chennai", event_id: "CHE_BOOK_FAIR", event: { type: "city_wide", intensity: 0.3 } },

  // --- Kochi ---
  { start_date: "2026-04-14", end_date: "2026-04-14", name: "Vishu (Malayalam New Year, estimated)", kind: "holiday", city: "Kochi", event_id: "KOC_VISHU", holiday: { type: "major_festival", intensity: 0.4 } },
  { start_date: "2026-08-26", end_date: "2026-08-26", name: "Onam (estimated)", kind: "holiday", city: "Kochi", event_id: "KOC_ONAM", holiday: { type: "extreme_event", intensity: 0.8 } },
  // Biennial, not annual (see header note) — this models the edition that opened Dec 2025 continuing into 2026, not a new 2026 edition.
  { start_date: "2026-01-01", end_date: "2026-04-30", name: "Kochi-Muziris Biennale (5th edition continuing from Dec 2025, estimated end)", kind: "event", city: "Kochi", event_id: "KOC_BIENNALE", event: { type: "city_wide", intensity: 0.5 } },
  { start_date: "2026-12-20", end_date: "2026-12-31", name: "Cochin Carnival", kind: "event", city: "Kochi", event_id: "KOC_CARNIVAL", event: { type: "city_wide", intensity: 0.5 } },

  // --- Bengaluru ---
  { start_date: "2026-03-19", end_date: "2026-03-19", name: "Ugadi (Kannada New Year, estimated)", kind: "holiday", city: "Bengaluru", event_id: "BLR_UGADI", holiday: { type: "major_festival", intensity: 0.5 } },
  { start_date: "2026-04-02", end_date: "2026-04-02", name: "Bengaluru Karaga (estimated)", kind: "holiday", city: "Bengaluru", event_id: "BLR_KARAGA", holiday: { type: "major_festival", intensity: 0.7 } },
  { start_date: "2026-01-23", end_date: "2026-01-27", name: "Lalbagh Flower Show (estimated, Republic Day edition)", kind: "event", city: "Bengaluru", event_id: "BLR_LALBAGH_FLOWER_SHOW", event: { type: "city_wide", intensity: 0.4 } },
  { start_date: "2026-12-31", end_date: "2026-12-31", name: "New Year Celebration (MG Road/Brigade Road)", kind: "holiday", city: "Bengaluru", event_id: "BLR_NEW_YEAR", holiday: { type: "extreme_event", intensity: 0.6 } },
  { start_date: "2026-12-05", end_date: "2026-12-06", name: "Comic Con Bengaluru (estimated)", kind: "event", city: "Bengaluru", event_id: "BLR_COMIC_CON", event: { type: "city_wide", intensity: 0.3 } },

  // --- Mysuru ---
  { start_date: "2026-10-11", end_date: "2026-10-20", name: "Mysuru Dasara", kind: "holiday", city: "Mysuru", event_id: "MYS_DASARA", holiday: { type: "extreme_event", intensity: 1.0 } },
  { start_date: "2026-10-15", end_date: "2026-10-20", name: "Mysuru Flower Show (estimated, during Dasara)", kind: "event", city: "Mysuru", event_id: "MYS_FLOWER_SHOW", event: { type: "city_wide", intensity: 0.15 } },

  // --- Hyderabad ---
  { start_date: "2026-03-19", end_date: "2026-03-19", name: "Ugadi (Telugu New Year, estimated)", kind: "holiday", city: "Hyderabad", event_id: "HYD_UGADI", holiday: { type: "major_festival", intensity: 0.5 } },
  { start_date: "2026-09-24", end_date: "2026-09-24", name: "Ganesh Immersion (Hussain Sagar, estimated)", kind: "holiday", city: "Hyderabad", event_id: "HYD_GANESH_NIMAJJAN", holiday: { type: "extreme_event", intensity: 1.0 } },
  { start_date: "2026-07-12", end_date: "2026-08-02", name: "Bonalu Festival (estimated season)", kind: "holiday", city: "Hyderabad", event_id: "HYD_BONALU", holiday: { type: "extreme_event", intensity: 0.3 } },
  { start_date: "2026-02-18", end_date: "2026-03-19", name: "Ramzan Night Market (estimated, Ramadan month)", kind: "holiday", city: "Hyderabad", event_id: "HYD_RAMZAN_MARKET", holiday: { type: "major_festival", intensity: 0.7 } },

  // --- Thrissur ---
  { start_date: "2026-04-14", end_date: "2026-04-14", name: "Vishu (Malayalam New Year, estimated)", kind: "holiday", city: "Thrissur", event_id: "THR_VISHU", holiday: { type: "major_festival", intensity: 0.4 } },
  { start_date: "2026-04-27", end_date: "2026-04-27", name: "Thrissur Pooram (estimated)", kind: "holiday", city: "Thrissur", event_id: "THR_POORAM", holiday: { type: "extreme_event", intensity: 1.0 } },
  { start_date: "2026-08-26", end_date: "2026-08-26", name: "Onam (Thrissur)", kind: "holiday", city: "Thrissur", event_id: "THR_ONAM", holiday: { type: "extreme_event", intensity: 0.3 } },

  // --- Madurai ---
  { start_date: "2026-04-14", end_date: "2026-04-29", name: "Chithirai Festival (estimated)", kind: "holiday", city: "Madurai", event_id: "MAD_CHITHIRAI_FESTIVAL", holiday: { type: "extreme_event", intensity: 1.0 } },
  { start_date: "2026-01-15", end_date: "2026-01-17", name: "Jallikattu Festival", kind: "holiday", city: "Madurai", event_id: "MAD_JALLIKATTU", holiday: { type: "major_festival", intensity: 0.7 } },

  // --- Tirupati ---
  { start_date: "2026-10-02", end_date: "2026-10-10", name: "Tirupati Brahmotsavam (estimated)", kind: "holiday", city: "Tirupati", event_id: "TIR_BRAHMOTSAVAM", holiday: { type: "extreme_event", intensity: 1.0 } },
  { start_date: "2026-12-19", end_date: "2026-12-19", name: "Vaikunta Ekadashi (estimated)", kind: "holiday", city: "Tirupati", event_id: "TIR_VAIKUNTA_EKADASHI", holiday: { type: "extreme_event", intensity: 0.9 } },

  // --- Coimbatore ---
  { start_date: "2026-02-15", end_date: "2026-02-15", name: "Maha Shivratri (Isha Yoga Center)", kind: "holiday", city: "Coimbatore", event_id: "CBE_MAHA_SHIVRATRI", holiday: { type: "extreme_event", intensity: 0.5 } },
  { start_date: "2026-01-16", end_date: "2026-01-25", name: "Coimbatore Book Festival (estimated)", kind: "event", city: "Coimbatore", event_id: "CBE_BOOK_FAIR", event: { type: "city_wide", intensity: 0.1 } },

  // --- Ooty ---
  { start_date: "2026-05-15", end_date: "2026-05-20", name: "Ooty Summer Festival (estimated)", kind: "event", city: "Ooty", event_id: "OOTY_SUMMER_FESTIVAL", event: { type: "city_wide", intensity: 0.5 } },
  { start_date: "2026-05-15", end_date: "2026-05-20", name: "Ooty Flower Show (estimated, same window)", kind: "event", city: "Ooty", event_id: "OOTY_FLOWER_SHOW", event: { type: "city_wide", intensity: 0.4 } },

  // --- Vijayawada ---
  { start_date: "2026-10-11", end_date: "2026-10-20", name: "Vijayawada Dasara Festival (Kanaka Durga Temple)", kind: "holiday", city: "Vijayawada", event_id: "VIJ_DUSSEHRA", holiday: { type: "extreme_event", intensity: 0.6 } },

  // --- Rameswaram (Amavasya Pilgrimage Days excluded — not an annual event, see header note) ---
  { start_date: "2026-02-15", end_date: "2026-02-15", name: "Maha Shivratri (Ramanathaswamy Temple)", kind: "holiday", city: "Rameswaram", event_id: "RAM_MAHASHIVRATRI", holiday: { type: "major_festival", intensity: 0.8 } },

  // --- Thiruvananthapuram ---
  { start_date: "2026-04-14", end_date: "2026-04-14", name: "Vishu (Malayalam New Year, estimated)", kind: "holiday", city: "Thiruvananthapuram", event_id: "TVM_VISHU", holiday: { type: "major_festival", intensity: 0.4 } },
  { start_date: "2026-03-05", end_date: "2026-03-05", name: "Attukal Pongala (estimated)", kind: "holiday", city: "Thiruvananthapuram", event_id: "TVM_ATTUKAL_PONGALA", holiday: { type: "extreme_event", intensity: 1.0 } },
  { start_date: "2026-08-26", end_date: "2026-08-26", name: "Onam (Thiruvananthapuram)", kind: "holiday", city: "Thiruvananthapuram", event_id: "TVM_ONAM", holiday: { type: "extreme_event", intensity: 0.3 } },

  // =========================================================================
  // EAST INDIA
  // =========================================================================

  // --- Kolkata ---
  { start_date: "2026-04-15", end_date: "2026-04-15", name: "Poila Boishakh (Bengali New Year, estimated)", kind: "holiday", city: "Kolkata", event_id: "KOL_POILA_BOISHAKH", holiday: { type: "major_festival", intensity: 0.4 } },
  { start_date: "2026-10-16", end_date: "2026-10-20", name: "Durga Puja", kind: "holiday", city: "Kolkata", event_id: "KOL_DURGA_PUJA", holiday: { type: "extreme_event", intensity: 1.0 } },
  { start_date: "2026-11-08", end_date: "2026-11-08", name: "Kali Puja (estimated, same night as Diwali)", kind: "holiday", city: "Kolkata", event_id: "KOL_KALI_PUJA", holiday: { type: "extreme_event", intensity: 0.3 } },
  { start_date: "2026-01-28", end_date: "2026-02-08", name: "International Kolkata Book Fair (estimated)", kind: "event", city: "Kolkata", event_id: "KOL_INTERNATIONAL_BOOK_FAIR", event: { type: "city_wide", intensity: 0.6 } },
  { start_date: "2026-12-04", end_date: "2026-12-11", name: "Kolkata International Film Festival (estimated)", kind: "event", city: "Kolkata", event_id: "KOL_KOLKATA_FILM_FESTIVAL", event: { type: "city_wide", intensity: 0.15 } },
  { start_date: "2026-12-24", end_date: "2026-12-31", name: "Christmas Celebration (Park Street)", kind: "holiday", city: "Kolkata", event_id: "KOL_CHRISTMAS", holiday: { type: "major_festival", intensity: 0.7 } },

  // --- Puri ---
  { start_date: "2026-07-16", end_date: "2026-07-16", name: "Jagannath Rath Yatra (estimated)", kind: "holiday", city: "Puri", event_id: "PURI_RATH_YATRA", holiday: { type: "extreme_event", intensity: 1.0 } },
  { start_date: "2026-06-01", end_date: "2026-06-01", name: "Snana Yatra (estimated)", kind: "holiday", city: "Puri", event_id: "PURI_SNANA_YATRA", holiday: { type: "major_festival", intensity: 0.7 } },
  { start_date: "2026-11-22", end_date: "2026-11-26", name: "Puri Beach Festival (estimated)", kind: "event", city: "Puri", event_id: "PURI_BEACH_FESTIVAL", event: { type: "city_wide", intensity: 0.3 } },

  // --- Bhubaneswar ---
  // (Konark Dance Festival not tagged here — Konark is a distinct town
  // ~65km away, not Bhubaneswar; a Bhubaneswar POI's address would never
  // actually say "Konark", so tagging it here was the same class of bug as
  // the Sonpur/Ziro fix. See the dedicated "Konark" entry below instead.)
  { start_date: "2026-07-16", end_date: "2026-07-16", name: "Rath Yatra Celebrations (estimated)", kind: "holiday", city: "Bhubaneswar", event_id: "BBS_RATH_YATRA", holiday: { type: "major_festival", intensity: 0.6 } },

  // --- Darjeeling ---
  { start_date: "2026-10-30", end_date: "2026-11-02", name: "Darjeeling Tea and Tourism Festival (estimated)", kind: "event", city: "Darjeeling", event_id: "DAR_TEA_TOURISM_FESTIVAL", event: { type: "city_wide", intensity: 0.3 } },
  { start_date: "2026-10-20", end_date: "2026-10-20", name: "Darjeeling Dussehra Celebration", kind: "holiday", city: "Darjeeling", event_id: "DAR_DUSSEHRA", holiday: { type: "major_festival", intensity: 0.2 } },

  // --- Bodh Gaya (Kalachakra Teaching excluded — not an annual event, see header note) ---
  { start_date: "2026-05-01", end_date: "2026-05-01", name: "Buddha Purnima (Mahabodhi Temple)", kind: "holiday", city: "Bodh Gaya", event_id: "BOD_BUDDHA_PURNIMA", holiday: { type: "extreme_event", intensity: 0.3 } },

  // --- Patna ---
  { start_date: "2026-11-14", end_date: "2026-11-14", name: "Chhath Puja (estimated, 6 days after Diwali)", kind: "holiday", city: "Patna", event_id: "PAT_CHHATH_PUJA", holiday: { type: "extreme_event", intensity: 1.0 } },
  { start_date: "2026-03-22", end_date: "2026-03-22", name: "Bihar Diwas", kind: "holiday", city: "Patna", event_id: "PAT_BIHAR_DIWAS", holiday: { type: "long_weekend" } },

  // --- Gaya ---
  { start_date: "2026-09-20", end_date: "2026-10-04", name: "Pitrapaksha Mela (estimated, Bhadrapada month)", kind: "holiday", city: "Gaya", event_id: "GAY_PITRIPAKSHA_MELA", holiday: { type: "extreme_event", intensity: 0.6 } },
  { start_date: "2026-05-01", end_date: "2026-05-01", name: "Buddha Purnima (Gaya)", kind: "holiday", city: "Gaya", event_id: "GAY_BUDDHA_PURNIMA", holiday: { type: "major_festival", intensity: 0.3 } },

  // --- Gangasagar ---
  { start_date: "2026-01-14", end_date: "2026-01-14", name: "Gangasagar Mela", kind: "holiday", city: "Gangasagar", event_id: "GNG_GANGASAGAR_MELA", holiday: { type: "extreme_event", intensity: 1.0 } },

  // --- Ranchi ---
  { start_date: "2026-03-24", end_date: "2026-03-24", name: "Sarhul Festival (estimated)", kind: "holiday", city: "Ranchi", event_id: "RAN_SARHUL", holiday: { type: "major_festival", intensity: 0.7 } },
  { start_date: "2026-09-10", end_date: "2026-09-10", name: "Karam Festival (estimated)", kind: "holiday", city: "Ranchi", event_id: "RAN_KARAM", holiday: { type: "major_festival", intensity: 0.4 } },

  // --- Sonpur (consolidated — same real event as the "Patna" Sonpur Mela in the source batch, tagged to its actual location) ---
  { start_date: "2026-11-19", end_date: "2026-11-24", name: "Sonepur Cattle Fair (estimated, Kartik Purnima)", kind: "holiday", city: "Sonpur", event_id: "SONPUR_CATTLE_FAIR", holiday: { type: "extreme_event", intensity: 0.7 } },

  // --- Konark (distinct town from Bhubaneswar, ~65km away) ---
  { start_date: "2026-12-01", end_date: "2026-12-05", name: "Konark Dance Festival (estimated)", kind: "event", city: "Konark", event_id: "KON_DANCE_FESTIVAL", event: { type: "city_wide", intensity: 0.3 } },

  // --- Siliguri ---
  { start_date: "2026-10-16", end_date: "2026-10-20", name: "Durga Puja (Siliguri)", kind: "holiday", city: "Siliguri", event_id: "SIL_DURGA_PUJA", holiday: { type: "extreme_event", intensity: 0.3 } },
  { start_date: "2026-11-15", end_date: "2026-11-17", name: "Siliguri Tea Festival (estimated)", kind: "event", city: "Siliguri", event_id: "SIL_TEA_FESTIVAL", event: { type: "city_wide", intensity: 0.15 } },

  // =========================================================================
  // NORTHEAST INDIA
  // =========================================================================

  // --- Guwahati ---
  { start_date: "2026-06-22", end_date: "2026-06-26", name: "Ambubachi Mela (estimated)", kind: "holiday", city: "Guwahati", event_id: "GUW_AMBUBACHI_MELA", holiday: { type: "extreme_event", intensity: 1.0 } },
  { start_date: "2026-04-14", end_date: "2026-04-15", name: "Rongali Bihu", kind: "holiday", city: "Guwahati", event_id: "GUW_RONGALI_BIHU", holiday: { type: "extreme_event", intensity: 0.3 } },
  { start_date: "2026-10-16", end_date: "2026-10-20", name: "Durga Puja (Guwahati)", kind: "holiday", city: "Guwahati", event_id: "GUW_DURGA_PUJA", holiday: { type: "major_festival", intensity: 0.7 } },

  // --- Shillong ---
  { start_date: "2026-04-10", end_date: "2026-04-10", name: "Shad Suk Mynsiem Festival (estimated)", kind: "holiday", city: "Shillong", event_id: "SHL_SHAD_SUK_MYNSEIM", holiday: { type: "major_festival", intensity: 0.4 } },
  { start_date: "2026-11-05", end_date: "2026-11-07", name: "Wangala Festival (estimated)", kind: "holiday", city: "Shillong", event_id: "SHL_WANGALA", holiday: { type: "major_festival", intensity: 0.4 } },
  { start_date: "2026-12-24", end_date: "2026-12-31", name: "Christmas Celebration (Police Bazaar)", kind: "holiday", city: "Shillong", event_id: "SHL_CHRISTMAS", holiday: { type: "major_festival", intensity: 0.7 } },

  // --- Kohima ---
  { start_date: "2026-12-01", end_date: "2026-12-10", name: "Hornbill Festival", kind: "event", city: "Kohima", event_id: "KOH_HORNBILL", event: { type: "city_wide", intensity: 0.6 } },

  // --- Imphal ---
  { start_date: "2026-11-21", end_date: "2026-11-30", name: "Sangai Festival (estimated)", kind: "event", city: "Imphal", event_id: "IMP_SANGAI_FESTIVAL", event: { type: "city_wide", intensity: 0.5 } },
  { start_date: "2026-03-04", end_date: "2026-03-08", name: "Yaoshang Festival (estimated, Manipuri Holi)", kind: "holiday", city: "Imphal", event_id: "IMP_YAOSHANG", holiday: { type: "major_festival", intensity: 0.6 } },

  // --- Aizawl ---
  { start_date: "2026-03-05", end_date: "2026-03-05", name: "Chapchar Kut (estimated)", kind: "holiday", city: "Aizawl", event_id: "AIZ_CHAPCHAR_KUT", holiday: { type: "major_festival", intensity: 0.6 } },
  { start_date: "2026-12-24", end_date: "2026-12-31", name: "Christmas Celebration", kind: "holiday", city: "Aizawl", event_id: "AIZ_CHRISTMAS", holiday: { type: "major_festival", intensity: 0.7 } },

  // --- Ziro (distinct valley/town from Itanagar, several hours away) ---
  { start_date: "2026-09-24", end_date: "2026-09-27", name: "Ziro Festival of Music", kind: "event", city: "Ziro", event_id: "ITA_ZIRO_FESTIVAL", event: { type: "city_wide", intensity: 0.55 } },

  // --- Tawang ---
  { start_date: "2026-02-18", end_date: "2026-02-18", name: "Losar Festival (estimated, Tibetan New Year)", kind: "holiday", city: "Tawang", event_id: "TAW_LOSAR", holiday: { type: "major_festival", intensity: 0.4 } },
  { start_date: "2026-01-08", end_date: "2026-01-10", name: "Torgya Festival (estimated)", kind: "holiday", city: "Tawang", event_id: "TAW_TORGYA", holiday: { type: "major_festival", intensity: 0.6 } },

  // =========================================================================
  // CENTRAL INDIA
  // =========================================================================

  // --- Ujjain (Simhastha Kumbh excluded — not occurring in 2026, see header note) ---
  { start_date: "2026-02-15", end_date: "2026-02-15", name: "Maha Shivratri (Mahakaleshwar Temple)", kind: "holiday", city: "Ujjain", event_id: "UJJ_MAHA_SHIVRATRI", holiday: { type: "extreme_event", intensity: 0.7 } },
  { start_date: "2026-08-14", end_date: "2026-08-14", name: "Nag Panchami (estimated)", kind: "holiday", city: "Ujjain", event_id: "UJJ_NAG_PANCHAMI", holiday: { type: "major_festival", intensity: 0.7 } },

  // --- Indore ---
  { start_date: "2026-03-09", end_date: "2026-03-09", name: "Rang Panchami Festival (estimated, 5 days after Holi)", kind: "holiday", city: "Indore", event_id: "IND_RANGPANCHAMI", holiday: { type: "extreme_event", intensity: 0.3 } },
  { start_date: "2026-09-24", end_date: "2026-09-24", name: "Ganesh Visarjan (estimated)", kind: "holiday", city: "Indore", event_id: "IND_ANANT_CHAUDAS", holiday: { type: "major_festival", intensity: 0.7 } },
  { start_date: "2026-10-11", end_date: "2026-10-19", name: "Navratri Celebration", kind: "holiday", city: "Indore", event_id: "IND_NAVRATRI", holiday: { type: "major_festival", intensity: 0.7 } },

  // --- Bhopal ---
  { start_date: "2026-01-25", end_date: "2026-01-28", name: "Lokrang Festival (estimated)", kind: "event", city: "Bhopal", event_id: "BHO_LOKRANG", event: { type: "city_wide", intensity: 0.3 } },
  { start_date: "2026-11-08", end_date: "2026-11-08", name: "Diwali (Bhopal)", kind: "holiday", city: "Bhopal", event_id: "BHO_DIWALI", holiday: { type: "major_festival", intensity: 0.4 } },

  // --- Khajuraho ---
  { start_date: "2026-02-20", end_date: "2026-02-26", name: "Khajuraho Dance Festival (estimated)", kind: "event", city: "Khajuraho", event_id: "KHA_DANCE_FESTIVAL", event: { type: "city_wide", intensity: 0.5 } },

  // --- Sanchi (low-confidence date estimate — little strong basis found) ---
  { start_date: "2026-11-25", end_date: "2026-11-27", name: "Sanchi Festival (estimated, low confidence)", kind: "event", city: "Sanchi", event_id: "SAN_CHEELOSAV", event: { type: "city_wide", intensity: 0.1 } },

  // --- Jabalpur ---
  { start_date: "2026-02-03", end_date: "2026-02-03", name: "Narmada Jayanti (estimated)", kind: "holiday", city: "Jabalpur", event_id: "JAB_NARMADA_JAYANTI", holiday: { type: "major_festival", intensity: 0.7 } },
  { start_date: "2026-02-20", end_date: "2026-02-22", name: "Bhedaghat Tourism Festival (estimated)", kind: "event", city: "Jabalpur", event_id: "JAB_BALANCE_FESTIVAL", event: { type: "city_wide", intensity: 0.3 } },

  // --- Gwalior ---
  { start_date: "2026-12-15", end_date: "2026-12-19", name: "Tansen Samaroh (estimated)", kind: "event", city: "Gwalior", event_id: "GWL_TANSEN_SAMAROH", event: { type: "city_wide", intensity: 0.4 } },
  { start_date: "2026-01-20", end_date: "2026-01-22", name: "Gwalior Fort Festival (estimated, low confidence)", kind: "event", city: "Gwalior", event_id: "GWL_FORT_FESTIVAL", event: { type: "city_wide", intensity: 0.25 } },
];
