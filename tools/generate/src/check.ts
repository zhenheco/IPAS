import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSyllabus } from "./syllabus.js";
import type { Question, Syllabus } from "./types.js";
import { QuestionValidator } from "./validate.js";

const MIN_FOR_SKEW = 20; // below this a 40% share is just noise
const SKEW_LIMIT = 0.4;

export interface PositionStat { counts: number[]; total: number; flagged: boolean }

export function positionStats(qs: Question[]): Record<number, PositionStat> {
  const out: Record<number, PositionStat> = {};
  for (const q of qs) {
    const s = (out[q.subject] ??= { counts: [0, 0, 0, 0], total: 0, flagged: false });
    s.counts[q.answer]!++;
    s.total++;
  }
  for (const s of Object.values(out)) s.flagged = s.total >= MIN_FOR_SKEW && Math.max(...s.counts) / s.total > SKEW_LIMIT;
  return out;
}

export interface CheckResult { files: { file: string; count: number }[]; errors: string[]; stats: Record<number, PositionStat> }

/**
 * `source` "original" checks data/questions (one shared duplicate baseline); "official" checks data/official, where
 * each <exam>-s<N>.json stands alone (the same question may legitimately recur across exams) and must hold 50 questions.
 */
export async function checkFiles(dir: string, syllabus: Syllabus, source: Question["source"] = "original"): Promise<CheckResult> {
  const names = (await fs.readdir(dir)).filter((f) => f.endsWith(".json") && !f.startsWith(".")).sort(); // dot-files are bookkeeping
  let validator = new QuestionValidator(syllabus, [], source);
  const errors: string[] = [];
  const good: Question[] = [];
  const files: CheckResult["files"] = [];
  for (const file of names) {
    let data: unknown;
    try {
      data = JSON.parse(await fs.readFile(path.join(dir, file), "utf8"));
    } catch (e) {
      errors.push(`${file}: unreadable (${(e as Error).message})`);
      continue;
    }
    if (!Array.isArray(data)) { errors.push(`${file}: not a JSON array`); continue; }
    files.push({ file, count: data.length });
    if (source === "official") {
      validator = new QuestionValidator(syllabus, [], source);
      if (data.length !== 50) errors.push(`${file}: ${data.length} questions, expected 50`);
    }
    const forced = /(?:^subject-|-s)(\d+)\.json$/.exec(file)?.[1];
    data.forEach((q, i) => {
      const bad = validator.check(q, forced ? Number(forced) : undefined);
      if (bad.length) errors.push(`${file}[${i}] ${(q as any)?.id ?? "?"}: ${bad.join("; ")}`);
      else { validator.add(q); good.push(q); }
    });
  }
  return { files, errors, stats: positionStats(good) };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data");
  const r = await checkFiles(path.join(root, "questions"), loadSyllabus(path.join(root, "syllabus.json")));
  for (const f of r.files) console.log(`${f.file}: ${f.count} questions`);
  for (const [subject, s] of Object.entries(r.stats)) {
    const pct = s.counts.map((c, k) => `${"ABCD"[k]} ${c} (${((c / s.total) * 100).toFixed(0)}%)`).join("  ");
    console.log(`subject ${subject} answer positions (n=${s.total}): ${pct}${s.flagged ? "  WARN: a position exceeds 40%" : ""}`);
  }
  const officialDir = path.join(root, "official");
  const off = await fs.stat(officialDir).then(() => checkFiles(officialDir, loadSyllabus(path.join(root, "syllabus.json")), "official"), () => undefined);
  for (const f of off?.files ?? []) console.log(`official/${f.file}: ${f.count} questions`);
  const errors = [...r.errors, ...(off?.errors ?? []).map((e) => `official/${e}`)];
  for (const e of errors) console.error(`ERROR ${e}`);
  console.log(errors.length ? `FAILED: ${errors.length} problem(s)` : "OK");
  process.exitCode = errors.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
