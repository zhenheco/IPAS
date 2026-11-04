import fsp from "node:fs/promises";
import path from "node:path";
import { distribute } from "./distribute.js";
import { acquireLock } from "./lock.js";
import { MODEL, balancedPositions, buildRequest } from "./prompt.js";
import { withRetry } from "./retry.js";
import { readQuestions, writeJsonAtomic } from "./store.js";
import { getSubject, subjectItems } from "./syllabus.js";
import type { Question, RawQuestion, SubjectNo, Syllabus, Usage } from "./types.js";
import { QuestionValidator } from "./validate.js";

/** A failed batch that is worth another round (bad JSON, truncated, refused); everything else aborts the run. */
class SoftFailure extends Error {}

export interface ItemSummary { code: string; target: number; before: number; added: number; dropped: number; rounds: number }
export interface GenerationResult { perItem: ItemSummary[]; usage: Usage; shortfall: number; total: number }

export interface GenerationOptions {
  client: any; // Anthropic SDK client (only client.beta.messages.stream is used)
  syllabus: Syllabus;
  subject: SubjectNo;
  total: number;
  outFile: string;
  concurrency?: number;
  batchSize?: number;
  maxRounds?: number;
  sleep?: (ms: number) => Promise<void>;
  rng?: () => number;
  log?: (line: string) => void;
}

/** Every question in the sibling *.json files (sample.json, the other subjects): duplicate baseline only, never quota. */
async function readOtherQuestions(outFile: string): Promise<Question[]> {
  const dir = path.dirname(outFile);
  const names = (await fsp.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".json") && path.join(dir, f) !== outFile);
  const out: Question[] = [];
  for (const f of names) {
    try {
      const data = JSON.parse(await fsp.readFile(path.join(dir, f), "utf8"));
      if (!Array.isArray(data)) throw new Error("not a JSON array");
      out.push(...data);
    } catch (e) {
      throw new Error(`cannot read ${path.join(dir, f)} for the duplicate check: ${(e as Error).message}`);
    }
  }
  return out;
}

const STEM_PREVIEW = 40;
const STEMS_SHOWN = 30;

export async function runGeneration(o: GenerationOptions): Promise<GenerationResult> {
  const release = await acquireLock(path.join(path.dirname(o.outFile), ".generate.lock")) // one lock per directory: subjects share the duplicate baseline;
  try {
    return await generate(o);
  } finally {
    await release();
  }
}

async function generate(o: GenerationOptions): Promise<GenerationResult> {
  const { client, syllabus, subject: n, total, outFile, concurrency = 4, batchSize = 10, sleep, rng, log = () => {} } = o;
  const subject = getSubject(syllabus, n);
  const items = subjectItems(subject);
  const targets = distribute(total, items.length);

  const all = await readQuestions(outFile);
  // Sibling files first, so an existing question that duplicates one of theirs is reported, not counted.
  const others = await readOtherQuestions(outFile);
  const validator = new QuestionValidator(syllabus, others);
  const invalid: string[] = [];
  for (const q of all) {
    const bad = validator.check(q, n);
    if (bad.length) invalid.push(`${(q as any)?.id ?? "?"} (${bad.join("; ")})`);
    else validator.add(q);
  }
  if (invalid.length) throw new Error(`${outFile} has ${invalid.length} invalid question(s); fix or remove them, then re-run:\n  ${invalid.join("\n  ")}`);
  const nextNo: Record<string, number> = {};
  // Numbering continues after the highest id with that prefix anywhere in the directory.
  for (const q of [...all, ...others]) {
    const m = /^(.+)-(\d+)$/.exec(String(q?.id));
    if (m) nextNo[m[1]!] = Math.max(nextNo[m[1]!] ?? 0, Number(m[2]));
  }

  const usage: Usage = { input: 0, output: 0 };
  let writes = Promise.resolve();
  const save = () => (writes = writes.then(() => writeJsonAtomic(outFile, all)));

  async function requestBatch(params: ReturnType<typeof buildRequest>): Promise<RawQuestion[]> {
    const msg: any = await withRetry(() => client.beta.messages.stream(params).finalMessage(), { sleep });
    usage.input += msg.usage?.input_tokens ?? 0;
    usage.output += msg.usage?.output_tokens ?? 0;
    if (typeof msg.model !== "string" || !msg.model.startsWith(MODEL)) throw new SoftFailure(`served by ${msg.model ?? "unknown model"}, not ${MODEL}`);
    if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") throw new SoftFailure(`stop_reason ${msg.stop_reason}`);
    const text = (msg.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join("");
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new SoftFailure("response is not valid JSON");
    }
    if (!Array.isArray(parsed?.questions)) throw new SoftFailure("response has no questions array");
    return parsed.questions;
  }

  let failed = false;
  let firstError: unknown;

  const perItem: ItemSummary[] = items.map((it, i) => {
    const before = all.filter((q) => q.item === it.code).length;
    return { code: it.code, target: targets[i]!, before, added: 0, dropped: 0, rounds: 0 };
  });

  async function runItem(i: number) {
    const it = items[i]!;
    const s = perItem[i]!;
    const maxRounds = o.maxRounds ?? Math.ceil((s.target - s.before) / batchSize) + 4;
    while (!failed && s.before + s.added < s.target && s.rounds < maxRounds) {
      s.rounds++;
      const need = s.target - s.before - s.added;
      const count = Math.min(batchSize, need);
      const existingStems = all.filter((q) => q.item === it.code).slice(-STEMS_SHOWN).map((q) => q.stem.slice(0, STEM_PREVIEW));
      let raws: RawQuestion[];
      try {
        raws = await requestBatch(buildRequest({ subject, item: it, count, positions: balancedPositions(count, rng), existingStems }));
      } catch (e) {
        if (!(e instanceof SoftFailure)) throw e;
        log(`${it.code} round ${s.rounds}: ${e.message}`);
        continue;
      }
      let added = 0, dropped = 0;
      for (const raw of raws) {
        if (added >= need) break;
        const no = (nextNo[it.code] ?? 0) + 1;
        const q = { ...raw, id: `${it.code}-${String(no).padStart(3, "0")}`, subject: n, item: it.code, source: "original" } as unknown as Question;
        const bad = validator.check(q, n);
        if (bad.length) { dropped++; log(`${it.code} dropped: ${bad.join("; ")}`); continue; }
        nextNo[it.code] = no;
        validator.add(q);
        all.push(q);
        added++;
      }
      s.added += added;
      s.dropped += dropped;
      if (added) await save();
      log(`${it.code} ${s.before + s.added}/${s.target} (+${added}, dropped ${dropped})`);
    }
  }

  const queue = items.map((_, i) => i).filter((i) => perItem[i]!.before < perItem[i]!.target);
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (!failed && queue.length) {
        try {
          await runItem(queue.shift()!);
        } catch (e) {
          if (!failed) { failed = true; firstError = e; }
        }
      }
    }),
  );
  await writes;
  if (failed) throw firstError;

  const shortfall = perItem.reduce((a, s) => a + Math.max(0, s.target - s.before - s.added), 0);
  return { perItem, usage, shortfall, total: all.length };
}
