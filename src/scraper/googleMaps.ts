import { Browser, chromium, Page } from "playwright";
import { env } from "../config/env";
import { DayOfWeek } from "../formulas/types";
import { lookupCachedScrape, setCachedScrape } from "./cache";
import { withConcurrencyLimit } from "./concurrencyLimit";
import { withInFlightDedup } from "./inflight";
import { PopularTimesBar, PopularTimesByDay, ScrapeOptions, ScrapedPoiData } from "./types";

/**
 * Google Maps' DOM classes are obfuscated and rotate periodically — do NOT
 * add brittle CSS-class selectors here. Everything below reads from
 * accessibility attributes (aria-label, role) and visible text, which Google
 * keeps far more stable than class names because screen readers depend on
 * them. If Google reshapes the page, this file is the single place to patch.
 */
const SELECTORS = {
  placeName: "h1",
  // Popular-times bars are exposed to screen readers as "<N>% busy at <time>."
  busyBar: '[aria-label*="% busy"]',
  addressButton: 'button[data-item-id="address"]',
} as const;

const BUSY_BAR_REGEX = /(\d+)\s*%\s*busy(?:\s*(?:at|on)\s*([^.,]+))?/i;

// Confirmed live (two independent POIs, different opening-hours block sizes):
// Google's 7 day-blocks of bars are in fixed Sunday-first calendar order, NOT
// rolling from "today" — the day dropdown's own label ("Thursdays") lined up
// with block index 4 both times (Sun=0..Thu=4..Sat=6), which also rules out
// "rolling from today" (that would put today at index 0).
export const WEEK_ORDER: DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/**
 * A resolved place page's URL always has a non-empty name segment between
 * "/place/" and the next "/" (e.g. "/maps/place/Sri+Harmandir+Sahib/@31...").
 * An unresolved place_id/search either stays on our own request URL
 * ("/maps/place/?q=place_id:...", nothing between "/place/" and "?") or gets
 * redirected to a bare area view ("/maps/@lat,lng,zoom", no "/place/" at
 * all) — this regex is the one signal that distinguishes "really landed on
 * a POI" from both of those failure shapes.
 */
const PLACE_PAGE_URL_RE = /\/maps\/place\/[^/?]+\//;

// Both the search-results list panel AND the place detail panel carry [role="main"]
// landmarks on this layout, so role-scoping alone can't disambiguate the real <h1>.
// Filter by content instead: skip the list's own heading and any sponsored-content heading.
function isRealPlaceHeading(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^results$/i.test(t)) return false;
  if (/^sponsored/i.test(t)) return false;
  return true;
}

// Google's address/category buttons prepend an icon-font ligature character
// (a real character in the DOM text, rendered as a pin/tag icon by Google's
// font — but as a "tofu" box □ in plain-text viewers like Postman or a
// terminal, since they don't have that icon font). Strip any leading
// character that isn't a letter or digit rather than hardcoding a codepoint,
// since Google can change which icon glyph it uses.
function stripLeadingIconGlyph(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

// Google's UI itself never shows a numeric "live busyness %" — only a qualitative
// label (confirmed via live DOM inspection: "Live" and "Not too busy" are separate
// text nodes with no percentage anywhere nearby). This maps that same qualitative
// bucket back to an approximate score, so it's a translation of Google's own
// classification, not a fabricated number — always treat it as approximate.
const LIVE_STATUS_SCORE_BANDS: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /as busy as it gets/i, score: 95 },
  { pattern: /busier than usual/i, score: 75 },
  { pattern: /a little busy/i, score: 45 },
  { pattern: /less busy than usual/i, score: 15 },
  { pattern: /not too busy|not busy/i, score: 25 },
];

function estimateScoreFromLiveStatusText(text: string): number | null {
  const band = LIVE_STATUS_SCORE_BANDS.find((b) => b.pattern.test(text));
  return band?.score ?? null;
}

const LIVE_STATUS_PHRASES = [
  "As busy as it gets",
  "Busier than usual",
  "A little busy",
  "Less busy than usual",
  "Not too busy",
  "Not busy",
];

function parseCidFromUrl(url: string): string | null {
  // Google Maps place URLs embed a hex CID like "...!1s0x39197ca8f6...:0x..."
  // — a DIFFERENT id namespace than the Places API place_id (ChIJ...).
  const match = url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  return match ? match[1] : null;
}

function parseLatLngFromUrl(url: string): { lat: number | null; lng: number | null } {
  // A resolved place URL always carries the POI's own coordinates in an
  // "@lat,lng,zoom" segment (e.g. ".../place/Sri+Harmandir+Sahib/@31.6272265,74.8674364,17z/...").
  const match = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (!match) return { lat: null, lng: null };
  return { lat: Number(match[1]), lng: Number(match[2]) };
}

async function extractLiveStatus(
  page: Page
): Promise<{ text: string | null; score: number | null }> {
  // This callback is Playwright's page.evaluate() — its SOURCE TEXT gets
  // serialized and executed inside the browser's isolated page context, a
  // completely separate JS realm from this Node process. Any obfuscator
  // transform that relies on a shared helper defined in the outer scope
  // (the string-array decoder, control-flow-flattening's dispatcher, etc.)
  // breaks here with a ReferenceError, since that helper doesn't exist in
  // the browser context — confirmed live when building the obfuscated
  // vendor bundle (see scripts/buildVendor.js). The directive comments
  // below are no-ops everywhere except the obfuscator step — tagged
  // @preserve so esbuild's bundler (which strips ordinary comments) keeps
  // them too, or the obfuscator would never even see them. Deliberately a
  // standalone statement, not chained off `page` — confirmed live that
  // esbuild only reliably preserves @preserve comments attached to a
  // statement/declaration, not ones sitting mid-method-chain.
  // @preserve javascript-obfuscator:disable
  const evaluatePromise = page.evaluate((phrases) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const t = node.textContent?.trim();
      if (t && phrases.some((p) => t.toLowerCase() === p.toLowerCase())) {
        return t;
      }
    }
    return null;
  }, LIVE_STATUS_PHRASES);
  // @preserve javascript-obfuscator:enable
  const text = await evaluatePromise.catch(() => null);

  if (!text) return { text: null, score: null };
  return { text, score: estimateScoreFromLiveStatusText(text) };
}

// Google gives no stable visual/DOM marker for "this is the current hour"
// (confirmed live — no distinguishing class, attribute, or computed style
// differs between bars), so there's no per-bar "is now" flag here.
// liveScore/liveStatusText (above) are the actual "right now" signal.
function emptyWeek(): PopularTimesByDay {
  return {
    sunday: [],
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
  };
}

async function extractPopularTimesByDay(page: Page): Promise<PopularTimesByDay> {
  // @preserve javascript-obfuscator:disable — see extractLiveStatus's comment above;
  // $$eval's callback is serialized into the browser's isolated page context too.
  const barLabels = await page.$$eval(SELECTORS.busyBar, (nodes) =>
    nodes.map((node) => node.getAttribute("aria-label") ?? "")
  );
  // @preserve javascript-obfuscator:enable
  if (barLabels.length === 0 || barLabels.length % 7 !== 0) {
    // Not the expected "7 equal day-blocks" shape (e.g. no data at all, or
    // Google changed the widget) — safest to return nothing rather than
    // mis-split a shape we don't recognize.
    return emptyWeek();
  }

  const blockSize = barLabels.length / 7;
  const parsed: PopularTimesByDay = emptyWeek();

  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const day = WEEK_ORDER[dayIndex];
    const block = barLabels.slice(dayIndex * blockSize, (dayIndex + 1) * blockSize);
    const bars: PopularTimesBar[] = [];
    for (const ariaLabel of block) {
      const match = ariaLabel.match(BUSY_BAR_REGEX);
      if (!match) continue;
      bars.push({ percentage: Number(match[1]), hourLabel: (match[2] ?? "").trim() });
    }
    parsed[day] = bars;
  }

  return parsed;
}

/**
 * Best-effort sanity check that WEEK_ORDER's fixed Sun-Sat assumption still
 * holds: compares the day dropdown's own label against which 24ish-bar block
 * is actually visually rendered (others exist in the DOM for accessibility
 * but are hidden). Only logs — never throws — since this runs on every
 * scrape and a mismatch here means "the mapping in this file needs
 * re-verifying," not "this particular request should fail."
 */
async function warnIfDayOrderAssumptionBroke(page: Page, blockCount: number): Promise<void> {
  if (blockCount === 0) return;

  const dropdownLabel = await page
    .getByRole("button", { name: /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?$/i })
    .first()
    .textContent()
    .catch(() => null);
  if (!dropdownLabel) return;

  const expectedDay = dropdownLabel.trim().toLowerCase().replace(/s$/, "");
  const expectedIndex = WEEK_ORDER.indexOf(expectedDay as DayOfWeek);
  if (expectedIndex === -1) return;

  // @preserve javascript-obfuscator:disable — see extractLiveStatus's comment above.
  const visibility = await page.$$eval(SELECTORS.busyBar, (nodes) =>
    nodes.map((n) => (n as HTMLElement).offsetParent !== null)
  );
  // @preserve javascript-obfuscator:enable
  const blockSize = visibility.length / 7;
  if (!Number.isInteger(blockSize)) return;

  const visibleBlockIndex = Math.floor(
    visibility.findIndex((v) => v) / blockSize
  );
  if (visibleBlockIndex >= 0 && visibleBlockIndex !== expectedIndex) {
    console.warn(
      `[scraper] Day-block order assumption may have broken: dropdown says "${dropdownLabel}" ` +
        `(expected block index ${expectedIndex}) but block index ${visibleBlockIndex} is the one ` +
        `actually rendered. Re-verify WEEK_ORDER in src/scraper/googleMaps.ts.`
    );
  }
}

interface RawExtraction {
  placeName: string;
  category: string | null;
  address: string | null;
  liveStatusText: string | null;
  liveScore: number | null;
  popularTimesByDay: PopularTimesByDay;
}

/** Everything after navigation has landed on a place page — shared by both scrape entry points. */
async function extractPlaceData(page: Page, timeoutMs: number, fallbackName: string): Promise<RawExtraction> {
  const addressButton = page.locator(SELECTORS.addressButton).first();

  // The results-list panel's own <h1> ("Results", or empty) can already be in
  // the DOM and loads before the detail panel's real <h1> gets appended — so
  // don't read the heading until something that only exists in the loaded
  // detail panel (address) shows up.
  await addressButton.waitFor({ state: "visible", timeout: timeoutMs }).catch(() => {});

  // The Popular Times widget is its own slower async fetch, separate from the
  // base place data (address/category) — it can still be empty well after the
  // address button is visible (confirmed live: "Hoppers" restaurant has real
  // Popular Times data, but a flat delay wasn't enough for it to render, so
  // extraction ran against zero bar elements and returned []). Wait for an
  // actual bar element instead of guessing a fixed delay.
  //
  // Deliberately capped shorter than the request's overall timeoutMs: every
  // confirmed-successful scrape this widget has ever loaded in well under this
  // window, so waiting the full 20s budget here only makes the no-data case
  // slower for no benefit — that extra wait does nothing but delay the AI
  // fallback (ai/crowdPatternEstimate.ts) kicking in when a POI genuinely has
  // no data to find. If real data ever needs longer than this to appear, this
  // is the number to raise — but don't restore the full timeoutMs here without
  // evidence, since that directly trades away fallback latency for no upside.
  const BUSY_BAR_WAIT_MS = 8_000;
  await page
    .locator(SELECTORS.busyBar)
    .first()
    .waitFor({ state: "visible", timeout: Math.min(timeoutMs, BUSY_BAR_WAIT_MS) })
    .catch(() => {});

  // These five reads are all independent of each other once the panel's
  // loaded — running them concurrently instead of one-after-another trims
  // several separate browser round-trips down to the slowest single one.
  const [h1Texts, category, address, popularTimesByDay, liveStatus] = await Promise.all([
    page.locator(SELECTORS.placeName).allTextContents(),
    page
      .locator('button[jsaction*="category"]')
      .first()
      .textContent()
      .then((t) => (t ? stripLeadingIconGlyph(t) : null))
      .catch(() => null),
    addressButton
      .textContent()
      .then((t) => (t ? stripLeadingIconGlyph(t) : null))
      .catch(() => null),
    extractPopularTimesByDay(page),
    extractLiveStatus(page),
  ]);

  const placeName = h1Texts.map((t) => t.trim()).find(isRealPlaceHeading) ?? fallbackName;

  await warnIfDayOrderAssumptionBroke(
    page,
    Object.values(popularTimesByDay).filter((d) => d.length > 0).length
  );

  return {
    placeName,
    category,
    address,
    liveStatusText: liveStatus.text,
    liveScore: liveStatus.score,
    popularTimesByDay,
  };
}

// Launching a browser costs real time (1-3s) — paying that on every single
// request was a big chunk of the old ~20s+ total. Keep one browser process
// alive across requests instead, and only open/close a fresh PAGE per
// request (cheap, ~tens of ms). Deliberately still uses plain chromium.launch()
// (not launchServer()+connect()) — an earlier attempt to get browser-process
// access via that pair broke real scraping (see DOCUMENTATION.md), so this
// stays on the simpler, proven-correct launch() path and just holds onto the
// result instead of closing it every time.
let sharedBrowserPromise: Promise<Browser> | null = null;

async function getSharedBrowser(): Promise<Browser> {
  if (sharedBrowserPromise) {
    const existing = await sharedBrowserPromise;
    if (existing.isConnected()) return existing;
    sharedBrowserPromise = null; // crashed/closed — fall through and relaunch
  }
  sharedBrowserPromise = chromium.launch({
    headless: true,
    executablePath: env.scraper.chromiumExecutablePath,
  });
  return sharedBrowserPromise;
}

async function closeSharedBrowser(): Promise<void> {
  if (!sharedBrowserPromise) return;
  const browser = await sharedBrowserPromise.catch(() => null);
  sharedBrowserPromise = null;
  await browser?.close().catch(() => {});
}
// Best-effort — don't leave the shared browser running after the server
// itself stops. Windows signal handling in some environments is unreliable
// (see DOCUMENTATION.md §10); this is a courtesy, not a guarantee.
process.on("SIGINT", () => void closeSharedBrowser().finally(() => process.exit(0)));
process.on("SIGTERM", () => void closeSharedBrowser().finally(() => process.exit(0)));

async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  // Queued here (see concurrencyLimit.ts) before even opening a tab — under
  // load, a request past the concurrency cap waits its turn rather than
  // opening a page it can't use yet.
  return withConcurrencyLimit(() => withPageUnthrottled(fn));
}

async function withPageUnthrottled<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const browser = await getSharedBrowser();
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  });
  // Tried blocking image/font/media requests via page.route() to skip
  // downloads we never look at — measured SLOWER in practice (~4s worse,
  // consistently, both cold and warm-browser) than doing nothing. Google
  // Maps makes enough total requests that routing every one of them through
  // an interception round-trip costs more than the blocked downloads save.
  // Left out entirely rather than kept disabled — a real, tested result.
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Stale-while-revalidate wrapper shared by both public scrape entry points:
 * - FRESH cache hit → return instantly, no other work.
 * - STALE cache hit → return the stale data instantly too (never make a real
 *   user wait on a scrape just because the fresh window passed), but also
 *   kick off a background re-scrape so the NEXT request gets fresh data.
 *   Routed through the same in-flight dedup as a real miss, so concurrent
 *   stale-serves for the same key trigger at most one background refresh,
 *   not one per concurrent request.
 * - MISS (nothing cached, or past the stale window too) → this request has
 *   no choice but to wait on a real scrape, same as before caching existed.
 */
async function scrapeWithCache(cacheKey: string, run: () => Promise<ScrapedPoiData>): Promise<ScrapedPoiData> {
  const lookup = lookupCachedScrape(cacheKey);

  if (lookup.status === "fresh") {
    return lookup.data;
  }

  const refresh = () =>
    withInFlightDedup(cacheKey, async () => {
      const result = await run();
      setCachedScrape(cacheKey, result, env.scraper.cacheTtlMs, env.scraper.staleCacheTtlMs);
      return result;
    });

  if (lookup.status === "stale") {
    void refresh().catch((err) => {
      console.error(`[scraper] Background refresh failed for "${cacheKey}":`, err);
    });
    return lookup.data;
  }

  return refresh();
}

/** Scrapes a POI by free-text name/search string. Prefer `scrapePoiByPlaceId` when you have an ID. */
export async function scrapePoi(query: string, options: ScrapeOptions = {}): Promise<ScrapedPoiData> {
  const cacheKey = `query:${query.trim().toLowerCase()}`;
  return scrapeWithCache(cacheKey, () => scrapePoiUncached(query, options));
}

async function scrapePoiUncached(query: string, options: ScrapeOptions = {}): Promise<ScrapedPoiData> {
  const timeoutMs = options.timeoutMs ?? 20_000;

  return withPage(async (page) => {
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });

    const firstResultLink = page.locator('a[href*="/maps/place/"]').first();

    // A single strong match redirects to a /maps/place/... URL — but via a
    // client-side JS redirect that can fire several seconds AFTER
    // domcontentloaded, not immediately. Checking page.url() right after
    // goto() is a race: it can still read /maps/search/... even though no
    // results list exists at all for this query (confirmed live — the
    // redirect just hasn't happened yet). So race the redirect itself
    // against a result-link appearing (genuine multi-result case), then
    // re-check the URL once either wins.
    if (!page.url().includes("/maps/place/")) {
      await Promise.race([
        page.waitForURL(/\/maps\/place\//, { timeout: timeoutMs }).catch(() => {}),
        firstResultLink.waitFor({ state: "visible", timeout: timeoutMs }).catch(() => {}),
      ]);

      if (!page.url().includes("/maps/place/")) {
        await firstResultLink.click();
        await page.waitForURL(/\/maps\/place\//, { timeout: timeoutMs });
      }
    }

    const extracted = await extractPlaceData(page, timeoutMs, query);
    const url = page.url();

    return {
      query,
      placeId: parseCidFromUrl(url),
      url,
      ...parseLatLngFromUrl(url),
      scrapedAt: new Date().toISOString(),
      ...extracted,
    };
  });
}

/**
 * Scrapes a POI by its Google Places API `place_id` (e.g. "ChIJ..."). Preferred
 * over `scrapePoi` whenever you have one: navigates straight to the place with
 * no search step, so there's no redirect-timing race and no "Results" list
 * heading to filter out — the whole class of search-ambiguity bugs `scrapePoi`
 * has to work around simply doesn't apply here.
 */
export async function scrapePoiByPlaceId(
  placeId: string,
  options: ScrapeOptions = {}
): Promise<ScrapedPoiData> {
  const cacheKey = `placeId:${placeId}`;
  return scrapeWithCache(cacheKey, () => scrapePoiByPlaceIdUncached(placeId, options));
}

async function scrapePoiByPlaceIdUncached(
  placeId: string,
  options: ScrapeOptions = {}
): Promise<ScrapedPoiData> {
  const timeoutMs = options.timeoutMs ?? 20_000;

  return withPage(async (page) => {
    const requestUrl = `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
    await page.goto(requestUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });

    // A place_id that doesn't resolve to a real place (fake/malformed ID, or
    // a valid-looking ID Google can't match) doesn't error — it silently
    // lands on a generic area map view (URL like /maps/@lat,lng,zoom with no
    // /place/ segment) instead of a place page. Confirmed live: extraction
    // still "succeeds" against that view (picks up the city name as a
    // plausible h1, empty Popular Times, null category/address) and returns
    // HTTP 200 with garbage-looking data after paying the full extraction
    // timeout. Catch that here — before the expensive address/busy-bar waits.
    //
    // Must match a NAMED place segment (PLACE_PAGE_URL_RE), not just any
    // "/maps/place/" substring — the request URL we just navigated to is
    // itself "https://www.google.com/maps/place/?q=place_id:..." (no name
    // between "/place/" and the "?"), so a loose `.includes("/maps/place/")`
    // check is trivially true immediately after goto() and never actually
    // detects the failure case (confirmed live: that bug let this whole
    // check get skipped and fall through to the old 50s+ hang).
    const REDIRECT_WAIT_MS = Math.min(timeoutMs, 5_000);
    if (!PLACE_PAGE_URL_RE.test(page.url())) {
      await page.waitForURL(PLACE_PAGE_URL_RE, { timeout: REDIRECT_WAIT_MS }).catch(() => {});
    }
    if (!PLACE_PAGE_URL_RE.test(page.url())) {
      throw new Error(
        `place_id "${placeId}" did not resolve to a real Google Maps place (landed on: ${page.url()}) — ` +
          "it is likely invalid, malformed, or from a different ID namespace (see DOCUMENTATION.md on ChIJ... vs CID 0x...:0x... ids)."
      );
    }

    const extracted = await extractPlaceData(page, timeoutMs, placeId);
    const url = page.url();

    return {
      query: null,
      placeId,
      url,
      ...parseLatLngFromUrl(url),
      scrapedAt: new Date().toISOString(),
      ...extracted,
    };
  });
}
