import { createServer } from "./api/server";
import { assertAiKeysConfigured, env } from "./config/env";

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

const app = createServer();

app.listen(env.port, () => {
  const ai = assertAiKeysConfigured();
  console.log(`iZhinga Crowd API listening on port ${env.port}`);
  console.log(`AI providers configured — OpenAI: ${ai.openai}, Gemini: ${ai.gemini}`);
});
