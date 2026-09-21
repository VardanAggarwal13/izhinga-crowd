import "dotenv/config";

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export const env = {
  nodeEnv: optional("NODE_ENV", "development"),
  port: Number(optional("PORT", "3000")),

  // Primary historical-analysis provider.
  openai: {
    apiKey: optional("OPENAI_API_KEY"),
    model: optional("OPENAI_MODEL", "gpt-4o"),
  },
  // Secondary — cross-checks OpenAI's answer (see ai/historicalAnalysis.ts).
  gemini: {
    apiKey: optional("GEMINI_API_KEY"),
    model: optional("GEMINI_MODEL", "gemini-2.5-flash"),
  },
  // Auto-detects D_weather from the POI's real coordinates when the caller
  // doesn't send `weather` themselves (see src/weather/autoDetectWeather.ts).
  // Unset just means auto-detection quietly no-ops — `weather` stays
  // whatever the caller sent (or unset).
  googleWeather: {
    apiKey: optional("GOOGLE_WEATHER_API_KEY"),
  },
  scraper: {
    // Only needed as a local-machine workaround (see DOCUMENTATION.md's Windows dev note).
    // Leave unset in Docker/Linux hosts — Playwright resolves its own bundled browser fine there.
    chromiumExecutablePath: optional("CHROMIUM_EXECUTABLE_PATH") || undefined,
    // "Fresh" window — a cache hit within this returns instantly with no
    // background work at all. Popular Times' hourly pattern barely moves
    // minute to minute, so an hour is a safe default: real traffic (many
    // users checking the same popular place within the same hour) gets
    // millisecond responses almost every time.
    cacheTtlMs: Number(optional("SCRAPE_CACHE_TTL_MS", String(60 * 60 * 1000))),
    // "Stale but still instant" window, on top of the fresh one — a hit in
    // this range still returns the cached data immediately, but also kicks
    // off a background re-scrape to refresh it for the next request (see
    // scraper/cache.ts / googleMaps.ts). This is what makes stale-while-
    // revalidate work: past this combined window, there's truly nothing
    // cached and a request has to wait on a real scrape.
    staleCacheTtlMs: Number(optional("SCRAPE_STALE_CACHE_TTL_MS", String(24 * 60 * 60 * 1000))),
    // How many scrapes can run at once on the one shared browser (see
    // scraper/concurrencyLimit.ts). Past this, requests queue instead of
    // piling unbounded load onto one browser process. 6 is a conservative
    // starting point, not a measured ceiling — raise it if the host has
    // headroom (CPU/memory) to spare, lower it if scrapes start timing out
    // under real concurrent load.
    maxConcurrentScrapes: Number(optional("SCRAPE_MAX_CONCURRENCY", "6")),
  },

  mongodb: {
    uri: optional("MONGODB_URI") || undefined,
    dbName: optional("MONGODB_DB_NAME", "izhinga"),
  },

  // API authentication (see src/auth/) — client_id/client_secret ->
  // short-lived access JWT + rotating 7-day refresh JWT. Deliberately two
  // DIFFERENT secrets (not one shared secret) so a leaked access-token
  // secret can't be used to forge refresh tokens or vice versa. No
  // fallback default on purpose — an auth secret with a baked-in default
  // is a real vulnerability if someone forgets to set it in production;
  // src/auth/tokens.ts throws clearly at first use instead.
  auth: {
    accessTokenSecret: optional("JWT_ACCESS_SECRET") || undefined,
    refreshTokenSecret: optional("JWT_REFRESH_SECRET") || undefined,
    accessTokenTtl: optional("JWT_ACCESS_TTL", "1h"),
    refreshTokenTtl: optional("JWT_REFRESH_TTL", "7d"),
    refreshTokenTtlMs: 7 * 24 * 60 * 60 * 1000,
  },
};

export function assertAiKeysConfigured(): { openai: boolean; gemini: boolean } {
  return {
    openai: Boolean(env.openai.apiKey),
    gemini: Boolean(env.gemini.apiKey),
  };
}
