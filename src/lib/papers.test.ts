import { describe, expect, it } from 'vitest';
import { buildPapers, seeded } from './papers';
import type { Question } from './types';

const q = (subject: 11 | 12, item: string, n: number): Question => ({
  id: `${item}-${String(n).padStart(3, '0')}`, subject, item, stem: `${item} ${n}`, options: ['a', 'b', 'c', 'd'], answer: 0, explanation: 'e', related: 'r', source: 'original',
});
const pool = [
  ...Array.from({ length: 60 }, (_, i) => q(11, 'L11101', i + 1)),
  ...Array.from({ length: 60 }, (_, i) => q(11, 'L11201', i + 1)),
  ...Array.from({ length: 30 }, (_, i) => q(12, 'L12101', i + 1)),
];

describe('buildPapers', () => {
  it('builds whole disjoint papers with the 知識點 share', () => {
    const ps = buildPapers(pool, 11, 50);
    expect(ps.map((p) => p.id)).toEqual(['P11-01', 'P11-02']);
    const ids = ps.flatMap((p) => p.questionIds);
    expect(new Set(ids).size).toBe(100);
    for (const p of ps) expect(p.questionIds.filter((id) => id.startsWith('L11101')).length).toBe(25);
  });
  it('is deterministic', () => {
    expect(buildPapers(pool, 11, 50)).toEqual(buildPapers(pool, 11, 50));
  });
  it('keeps existing papers and appends new ones from unused questions', () => {
    const first = buildPapers(pool.slice(0, 110), 11, 50);
    expect(first).toHaveLength(2);
    const more = [...pool, ...Array.from({ length: 50 }, (_, i) => q(11, 'L11201', 100 + i))];
    const next = buildPapers(more, 11, 50, first);
    expect(next.slice(0, 2)).toEqual(first);
    expect(next).toHaveLength(3);
    expect(next[2]!.questionIds.some((id) => first.flatMap((p) => p.questionIds).includes(id))).toBe(false);
  });
  it('builds nothing when the pool is smaller than a paper', () => {
    expect(buildPapers(pool, 12, 50)).toEqual([]);
  });
  it('seeded rng is stable', () => {
    const a = seeded(1), b = seeded(1);
    expect([a(), a()]).toEqual([b(), b()]);
  });
});
