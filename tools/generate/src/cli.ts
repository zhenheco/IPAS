import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOfficial, requireExemplars } from "./exemplars.js";
import { runGeneration, type GenerationResult } from "./generate.js";
import { loadSyllabus } from "./syllabus.js";
import { SUBJECT_NOS, type SubjectNo } from "./types.js";
import { runVariants } from "./variants.js";

export function requireApiKey(env: Record<string, string | undefined>): string {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set. Export it first: export ANTHROPIC_API_KEY=sk-ant-...");
  return key;
}

export interface Args {
  subject: SubjectNo;
  /** per-item quota mode: total questions for the subject */
  total?: number;
  /** variants mode: original variants per official question (separate quota, see variants.ts) */
  variants?: number;
  concurrency: number;
}

export function parseArgs(argv: string[]): Args {
  const v: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]!;
    if (!["--subject", "--total", "--variants", "--concurrency"].includes(k) || argv[i + 1] === undefined) throw new Error(`bad argument: ${k}`);
    v[k.slice(2)] = argv[i + 1]!;
  }
  const int = (name: string, def?: number) => {
    const raw = v[name] ?? (def === undefined ? undefined : String(def));
    if (raw === undefined || !/^\d+$/.test(raw) || Number(raw) < 1) throw new Error(`--${name} must be a positive integer`);
    return Number(raw);
  };
  const subject = int("subject");
  if (!SUBJECT_NOS.includes(subject as SubjectNo)) throw new Error("--subject must be 1, 2, 3 (中級) or 11, 12 (初級)");
  if (v.total !== undefined && v.variants !== undefined) throw new Error("use either --total or --variants, not both");
  if (v.total === undefined && v.variants === undefined) throw new Error("--total or --variants is required");
  if (v.variants !== undefined && subject > 3) throw new Error("--variants needs official questions, which exist only for 中級 (1, 2, 3)");
  return {
    subject: subject as SubjectNo,
    ...(v.variants === undefined ? { total: int("total") } : { variants: int("variants") }),
    concurrency: int("concurrency", 4),
  };
}

/** Variants are adaptations of official questions (not allowed to be published, ADR 0004): they live in the git-ignored data/official, never data/questions. */
export function variantPaths(root: string, subject: number) {
  const dir = path.join(root, "official", "variants");
  return { outFile: path.join(dir, `subject-${subject}.json`), progressFile: path.join(dir, ".variants-progress.json") };
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
  // maxRetries 0: withRetry owns retries/backoff.
  const client = new Anthropic({ apiKey: key, maxRetries: 0 });
  const syllabus = loadSyllabus(path.join(root, "syllabus.json"));
  const outFile = path.join(root, "questions", `subject-${args.subject}.json`);
  const official = await loadOfficial(path.join(root, "official"), args.subject);
  if (args.variants !== undefined) {
    if (!official.length) throw new Error(`no official questions for subject ${args.subject} in data/official; run import-official first`);
    const r = await runVariants({
      client, syllabus, subject: args.subject as 1 | 2 | 3, official, perQuestion: args.variants, concurrency: args.concurrency,
      ...variantPaths(root, args.subject), log: console.log,
    });
    console.log(`\nvariants: ${r.target - r.shortfall}/${r.target} (new ${r.added}, dropped ${r.dropped})`);
    console.log(`total in file: ${r.total}\ntokens: ${r.usage.input} in / ${r.usage.output} out`);
    console.log(r.shortfall ? `SHORTFALL: ${r.shortfall} variant(s) missing; re-run the same command to resume` : "all variants complete");
    process.exitCode = r.shortfall ? 1 : 0;
    return;
  }
  // 初級 has no imported official questions yet: generate uncalibrated until some are imported
  const uncalibrated = args.subject > 3 && !official.some((q) => q.subject === args.subject);
  const exemplars = uncalibrated ? [] : requireExemplars(official, syllabus, args.subject);
  console.log(uncalibrated ? `no official questions for 初級 subject ${args.subject}: generating without calibration` : `calibrating against ${exemplars.length} official question(s) of subject ${args.subject}`);
  const result = await runGeneration({
    client, syllabus, subject: args.subject, total: args.total!, concurrency: args.concurrency, outFile, official: exemplars, log: console.log,
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
