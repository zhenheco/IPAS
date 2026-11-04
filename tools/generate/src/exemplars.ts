import fsp from "node:fs/promises";
import path from "node:path";
import type { Question, Syllabus } from "./types.js";
import { QuestionValidator } from "./validate.js";

/** Official question files are named <exam>-s<subject>.json (e.g. 115-1-s3.json); the .partial resume files and raw/ are not. */
const OFFICIAL_FILE = /^\d+-\d+-s[123]\.json$/;

/** All official questions of `subject` in `dir` (data/official). A missing directory means "not calibrated yet". */
export async function loadOfficial(dir: string, subject: number): Promise<Question[]> {
  const names = (await fsp.readdir(dir).catch(() => [] as string[])).filter((f) => OFFICIAL_FILE.test(f)).sort();
  const out: Question[] = [];
  for (const f of names) {
    let data: unknown;
    try {
      data = JSON.parse(await fsp.readFile(path.join(dir, f), "utf8"));
      if (!Array.isArray(data)) throw new Error("not a JSON array");
    } catch (e) {
      throw new Error(`cannot read ${path.join(dir, f)}: ${(e as Error).message}`);
    }
    out.push(...(data as Question[]).filter((q) => q?.subject === subject));
  }
  return out;
}

function shuffle<T>(a: T[], rng: () => number): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [r[i], r[j]] = [r[j]!, r[i]!];
  }
  return r;
}

/**
 * A rotating sample of 6-8 official questions to use as style exemplars: the 評鑑主題's own questions first
 * (知識點 codes start with their 評鑑主題 code), then the rest of the subject. Call again per batch to rotate.
 */
export function selectExemplars(official: Question[], topicCode: string, rng: () => number = Math.random): Question[] {
  const n = 6 + Math.floor(rng() * 3);
  const same = official.filter((q) => q.item.startsWith(topicCode));
  const rest = official.filter((q) => !q.item.startsWith(topicCode));
  return [...shuffle(same, rng), ...shuffle(rest, rng)].slice(0, n);
}

/** Generating without enough official questions would be uncalibrated, so it is refused (selectExemplars shows 6-8). */
export const MIN_EXEMPLARS = 6;

/** The official questions of `subject` that pass validation; throws unless there are at least MIN_EXEMPLARS. */
export function requireExemplars(official: Question[], syllabus: Syllabus, subject: number): Question[] {
  const validator = new QuestionValidator(syllabus, [], "official");
  const valid = official.filter((q) => {
    if (q?.subject !== subject || validator.check(q, subject).length) return false;
    validator.add(q);
    return true;
  });
  if (valid.length < MIN_EXEMPLARS)
    throw new Error(`generation needs at least ${MIN_EXEMPLARS} valid official questions of subject ${subject} in data/official as exemplars, found ${valid.length}; run import-official first`);
  return valid;
}
