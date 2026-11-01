import type { RateLimitEntry, RateLimitsPayload } from "./types";

const FETCH_FLOOR_MS = 20_000;

/** Keep the last successful ledger; late responses must not replace newer ones. */
export function createRateLimitLoader(
  fetchLimits: () => Promise<RateLimitsPayload>,
  publish: (map: Record<string, RateLimitEntry[]>) => void,
  now: () => number = Date.now,
) {
  let lastFetch: number | undefined;
  let generation = 0;

  return {
    invalidate() {
      generation += 1;
      lastFetch = undefined;
    },
    async refresh(force = false) {
      const started = now();
      if (!force && lastFetch !== undefined && started - lastFetch < FETCH_FLOOR_MS) return;
      lastFetch = started;
      const request = ++generation;
      try {
        const payload = await fetchLimits();
        if (request !== generation) return;
        const next: Record<string, RateLimitEntry[]> = {};
        for (const account of payload.accounts ?? []) {
          if (account.limited?.length) next[account.accountId] = account.limited;
        }
        publish(next);
      } catch {
        // A temporary error does not prove any model's quota has recovered.
      }
    },
  };
}
