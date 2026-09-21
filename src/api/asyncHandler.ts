import { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 does not catch a rejected promise (or a thrown error) coming out
 * of an `async` route handler — it just hangs the request forever, and on
 * modern Node an unhandled rejection like that can crash the whole process,
 * taking down every other in-flight request too (confirmed: no
 * `unhandledRejection` handler existed anywhere, and every async route here
 * has at least one code path — e.g. buildCrowdIntelligence's defensive
 * "shouldn't happen" throws — that isn't wrapped in its own try/catch).
 * Wrapping every async handler with this turns any of those into an ordinary
 * caught error routed to server.ts's error middleware (a clean 500) instead.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
