import { afterEach, describe, expect, it, vi } from "vitest";
import { UPDATE_CHECK_TIMEOUT_MS, UpdateCheckTimeoutError, waitForUpdateCheck } from "./update-check";

afterEach(() => vi.useRealTimers());

describe("update check deadline", () => {
  it("stops waiting for a native request that never responds", async () => {
    vi.useFakeTimers();
    const checked = waitForUpdateCheck(new Promise(() => {}));
    const rejected = expect(checked).rejects.toBeInstanceOf(UpdateCheckTimeoutError);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_TIMEOUT_MS);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns a real response and removes its pending deadline", async () => {
    vi.useFakeTimers();
    const result = { ok: true, hasUpdate: true };
    await expect(waitForUpdateCheck(Promise.resolve(result))).resolves.toEqual(result);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves native errors without leaving a timer behind", async () => {
    vi.useFakeTimers();
    const error = new Error("native check rejected");
    await expect(waitForUpdateCheck(Promise.reject(error))).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });
});
