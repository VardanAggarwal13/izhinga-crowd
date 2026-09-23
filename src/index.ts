import { createServer } from "./api/server";
import { assertAiKeysConfigured, env } from "./config/env";
import { ensureIndices } from "./db/mongo";

// Belt-and-suspenders: every async route is already wrapped (see
// asyncHandler.ts) so a route's own errors become clean 500s. This is the
// last-resort net for anything outside a request (a background promise, a
// bug in a future route someone forgets to wrap) — on Node 24+ an unhandled
// rejection crashes the whole process by default, taking down every other
// in-flight request with it. Logging and staying up is the right tradeoff
// for a stateless HTTP API like this one.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

// Fail fast and loud at boot, not confusingly on first real request. Without
// these, EVERY auth call fails (JWT secrets) or every DB-backed feature
// fails (Mongo — auth, festival calendar, POI anchors all depend on it) —
// but the server would otherwise start "successfully" and look healthy
// right up until someone's first login/request, making it look like a
// caller-side problem rather than a deploy misconfiguration.
const missingConfig = [
  !env.auth.accessTokenSecret && "JWT_ACCESS_SECRET",
  !env.auth.refreshTokenSecret && "JWT_REFRESH_SECRET",
  !env.mongodb.uri && "MONGODB_URI",
].filter((v): v is string => Boolean(v));

if (missingConfig.length > 0) {
  console.error(`FATAL: missing required environment variable(s): ${missingConfig.join(", ")}`);
  console.error("The server will not start without these — see .env.example / DOCUMENTATION.md §5.");
  process.exit(1);
}

const app = createServer();

app.listen(env.port, async () => {
  const ai = assertAiKeysConfigured();
  console.log(`iZhinga Crowd API listening on port ${env.port}`);
  console.log(`AI providers configured — OpenAI: ${ai.openai}, Gemini: ${ai.gemini}`);

  // Initialize database indices for optimized query performance
  await ensureIndices();
});
