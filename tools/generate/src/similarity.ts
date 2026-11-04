import type { Question, RawQuestion } from "./types.js";
import { normalizeStem } from "./validate.js";

/** A variant (or generated question) whose stem reaches this overlap with an official stem is rejected. */
export const SIMILARITY_LIMIT = 0.5;
const N = 4;

function grams(s: string): Set<string> {
  const t = normalizeStem(s);
  // Text shorter than N characters is one gram, so identical short stems still match.
  return new Set(t.length < N ? (t ? [t] : []) : Array.from({ length: t.length - N + 1 }, (_, i) => t.slice(i, i + N)));
}

/** Jaccard similarity of the character 4-gram sets of two stems, after the same normalisation the duplicate check uses. */
export function ngramJaccard(a: string, b: string): number {
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared++;
  return shared / (A.size + B.size - shared);
}

export const tooSimilar = (a: string, b: string): boolean => ngramJaccard(a, b) >= SIMILARITY_LIMIT;

/*
 * Shorter normalised text than this is too generic to count as copying ("Precision", "詳解：甲正確"): the same short
 * option or note legitimately appears in unrelated questions. Real official options and explanations are longer.
 */
const MIN_OPTION_LEN = 12;
const MIN_NOTE_LEN = 20;
const LETTERS = "ABCD";
/** Any run this long (normalised characters) shared with any official text field, in any field of the question, is a copy. */
const VERBATIM_RUN = 20;

const textFields = (q: Pick<RawQuestion, "stem" | "options" | "explanation" | "related">) => [q.stem, ...(q.options ?? []), q.explanation, q.related];
const runs = new WeakMap<object, Set<string>>();
function windows(fields: string[]): Set<string> {
  const out = new Set<string>();
  for (const f of fields) {
    const t = normalizeStem(String(f ?? ""));
    for (let i = 0; i + VERBATIM_RUN <= t.length; i++) out.add(t.slice(i, i + VERBATIM_RUN));
  }
  return out;
}

const alike = (a: string, b: string, min: number) =>
  normalizeStem(a).length >= min && normalizeStem(b).length >= min && ngramJaccard(a, b) >= SIMILARITY_LIMIT;

/**
 * Why a generated question reuses official text, or undefined. A new stem is not enough: the options, 詳解 and 相關知識
 * are also official text (public repo, copyright) and must not be echoed. Checks the stem, each option against each
 * official option, the explanation and the related text, with the same 4-gram Jaccard,
 * then any 20+ character run shared between any field of the question and any official field (a pasted option, say).
 */
export function officialOverlap(
  q: Pick<RawQuestion, "stem" | "options" | "explanation" | "related">,
  official: Pick<Question, "id" | "stem" | "options" | "explanation" | "related">[],
): string | undefined {
  const mine = windows(textFields(q));
  for (const x of official) {
    if (tooSimilar(q.stem, x.stem)) return `stem too similar to official ${x.id}`;
    for (const [i, o] of q.options.entries())
      if ((x.options ?? []).some((xo) => alike(o, xo, MIN_OPTION_LEN))) return `option ${LETTERS[i]} copies an option of official ${x.id}`;
    if (alike(q.explanation, x.explanation, MIN_NOTE_LEN)) return `explanation too similar to official ${x.id}`;
    if (alike(q.related, x.related, MIN_NOTE_LEN)) return `related text too similar to official ${x.id}`;
    // Jaccard compares matching fields only; this compares every field with every official field.
    let theirs = runs.get(x);
    if (!theirs) runs.set(x, (theirs = windows(textFields(x))));
    for (const w of mine) if (theirs.has(w)) return `${VERBATIM_RUN}+ characters copied verbatim from official ${x.id}`;
  }
  return undefined;
}
