import { calculateCrowdEstimate } from "./calibration";
import { MdCategory, resolveMdCategory } from "./mdCategories";
import {
  Category,
  CrowdEstimateInput,
  CrowdEstimateResult,
  DayOfWeek,
  EventType,
  HolidayType,
  MealTime,
  RangedInput,
  SaleType,
  VenueEventState,
  WeatherType,
} from "./types";

export interface MdCrowdEstimateContext {
  dayOfWeek: DayOfWeek;
  /** 0-100 busyness score. Required for every engine category except event_venue. */
  score?: number;
  /** Overrides the mdCategory's placeholder default anchor/capacity/seatingCapacity. */
  anchorOverride?: number;
  /**
   * Resolved anchor from `poi_anchor_estimates` or a fresh AI call (see
   * ai/anchorEstimate.ts) — used only when `anchorOverride` is omitted.
   * Lower priority than an explicit caller value, higher priority than the
   * generic category default. Deliberately not imported from ai/anchorEstimate.ts
   * (would create a formulas <-> ai circular dependency) — kept structurally
   * identical instead.
   */
  aiEstimatedAnchor?: {
    value: number;
    confidence: number;
    caveats: string[];
    origin: "database" | "ai_estimated";
    verificationTier?: string;
    sourceType?: string;
  };
  holiday?: RangedInput<HolidayType>;
  event?: RangedInput<EventType>;
  weather?: RangedInput<WeatherType>;
  sale?: RangedInput<SaleType>;
  meal?: MealTime;
  eventState?: RangedInput<VenueEventState>;
  /** Required only when mdCategory is "Manual Allotment". */
  manual?: { engineCategory: Category; anchor: number };
}

export type MdCrowdEstimateFailure =
  | { ok: false; reason: "unknown_category"; message: string }
  | { ok: false; reason: "not_created"; message: string }
  | { ok: false; reason: "manual_allotment_missing_override"; message: string }
  | { ok: false; reason: "missing_score"; message: string };

export interface MdCrowdEstimateSuccess extends CrowdEstimateResult {
  ok: true;
  mdCategory: MdCategory;
  mdCategoryLabel: string;
  anchorUsed: number;
  anchorSource: "default" | "override" | "manual" | "database" | "ai_estimated";
  /** Present only when anchorSource is "database" or "ai_estimated". */
  anchorEstimate?: { confidence: number; caveats: string[]; verificationTier?: string; sourceType?: string };
}

export type MdCrowdEstimateOutcome = MdCrowdEstimateSuccess | MdCrowdEstimateFailure;

export function calculateCrowdEstimateForMdCategory(
  mdCategoryRaw: string,
  ctx: MdCrowdEstimateContext
): MdCrowdEstimateOutcome {
  const { mdCategory, resolution } = resolveMdCategory(mdCategoryRaw);

  if (!mdCategory || !resolution) {
    return {
      ok: false,
      reason: "unknown_category",
      message: `"${mdCategoryRaw}" does not match any of the 30 MD-categories.`,
    };
  }

  if (resolution.kind === "unresolved") {
    return {
      ok: false,
      reason: "not_created",
      message:
        'This POI is tagged "Not Created" — assign it a real MD-category before requesting a crowd estimate.',
    };
  }

  let engineCategory: Category;
  let anchor: number;
  let anchorSource: "default" | "override" | "manual" | "database" | "ai_estimated";
  let mdCategoryLabel: string;
  let anchorEstimate: { confidence: number; caveats: string[]; verificationTier?: string; sourceType?: string } | undefined;

  if (resolution.kind === "manual") {
    if (!ctx.manual) {
      return {
        ok: false,
        reason: "manual_allotment_missing_override",
        message:
          'This POI is tagged "Manual Allotment" — pass `manual: { engineCategory, anchor }` explicitly in the request.',
      };
    }
    engineCategory = ctx.manual.engineCategory;
    anchor = ctx.manual.anchor;
    anchorSource = "manual";
    mdCategoryLabel = "Manual Allotment";
  } else {
    engineCategory = resolution.profile.engineCategory;
    mdCategoryLabel = resolution.profile.label;

    if (ctx.anchorOverride !== undefined) {
      anchor = ctx.anchorOverride;
      anchorSource = "override";
    } else if (ctx.aiEstimatedAnchor !== undefined) {
      anchor = ctx.aiEstimatedAnchor.value;
      anchorSource = ctx.aiEstimatedAnchor.origin;
      anchorEstimate = {
        confidence: ctx.aiEstimatedAnchor.confidence,
        caveats: ctx.aiEstimatedAnchor.caveats,
        verificationTier: ctx.aiEstimatedAnchor.verificationTier,
        sourceType: ctx.aiEstimatedAnchor.sourceType,
      };
    } else {
      anchor = resolution.profile.defaultAnchor;
      anchorSource = "default";
    }
  }

  if (engineCategory !== "event_venue" && ctx.score === undefined) {
    return {
      ok: false,
      reason: "missing_score",
      message: `mdCategory "${mdCategoryLabel}" maps to the "${engineCategory}" formula, which requires a 0-100 "score".`,
    };
  }

  let input: CrowdEstimateInput;
  switch (engineCategory) {
    case "religious_site":
      input = {
        category: "religious_site",
        score: ctx.score as number,
        dayOfWeek: ctx.dayOfWeek,
        peakAnchor: anchor,
        holiday: ctx.holiday,
        event: ctx.event,
        weather: ctx.weather,
      };
      break;
    case "restaurant_cafe":
      input = {
        category: "restaurant_cafe",
        score: ctx.score as number,
        dayOfWeek: ctx.dayOfWeek,
        seatingCapacity: anchor,
        meal: ctx.meal ?? "off_peak",
      };
      break;
    case "market_shopping":
      input = {
        category: "market_shopping",
        score: ctx.score as number,
        dayOfWeek: ctx.dayOfWeek,
        peakAnchor: anchor,
        sale: ctx.sale,
        weather: ctx.weather,
      };
      break;
    case "event_venue":
      input = {
        category: "event_venue",
        dayOfWeek: ctx.dayOfWeek,
        capacity: anchor,
        eventState: ctx.eventState ?? { type: "none" },
      };
      break;
  }

  const result = calculateCrowdEstimate(input);

  return {
    ...result,
    ok: true,
    mdCategory,
    mdCategoryLabel,
    anchorUsed: anchor,
    anchorSource,
    ...(anchorEstimate ? { anchorEstimate } : {}),
  };
}
