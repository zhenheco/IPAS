import path from "node:path";
import fsp from "node:fs/promises";
import { loadBaseline } from "./baseline.js";
import { SoftFailure, requestJson } from "./llm.js";
import { acquireLock } from "./lock.js";
import { MODEL, QUESTION_SCHEMA, balancedPositions, renderQuestion, systemPrompt } from "./prompt.js";
import { officialOverlap } from "./similarity.js";
import { writeJsonAtomic } from "./store.js";
import { getSubject, subjectItems } from "./syllabus.js";
import type { ItemRef, Question, RawQuestion, SyllabusSubject, Syllabus, Usage } from "./types.js";

/*
 * Variants: for each official question of a subject, N original questions that test the same 知識點 and reasoning
 * in a different scenario. They are filed in the normal subject file with source "original" and ids `<item>-V<NNN>`
 * (the V keeps them out of the per-item quota and out of the generator's numbering). Which variants belong to which
 * official question is recorded in .variants-progress.json ({ officialId: [variantId, ...] }) so a run resumes; ids
 * missing from the subject file no longer count and are regenerated.
 */

const VARIANT_RULES = `

變體題規則：使用者訊息會給你一題官方歷屆試題及其知識點。請針對同一個知識點、同一種推理方式，各寫全新的原創題（著作權屬於本站）。你可以參考官方題考的觀念與推理，但不得抄寫或改寫它的文字。每一題都必須：(1) 換成不同的情境，使用不同的產業、人物或實體；(2) 換成不同的數字、名稱與資料（計算題要自行重算並確認答案）；(3) 選項重新措辭，不可沿用官方選項的句子；(4) 推理步驟與難度、題幹長度和選項格式（包含「名稱：說明」的寫法）與官方題相當；(5) 各變體之間情境與考法彼此不同。`;

export interface VariantRequestArgs { subject: SyllabusSubject; item: ItemRef; source: Question; count: number; positions: number[]; existingStems: string[] }

export function buildVariantRequest({ subject, item, source, count, positions, existingStems }: VariantRequestArgs) {
  const seen = existingStems.length ? `\n\n這題官方題已有的變體題幹（避免重複情境與考法）：\n${existingStems.map((s) => `- ${s}`).join("\n")}` : "";
  const content = `科目：科目${subject.subject}「${subject.name}」（${subject.code}）
評鑑主題：${item.topicCode} ${item.topicName}
知識點：${item.code} ${item.name}

官方題目 ID：${source.id}
${renderQuestion(source)}
官方詳解：${source.explanation}

請產出 ${count} 題原創單選題，皆為這題官方題目的變體：考同一個知識點與推理，但每題要有不同的情境、不同的數字與實體，選項重新措辭。各題正確答案的位置如下（answer 為 0 起算的選項索引）：
${positions.map((p, i) => `第 ${i + 1} 題 answer = ${p}`).join("\n")}${seen}`;
  return {
    model: MODEL,
    max_tokens: 64000,
    output_config: { effort: "high" as const, format: { type: "json_schema" as const, schema: QUESTION_SCHEMA as unknown as Record<string, unknown> } },
    system: systemPrompt(subject.subject, VARIANT_RULES),
    messages: [{ role: "user" as const, content }],
  };
}

export interface VariantOptions {
  client: any; // Anthropic SDK client (only client.beta.messages.stream is used)
  syllabus: Syllabus;
  subject: 1 | 2 | 3;
  /** official questions (any subject; filtered here) */
  official: Question[];
  perQuestion: number;
  outFile: string;
  progressFile: string;
  concurrency?: number;
  maxRounds?: number;
  sleep?: (ms: number) => Promise<void>;
  rng?: () => number;
  log?: (line: string) => void;
}
export interface VariantResult { target: number; added: number; dropped: number; shortfall: number; usage: Usage; total: number }

type Progress = Record<string, string[]>;
const BATCH_MAX = 10;
const STEM_PREVIEW = 40;

async function readProgress(file: string): Promise<Progress> {
  let text: string;
  try {
    text = await fsp.readFile(file, "utf8");
  } catch (e: any) {
    if (e?.code === "ENOENT") return {};
    throw e;
  }
  const data = JSON.parse(text); // a corrupt progress file must stop the run, not be overwritten
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error(`${file} is not a JSON object`);
  return data;
}

export async function runVariants(o: VariantOptions): Promise<VariantResult> {
  const release = await acquireLock(path.join(path.dirname(o.outFile), ".generate.lock")); // same lock as runGeneration
  try {
    return await variants(o);
  } finally {
    await release();
  }
}

async function variants(o: VariantOptions): Promise<VariantResult> {
  const { client, syllabus, subject: n, perQuestion, outFile, progressFile, concurrency = 4, maxRounds = 3, sleep, rng, log = () => {} } = o;
  const subject = getSubject(syllabus, n);
  const itemOf = new Map(subjectItems(subject).map((i) => [i.code, i]));
  const official = o.official.filter((q) => q.subject === n);
  const { all, validator } = await loadBaseline(syllabus, n, outFile);

  const have = new Set(all.map((q) => q.id));
  const progress = await readProgress(progressFile);
  // The progress file is shared by all subjects: only this subject's entries are checked against this subject's file.
  for (const q of official) if (progress[q.id]) progress[q.id] = progress[q.id]!.filter((id) => have.has(id));
  const nextV: Record<string, number> = {};
  for (const q of all) {
    const m = /^(.+)-V(\d+)$/.exec(String(q.id));
    if (m) nextV[m[1]!] = Math.max(nextV[m[1]!] ?? 0, Number(m[2]));
  }

  const usage: Usage = { input: 0, output: 0 };
  let writes = Promise.resolve();
  // Progress first, then the questions: a crash in between leaves progress ids the file lacks (pruned and regenerated on
  // resume), never questions in the file that no progress entry owns (those would be generated again on top).
  // Both are copied when the save is queued: workers keep mutating the shared state while queued writes wait, and a
  // pair taken at different moments would break that guarantee.
  const save = () => {
    const progressNow = structuredClone(progress);
    const bankNow = [...all];
    return (writes = writes.then(async () => { await writeJsonAtomic(progressFile, progressNow); await writeJsonAtomic(outFile, bankNow); }));
  };

  const remaining = new Map(official.map((q) => [q.id, Math.max(0, perQuestion - (progress[q.id]?.length ?? 0))]));
  let added = 0, dropped = 0, failed = false, firstError: unknown;

  async function runOne(src: Question) {
    const item = itemOf.get(src.item);
    if (!item) throw new Error(`${src.id} has item ${src.item}, which is not in subject ${n}`);
    for (let round = 1; !failed && remaining.get(src.id)! > 0 && round <= maxRounds; round++) {
      const need = remaining.get(src.id)!;
      const count = Math.min(BATCH_MAX, need);
      const mine = (progress[src.id] ?? []).map((id) => all.find((q) => q.id === id)!.stem.slice(0, STEM_PREVIEW));
      let raws: RawQuestion[];
      try {
        const parsed = await requestJson(client, buildVariantRequest({ subject, item, source: src, count, positions: balancedPositions(count, rng), existingStems: mine }), usage, sleep);
        if (!Array.isArray(parsed?.questions)) throw new SoftFailure("response has no questions array");
        raws = parsed.questions;
      } catch (e) {
        if (!(e instanceof SoftFailure)) throw e;
        log(`${src.id} round ${round}: ${e.message}`);
        continue;
      }
      let ok = 0, bad = 0;
      for (const raw of raws) {
        if (ok >= need) break;
        const id = `${item.code}-V${String((nextV[item.code] ?? 0) + 1).padStart(3, "0")}`;
        const q = { ...raw, id, subject: n, item: item.code, source: "original" } as unknown as Question;
        const why = validator.check(q, n);
        const copied = officialOverlap(q, official);
        if (copied) why.push(copied);
        if (why.length) { bad++; log(`${src.id} dropped: ${why.join("; ")}`); continue; }
        nextV[item.code] = (nextV[item.code] ?? 0) + 1;
        validator.add(q);
        all.push(q);
        (progress[src.id] ??= []).push(id);
        ok++;
      }
      added += ok;
      dropped += bad;
      remaining.set(src.id, need - ok);
      if (ok) await save();
      log(`${src.id} ${perQuestion - remaining.get(src.id)!}/${perQuestion} (+${ok}, dropped ${bad})`);
    }
  }

  const queue = official.filter((q) => remaining.get(q.id)! > 0);
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (!failed && queue.length) {
        try {
          await runOne(queue.shift()!);
        } catch (e) {
          if (!failed) { failed = true; firstError = e; }
        }
      }
    }),
  );
  await writes;
  if (failed) throw firstError;

  return {
    target: perQuestion * official.length, added, dropped,
    shortfall: [...remaining.values()].reduce((a, b) => a + b, 0), usage, total: all.length,
  };
}
