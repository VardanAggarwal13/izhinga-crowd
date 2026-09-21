/**
 * Caps how many scrapes can run at once on the one shared browser (see
 * withPage() in googleMaps.ts). Nothing enforced this before — under real
 * concurrent load, an unbounded number of simultaneous page navigations on
 * one browser process risks the browser itself getting overwhelmed (CPU,
 * memory, and Google noticing a suspicious burst of simultaneous traffic
 * from one source), which would slow down every in-flight scrape together
 * rather than just queueing the excess ones politely.
 *
 * A simple FIFO semaphore, not a rejection — a request past the limit waits
 * its turn instead of failing outright. Requests already being served from
 * cache (the common case, see cache.ts) never touch this at all, since they
 * never call withPage() in the first place.
 */
import { env } from "../config/env";

let activeCount = 0;
const queue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (activeCount < env.scraper.maxConcurrentScrapes) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    queue.push(() => {
      activeCount++;
      resolve();
    });
  });
}

function release(): void {
  activeCount--;
  const next = queue.shift();
  if (next) next();
}

export async function withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
