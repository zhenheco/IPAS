import { drawQuestions } from './draw';
import type { Paper, Question, Subject } from './types';

/** Deterministic PRNG (mulberry32) so a paper set can be rebuilt identically from the same bank and seed. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 模擬試卷: `count`-question papers drawn with the 知識點 share of the pool, disjoint until the pool runs out
 * (only whole papers: leftovers smaller than `size` are not used). Papers already published are kept as they are,
 * so adding questions to the bank appends new papers instead of reshuffling the old ones.
 */
export function buildPapers(pool: Question[], subject: Subject, size: number, existing: Paper[] = [], seed = 20261104): Paper[] {
  const kept = existing.filter((p) => p.subject === subject).sort((a, b) => a.no - b.no);
  const used = new Set(kept.flatMap((p) => p.questionIds));
  let rest = pool.filter((q) => q.subject === subject && !used.has(q.id));
  const out = [...kept];
  let no = kept.reduce((n, p) => Math.max(n, p.no), 0);
  const rng = seeded(seed + subject * 1000 + no);
  while (rest.length >= size) {
    const picked = drawQuestions(rest, size, rng);
    no++;
    out.push({ id: `P${subject}-${String(no).padStart(2, '0')}`, subject, no, questionIds: picked.map((q) => q.id) });
    const ids = new Set(picked.map((q) => q.id));
    rest = rest.filter((q) => !ids.has(q.id));
  }
  return out;
}
