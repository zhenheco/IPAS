import type { Question } from './types';

export function shuffle<T>(arr: readonly T[], rng: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Sample without replacement. When the pool is larger than `count`, quotas per 知識點 follow
 * the pool's share (largest-remainder), then the final order is shuffled. Options are never touched.
 */
export function drawQuestions(pool: Question[], count: number, rng: () => number = Math.random): Question[] {
  if (pool.length <= count) return shuffle(pool, rng);

  const groups = new Map<string, Question[]>();
  for (const q of pool) groups.set(q.item, [...(groups.get(q.item) ?? []), q]);

  const rows = [...groups.entries()].map(([item, qs]) => {
    const exact = (qs.length * count) / pool.length;
    return { item, qs, quota: Math.floor(exact), rem: exact - Math.floor(exact) };
  });
  let left = count - rows.reduce((n, r) => n + r.quota, 0);
  // random tie-break so equal remainders do not always favour the same 知識點
  for (const r of shuffle(rows, rng).sort((a, b) => b.rem - a.rem)) {
    if (left-- <= 0) break;
    r.quota++;
  }
  return shuffle(rows.flatMap((r) => shuffle(r.qs, rng).slice(0, r.quota)), rng);
}
