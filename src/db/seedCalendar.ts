/**
 * One-time (or re-run-whenever-the-list-changes) loader: pushes
 * src/data/calendarEvents.ts and src/data/poiEventOverrides.ts into their
 * MongoDB collections. Run with `npm run seed:calendar`.
 *
 * Full replace on each run (not a partial upsert) — simplest way to stay
 * correct across schema changes (this collection has already gained fields
 * twice: `city`, then `event_id`) without worrying about orphaned documents
 * from an older shape. Safe to re-run any time either seed file changes.
 */
import { CALENDAR_EVENTS_2026 } from "../data/calendarEvents";
import { POI_EVENT_OVERRIDES_2026 } from "../data/poiEventOverrides";
import { getDb } from "./mongo";
import { CalendarDoc, PoiEventOverride } from "./calendarRepository";

async function main() {
  const db = await getDb();

  const calendar = db.collection<CalendarDoc>("calendar_events");
  await calendar.deleteMany({});
  await calendar.createIndex({ start_date: 1, end_date: 1, city: 1 });
  if (CALENDAR_EVENTS_2026.length > 0) {
    await calendar.insertMany(CALENDAR_EVENTS_2026);
  }
  console.log(`Seeded ${CALENDAR_EVENTS_2026.length} calendar entries into calendar_events.`);

  const poiOverrides = db.collection<PoiEventOverride>("poi_event_overrides");
  await poiOverrides.deleteMany({});
  await poiOverrides.createIndex({ event_id: 1, place_id: 1 });
  if (POI_EVENT_OVERRIDES_2026.length > 0) {
    await poiOverrides.insertMany(POI_EVENT_OVERRIDES_2026);
  }
  console.log(`Seeded ${POI_EVENT_OVERRIDES_2026.length} POI-specific overrides into poi_event_overrides.`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
