import { Category } from "./types";

/**
 * The 30 MD-categories used to tag POIs in the product's own data (from the
 * user's list, 2026-09-16). Keys are normalized (see normalizeMdCategory) so
 * "Religious Sites", "religious_sites", "Religious-Sites" all resolve the same.
 */
export const MD_CATEGORIES = [
  "eateries",
  "food_market",
  "stays",
  "camps",
  "shops",
  "transport_and_mobility",
  "religious_sites",
  "historical_sites",
  "museum",
  "viewpoint",
  "stadium",
  "caves",
  "forts_and_palaces",
  "nature_and_scenic_spot",
  "lake",
  "beaches",
  "culture_and_art_tradition",
  "national_park_and_zoo",
  "experience_corridor",
  "vineyard",
  "adventure_activities",
  "family_kids_friendly_activities",
  "wellness_and_spiritual_activities",
  "local_life_experience",
  "events_entertainment",
  "trek",
  "photography_and_content_creation",
  "ngo_social_service",
  "not_created",
  "manual_allotment",
] as const;

export type MdCategory = (typeof MD_CATEGORIES)[number];

/** Turns any casing/spacing/punctuation variant into one of the keys above. */
export function normalizeMdCategory(raw: string): MdCategory | null {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[\s\-/]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  return (MD_CATEGORIES as readonly string[]).includes(key) ? (key as MdCategory) : null;
}

export type AnchorField = "peakAnchor" | "seatingCapacity" | "capacity";

export interface MdCategoryProfile {
  label: string;
  engineCategory: Category;
  anchorField: AnchorField;
  /** Placeholder default — tune per real-world POI via `anchorOverride` in the request, or edit here. */
  defaultAnchor: number;
  notes: string;
}

/** Marks the two meta-states that don't route through a formula automatically. */
export type MdCategoryResolution =
  | { kind: "profile"; profile: MdCategoryProfile }
  | { kind: "unresolved" } // "Not Created" — POI hasn't been categorized yet
  | { kind: "manual" }; // "Manual Allotment" — caller must supply engineCategory + anchor explicitly

/**
 * Every MD-category maps onto one of the 4 documented Livecrowd.md formulas
 * (religious_site's non-linear/holiday-driven curve, restaurant_cafe's
 * capacity+meal curve, market_shopping's foot-traffic curve, or event_venue's
 * flat capacity model) plus a placeholder default anchor. These anchor
 * numbers are business judgment calls, not measured data — override per-POI
 * with `anchorOverride` in the request once you have real capacity numbers.
 */
const PROFILES: Record<Exclude<MdCategory, "not_created" | "manual_allotment">, MdCategoryProfile> = {
  eateries: {
    label: "Eateries",
    engineCategory: "restaurant_cafe",
    anchorField: "seatingCapacity",
    defaultAnchor: 60,
    notes: "Direct fit for the restaurant/café formula (meal-time + weekend curve).",
  },
  food_market: {
    label: "Food Market",
    engineCategory: "market_shopping",
    anchorField: "peakAnchor",
    defaultAnchor: 5_000,
    notes: "Open-area foot traffic, closer to a bazaar than a single restaurant.",
  },
  stays: {
    label: "Stays",
    engineCategory: "market_shopping",
    anchorField: "peakAnchor",
    defaultAnchor: 300,
    notes: "Google popular-times reflects lobby/reception traffic, not room occupancy.",
  },
  camps: {
    label: "Camps",
    engineCategory: "market_shopping",
    anchorField: "peakAnchor",
    defaultAnchor: 200,
    notes: "Weather-sensitive foot traffic; market curve's weather multiplier fits well.",
  },
  shops: {
    label: "Shops",
    engineCategory: "market_shopping",
    anchorField: "peakAnchor",
    defaultAnchor: 3_000,
    notes: "Textbook market/shopping formula fit.",
  },
  transport_and_mobility: {
    label: "Transport and Mobility",
    engineCategory: "market_shopping",
    anchorField: "peakAnchor",
    defaultAnchor: 8_000,
    notes: "Station/hub footfall; D_sale stays at 1.0 (not applicable) unless overridden.",
  },
  religious_sites: {
    label: "Religious Sites",
    engineCategory: "religious_site",
    anchorField: "peakAnchor",
    defaultAnchor: 100_000,
    notes: "Canonical case from Livecrowd.md (Golden Temple reference anchor).",
  },
  historical_sites: {
    label: "Historical Sites",
    engineCategory: "religious_site",
    anchorField: "peakAnchor",
    defaultAnchor: 20_000,
    notes: "Monuments see holiday/festival-driven surges, same non-linear shape.",
  },
  museum: {
    label: "Museum",
    engineCategory: "market_shopping",
    anchorField: "peakAnchor",
    defaultAnchor: 5_000,
    notes: "Steadier attraction traffic without the religious holiday multiplier.",
  },
  viewpoint: {
    label: "Viewpoint",
    engineCategory: "market_shopping",
    anchorField: "peakAnchor",
    defaultAnchor: 3_000,
    notes: "Weather-driven scenic spot foot traffic.",
  },
  stadium: {
    label: "Stadium",
    engineCategory: "event_venue",
    anchorField: "capacity",
    defaultAnchor: 40_000,
    notes: "Empty when no event; capacity model fits directly.",
  },
  caves: {
    label: "Caves",
    engineCategory: "market_shopping",
    anchorField: "peakAnchor",
    defaultAnchor: 2_000,
    notes: "Nature/scenic-style foot traffic.",
  },
  forts_and_palaces: {
    label: "Forts and Palaces",
    engineCategory: "religious_site",
    anchorField: "peakAnchor",
    defaultAnchor: 30_000,
    notes: "Major monuments, same festival/holiday-driven non-linear shape.",
  },
  nature_and_scenic_spot: {
    label: "Nature and Scenic Spot",
    engineCategory: "market_shopping",
    anchorField: "peakAnchor",
    defaultAnchor: 4_000,
    notes: "Weather-sensitive outdoor foot traffic.",
  },
  lake: {
    label: "Lake",
    engineCategory: "market_shopping",
    anchorField: "peakAnchor",
    defaultAnchor: 5_000,
    notes: "Outdoor scenic-spot pattern.",
  },
  beaches: {
    label: "Beaches",
    engineCategory: "market_shopping",
    anchorField: "peakAnchor",
    defaultAnchor: 15_000,
    notes: "Can spike heavily on weekends/holidays; still a foot-traffic pattern, not ceremony-driven.",
  },
  culture_and_art_tradition: {
    label: "Culture and Art Tradition",
    engineCategory: "religious_site",
    anchorField: "peakAnchor",
    defaultAnchor: 10_000,
    notes: "Festival/event-driven attendance, matches the holiday+event multiplier set.",
  },
  national_park_and_zoo: {
    label: "National Park and Zoo",
    engineCategory: "religious_site",
    anchorField: "peakAnchor",
    defaultAnchor: 15_000,
    notes: "Heavy holiday-season surges (family outings).",
  },
  experience_corridor: {
    label: "Experience_corridor",
    engineCategory: "market_shopping",
    anchorField: "peakAnchor",
    defaultAnchor: 5_000,
    notes: "Curated walking/experience zone; treated as a foot-traffic corridor.",
  },
  vineyard: {
    label: "Vineyard",
    engineCategory: "market_shopping",
    anchorField: "peakAnchor",
    defaultAnchor: 1_500,
    notes: "Weekend/weather-driven leisure visit pattern.",
  },
  adventure_activities: {
    label: "Adventure Activities",
    engineCategory: "market_shopping",
    anchorField: "peakAnchor",
    defaultAnchor: 1_000,
    notes: "Small-scale, weather-sensitive activity footfall.",
  },
  family_kids_friendly_activities: {
    label: "Family Kids Friendly Activities",
    engineCategory: "market_shopping",
    anchorField: "peakAnchor",
    defaultAnchor: 3_000,
    notes: "Weekend-heavy family footfall.",
  },
  wellness_and_spiritual_activities: {
    label: "Wellness and Spiritual Activities",
    engineCategory: "market_shopping",
    anchorField: "peakAnchor",
    defaultAnchor: 2_000,
    notes: "Service-based, steadier than a pilgrimage site; not holiday-surge driven by default.",
  },
  local_life_experience: {
    label: "Local_life_experience",
    engineCategory: "market_shopping",
    anchorField: "peakAnchor",
    defaultAnchor: 2_000,
    notes: "General foot-traffic experience venue.",
  },
  events_entertainment: {
    label: "Events_entertainment",
    engineCategory: "event_venue",
    anchorField: "capacity",
    defaultAnchor: 2_000,
    notes: "Capacity-bound, event-night driven.",
  },
  trek: {
    label: "Trek",
    engineCategory: "market_shopping",
    anchorField: "peakAnchor",
    defaultAnchor: 1_000,
    notes: "Weather-critical outdoor foot traffic.",
  },
  photography_and_content_creation: {
    label: "Photography & Content Creation",
    engineCategory: "market_shopping",
    anchorField: "peakAnchor",
    defaultAnchor: 1_500,
    notes: "Scenic/experiential foot traffic.",
  },
  ngo_social_service: {
    label: "NGO / Social_service",
    engineCategory: "market_shopping",
    anchorField: "peakAnchor",
    defaultAnchor: 500,
    notes: "Small-scale visitor/volunteer footfall.",
  },
};

export function resolveMdCategory(raw: string): {
  mdCategory: MdCategory | null;
  resolution: MdCategoryResolution | null;
} {
  const mdCategory = normalizeMdCategory(raw);
  if (!mdCategory) return { mdCategory: null, resolution: null };

  if (mdCategory === "not_created") return { mdCategory, resolution: { kind: "unresolved" } };
  if (mdCategory === "manual_allotment") return { mdCategory, resolution: { kind: "manual" } };

  return {
    mdCategory,
    resolution: { kind: "profile", profile: PROFILES[mdCategory] },
  };
}
