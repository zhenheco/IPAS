import type { Question, Syllabus } from "./types.js";

/** Stem identity for duplicate detection: ignores width, case, whitespace and punctuation. */
export function normalizeStem(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** Pure validation against the syllabus and the questions accepted so far. `check` never mutates; call `add` on accept. */
export class QuestionValidator {
  private ids = new Set<string>();
  private stems = new Set<string>();

  constructor(private syllabus: Syllabus, existing: Question[] = [], private source: Question["source"] = "original") {
    for (const q of existing) this.add(q);
  }

  add(q: Question): void {
    if (typeof q?.id === "string") this.ids.add(q.id);
    if (typeof q?.stem === "string") this.stems.add(normalizeStem(q.stem));
  }

  /** Returns the reasons the question is invalid; empty means valid. */
  check(q: unknown, requestedSubject?: number): string[] {
    if (typeof q !== "object" || q === null || Array.isArray(q)) return ["not an object"];
    const r = q as Record<string, unknown>;
    const bad: string[] = [];

    if (!nonEmpty(r.id)) bad.push("id missing");
    else if (this.ids.has(r.id)) bad.push(`duplicate id ${r.id}`);

    const subject = this.syllabus.subjects.find((s) => s.subject === r.subject);
    if (!subject) bad.push(`unknown subject ${String(r.subject)}`);
    else if (requestedSubject !== undefined && subject.subject !== requestedSubject)
      bad.push(`subject ${subject.subject} != requested ${requestedSubject}`);
    if (subject && !subject.topics.some((t) => t.items.some((i) => i.code === r.item)))
      bad.push(`item ${String(r.item)} is not in subject ${subject.subject}`);

    for (const k of ["stem", "explanation", "related"] as const) if (!nonEmpty(r[k])) bad.push(`${k} empty`);

    const o = r.options;
    if (!Array.isArray(o) || o.length !== 4) bad.push("options must be exactly 4");
    else if (!o.every(nonEmpty)) bad.push("option empty or not a string");
    else if (new Set(o.map((x) => x.trim())).size !== 4) bad.push("options not distinct");

    if (!Number.isInteger(r.answer) || (r.answer as number) < 0 || (r.answer as number) > 3) bad.push("answer must be 0..3");
    if (r.source !== this.source) bad.push(`source must be "${this.source}"`);

    if (nonEmpty(r.stem) && this.stems.has(normalizeStem(r.stem))) bad.push("duplicate stem");
    return bad;
  }
}
