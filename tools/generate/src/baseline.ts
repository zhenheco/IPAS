import { readOtherQuestions, readQuestions } from "./store.js";
import type { Question, Syllabus } from "./types.js";
import { QuestionValidator } from "./validate.js";

export interface Baseline {
  /** the questions already in outFile (mutated by the caller as it adds more) */
  all: Question[];
  validator: QuestionValidator;
  /** highest `<prefix>-<number>` id per prefix anywhere in the directory, so numbering continues */
  nextNo: Record<string, number>;
}

/** Everything a run must know before adding questions to outFile; throws if outFile already holds invalid questions. */
export async function loadBaseline(syllabus: Syllabus, subject: number, outFile: string): Promise<Baseline> {
  const all = await readQuestions(outFile);
  // Sibling files first, so an existing question that duplicates one of theirs is reported, not counted.
  const others = await readOtherQuestions(outFile);
  const validator = new QuestionValidator(syllabus, others);
  const invalid: string[] = [];
  for (const q of all) {
    const bad = validator.check(q, subject);
    if (bad.length) invalid.push(`${(q as any)?.id ?? "?"} (${bad.join("; ")})`);
    else validator.add(q);
  }
  if (invalid.length) throw new Error(`${outFile} has ${invalid.length} invalid question(s); fix or remove them, then re-run:\n  ${invalid.join("\n  ")}`);
  const nextNo: Record<string, number> = {};
  for (const q of [...all, ...others]) {
    const m = /^(.+)-(\d+)$/.exec(String(q?.id));
    if (m) nextNo[m[1]!] = Math.max(nextNo[m[1]!] ?? 0, Number(m[2]));
  }
  return { all, validator, nextNo };
}
