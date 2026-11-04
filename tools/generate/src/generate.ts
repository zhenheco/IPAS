import path from "node:path";
import { loadBaseline } from "./baseline.js";
import { distribute } from "./distribute.js";
import { selectExemplars } from "./exemplars.js";
import { SoftFailure, requestJson } from "./llm.js";
import { acquireLock } from "./lock.js";
import { balancedPositions, buildRequest } from "./prompt.js";
import { officialOverlap } from "./similarity.js";
import { isVariantId, writeJsonAtomic } from "./store.js";
import { getSubject, subjectItems } from "./syllabus.js";
import type { Question, RawQuestion, SubjectNo, Syllabus, Usage } from "./types.js";

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
  /** official questions (any subject; filtered here): calibrate difficulty/style, and never be echoed by a generated stem */
  official?: Question[];
  log?: (line: string) => void;
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
  const official = (o.official ?? []).filter((q) => q.subject === n);

  const { all, validator, nextNo } = await loadBaseline(syllabus, n, outFile);

  const usage: Usage = { input: 0, output: 0 };
  let writes = Promise.resolve();
  const save = () => (writes = writes.then(() => writeJsonAtomic(outFile, all)));

  async function requestBatch(params: ReturnType<typeof buildRequest>): Promise<RawQuestion[]> {
    const parsed = await requestJson(client, params, usage, sleep);
    if (!Array.isArray(parsed?.questions)) throw new SoftFailure("response has no questions array");
    return parsed.questions;
  }

  let failed = false;
  let firstError: unknown;

  const perItem: ItemSummary[] = items.map((it, i) => {
    const before = all.filter((q) => q.item === it.code && !isVariantId(q.id)).length; // variants have their own quota
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
      const existingStems = all.filter((q) => q.item === it.code && !isVariantId(q.id)).slice(-STEMS_SHOWN).map((q) => q.stem.slice(0, STEM_PREVIEW));
      let raws: RawQuestion[];
      try {
        raws = await requestBatch(buildRequest({ subject, item: it, count, positions: balancedPositions(count, rng), existingStems, exemplars: selectExemplars(official, it.topicCode, rng) }));
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
        const copied = officialOverlap(q, official);
        if (!bad.length && copied) bad.push(copied);
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
