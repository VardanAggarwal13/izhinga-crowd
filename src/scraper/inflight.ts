/**
 * Collapses concurrent requests for the SAME uncached place into one shared
 * scrape. Without this, two users checking the same popular POI within the
 * same second each trigger a full, separate ~10-15s scrape — wasted work,
 * and doubles the load on the one shared browser for no benefit, since both
 * would get functionally the same answer anyway.
 */
const inFlight = new Map<string, Promise<unknown>>();

export function withInFlightDedup<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = run().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}
