import { describe, expect, it, vi } from "vitest";
import { createRateLimitLoader } from "./rate-limit-refresh";
import type { RateLimitsPayload } from "./types";

function payload(accountId: string): RateLimitsPayload {
  return {
    scannedAt: 1,
    windowDays: 2,
    accounts: [{ accountId, limited: [{ model: "fixture", resetAt: 99999, firstSeenAt: 1, hitCount: 1 }] }],
  };
}

function deferred() {
  let resolve!: (value: RateLimitsPayload) => void;
  const promise = new Promise<RateLimitsPayload>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("rate limit refresh", () => {
  it("loads immediately, debounces fetches and ignores the backend scan age", async () => {
    let now = 0;
    const fetch = vi.fn().mockResolvedValue(payload("a"));
    const publish = vi.fn();
    const loader = createRateLimitLoader(fetch, publish, () => now);
    await loader.refresh();
    await loader.refresh();
    expect(fetch).toHaveBeenCalledTimes(1);
    now = 60_000;
    await loader.refresh();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(publish.mock.lastCall?.[0].a).toHaveLength(1);
  });

  it("retains the last ledger on failure and clears it only on successful recovery", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(payload("a"))
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({ scannedAt: 2, windowDays: 2, accounts: [] });
    const publish = vi.fn();
    const loader = createRateLimitLoader(fetch, publish);
    await loader.refresh(true);
    await loader.refresh(true);
    expect(publish).toHaveBeenCalledTimes(1);
    await loader.refresh(true);
    expect(publish.mock.lastCall?.[0]).toEqual({});
  });

  it("allows a forced update and rejects an older response arriving afterwards", async () => {
    const old = deferred();
    const latest = deferred();
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const publish = vi.fn();
    const loader = createRateLimitLoader(fetch, publish);
    const first = loader.refresh();
    const second = loader.refresh(true);
    latest.resolve(payload("latest"));
    await second;
    old.resolve(payload("old"));
    await first;
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.lastCall?.[0].latest).toHaveLength(1);
  });

  it("drops responses after disabling or unmounting and allows immediate reload", async () => {
    const pending = deferred();
    const fetch = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(payload("new"));
    const publish = vi.fn();
    const loader = createRateLimitLoader(fetch, publish);
    const first = loader.refresh();
    loader.invalidate();
    pending.resolve(payload("old"));
    await first;
    expect(publish).not.toHaveBeenCalled();
    await loader.refresh();
    expect(publish.mock.lastCall?.[0].new).toHaveLength(1);
  });
});
