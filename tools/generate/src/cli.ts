import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runGeneration, type GenerationResult } from "./generate.js";
import { loadSyllabus } from "./syllabus.js";

export function requireApiKey(env: Record<string, string | undefined>): string {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set. Export it first: export ANTHROPIC_API_KEY=sk-ant-...");
  return key;
}

export interface Args { subject: 1 | 2 | 3; total: number; concurrency: number }

export function parseArgs(argv: string[]): Args {
  const v: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]!;
    if (!["--subject", "--total", "--concurrency"].includes(k) || argv[i + 1] === undefined) throw new Error(`bad argument: ${k}`);
    v[k.slice(2)] = argv[i + 1]!;
  }
  const int = (name: string, def?: number) => {
    const raw = v[name] ?? (def === undefined ? undefined : String(def));
    if (raw === undefined || !/^\d+$/.test(raw) || Number(raw) < 1) throw new Error(`--${name} must be a positive integer`);
    return Number(raw);
  };
  const subject = int("subject");
  if (subject > 3) throw new Error("--subject must be 1, 2 or 3");
  return { subject: subject as 1 | 2 | 3, total: int("total"), concurrency: int("concurrency", 4) };
}

export function formatSummary(r: GenerationResult): string {
  const rows = r.perItem.map((s) => `${s.code}  ${s.before + s.added}/${s.target}  (new ${s.added}, dropped ${s.dropped}, rounds ${s.rounds})`);
  return [
    ...rows,
    `total in file: ${r.total}`,
    `tokens: ${r.usage.input} in / ${r.usage.output} out`,
    r.shortfall ? `SHORTFALL: ${r.shortfall} question(s) missing; re-run the same command to resume` : "all items complete",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const key = requireApiKey(process.env);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data");
  const result = await runGeneration({
    // maxRetries 0: withRetry owns retries/backoff.
    client: new Anthropic({ apiKey: key, maxRetries: 0 }),
    syllabus: loadSyllabus(path.join(root, "syllabus.json")),
    subject: args.subject,
    total: args.total,
    concurrency: args.concurrency,
    outFile: path.join(root, "questions", `subject-${args.subject}.json`),
    log: console.log,
  });
  console.log("\n" + formatSummary(result));
  process.exitCode = result.shortfall ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(`ERROR: ${e?.message ?? e}`);
    process.exitCode = 1;
  });
}
