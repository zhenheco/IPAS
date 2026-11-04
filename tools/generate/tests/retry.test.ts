import { describe, expect, it, vi } from "vitest";
import { isRetryable, withRetry } from "../src/retry.js";

const err = (status?: number, extra: object = {}) => Object.assign(new Error("x"), { status, ...extra });

describe("isRetryable", () => {
  it.each([429, 500, 502, 503, 529])("retries %i", (s) => expect(isRetryable(err(s))).toBe(true));
  it("retries overloaded_error bodies", () =>
    expect(isRetryable(err(undefined, { error: { error: { type: "overloaded_error" } } }))).toBe(true));
  it("retries connection errors (no status)", () =>
    expect(isRetryable(Object.assign(new Error("c"), { name: "APIConnectionError" }))).toBe(true));
  it.each([400, 401, 403, 404])("does not retry %i", (s) => expect(isRetryable(err(s))).toBe(false));
  it("does not retry plain errors", () => expect(isRetryable(new Error("boom"))).toBe(false));
});

describe("withRetry", () => {
  it("returns on first success", async () => {
    const fn = vi.fn().mockResolvedValue(1);
    expect(await withRetry(fn, { sleep: async () => {} })).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("retries retryable errors with growing backoff", async () => {
    const fn = vi.fn().mockRejectedValueOnce(err(429)).mockRejectedValueOnce(err(529)).mockResolvedValue("ok");
    const delays: number[] = [];
    const out = await withRetry(fn, { baseMs: 100, sleep: async (ms) => void delays.push(ms) });
    expect(out).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(delays).toHaveLength(2);
    expect(delays[1]!).toBeGreaterThan(delays[0]!);
  });
  it("throws immediately on non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue(err(401));
    await expect(withRetry(fn, { sleep: async () => {} })).rejects.toMatchObject({ status: 401 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("gives up after `retries` retries and rethrows", async () => {
    const fn = vi.fn().mockRejectedValue(err(500));
    await expect(withRetry(fn, { retries: 2, sleep: async () => {} })).rejects.toMatchObject({ status: 500 });
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
