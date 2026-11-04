const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 429, 5xx (incl. 529 overloaded), overloaded_error bodies and connection failures. */
export function isRetryable(err: any): boolean {
  if (typeof err?.status === "number") return err.status === 429 || err.status >= 500;
  if (err?.error?.error?.type === "overloaded_error") return true;
  return /^APIConnection/.test(err?.name ?? "") || /^APIConnection/.test(err?.constructor?.name ?? "");
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  { retries = 6, baseMs = 1000, sleep = sleepMs }: { retries?: number; baseMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      if (attempt >= retries || !isRetryable(e)) throw e;
      const retryAfter = Number(e?.headers?.get?.("retry-after")) * 1000 || 0;
      await sleep(Math.max(retryAfter, Math.min(60_000, baseMs * 2 ** attempt) + Math.random() * baseMs));
    }
  }
}
