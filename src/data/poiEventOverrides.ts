import { PoiEventOverride } from "../db/calendarRepository";

/**
 * Seed data for the `poi_event_overrides` MongoDB collection — POI-specific
 * numbers for a festival, for the handful of POIs where we actually know the
 * generic city-wide value understates (or overstates) the real impact. Not
 * meant to cover every POI — a POI with no row here just uses the generic
 * city/nationwide value from calendarEvents.ts, exactly as before. This is
 * a pure enhancement layer: add a row here only when there's a real reason
 * to believe a specific POI's crowd surge differs meaningfully from its
 * city's generic number, not for every POI just to have coverage.
 *
 * `place_id` values below are real, taken from POIs already used elsewhere
 * in this project's testing/documentation (see DOCUMENTATION.md) — for
 * anywhere else, add the actual place_id (or CID) once it's been scraped.
 */
export const POI_EVENT_OVERRIDES_2026: PoiEventOverride[] = [
  {
    event_id: "AMR_GURPURAB",
    place_id: "0x39197ca8f667bd97:0x604384897626248e", // Sri Harmandir Sahib (Golden Temple) — the actual epicenter of Guru Nanak Jayanti
    poi_name: "Sri Harmandir Sahib (Golden Temple)",
    holiday: { type: "extreme_event", intensity: 1.0 },
  },
  {
    event_id: "AMR_BAISAKHI",
    place_id: "0x39197ca8f667bd97:0x604384897626248e", // Same POI — Baisakhi also centers heavily on the Golden Temple, just less extreme than Gurpurab
    poi_name: "Sri Harmandir Sahib (Golden Temple)",
    holiday: { type: "extreme_event", intensity: 0.85 },
  },
];

// NOT added: a Lalbaug-specific override for Mumbai's Ganesh Chaturthi
// (mentioned in the source material at a much higher relative intensity than
// the generic Mumbai entry). Lalbaug is a neighborhood, not a single POI we
// have ever actually scraped a place_id for — adding an override here would
// mean inventing a fake place_id, which defeats the whole point of this
// being a *specific, verified* POI layer. Add it for real once a specific
// POI in that area (e.g. "Lalbaugcha Raja" mandal) has been scraped and its
// real place_id is known.
