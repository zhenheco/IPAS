import { MODEL } from "./prompt.js";
import { withRetry } from "./retry.js";
import type { Usage } from "./types.js";

/** A response that is worth another round (bad JSON, truncated, refused, wrong model); everything else aborts the run. */
export class SoftFailure extends Error {}

/**
 * One structured-output call. Streams (large max_tokens), retries transport errors, then insists on the model we
 * asked for (no silent fallback) and on a complete, parseable JSON object. Token usage is added to `usage`.
 */
export async function requestJson(client: any, params: unknown, usage: Usage, sleep?: (ms: number) => Promise<void>): Promise<any> {
  const msg: any = await withRetry(() => client.beta.messages.stream(params).finalMessage(), { sleep });
  usage.input += msg.usage?.input_tokens ?? 0;
  usage.output += msg.usage?.output_tokens ?? 0;
  if (typeof msg.model !== "string" || !msg.model.startsWith(MODEL)) throw new SoftFailure(`served by ${msg.model ?? "unknown model"}, not ${MODEL}`);
  if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") throw new SoftFailure(`stop_reason ${msg.stop_reason}`);
  const text = (msg.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    return JSON.parse(text);
  } catch {
    throw new SoftFailure("response is not valid JSON");
  }
}
