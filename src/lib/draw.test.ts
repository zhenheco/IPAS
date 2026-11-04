import { describe, expect, it } from 'vitest';
import { drawQuestions } from './draw';
import type { Question } from './types';

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const make = (item: string, n: number): Question[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${item}-${i}`, subject: 3, item, stem: 's', options: ['a', 'b', 'c', 'd'], answer: i % 4, explanation: '', related: '', source: 'original',
  }));

describe('drawQuestions', () => {
  const pool = [...make('A', 100), ...make('B', 50), ...make('C', 50)];

  it('draws the requested count with no duplicates', () => {
    const out = drawQuestions(pool, 50, mulberry32(1));
    expect(out).toHaveLength(50);
    expect(new Set(out.map((x) => x.id)).size).toBe(50);
  });
  it('spreads proportionally across 知識點 (floor/ceil of share)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const out = drawQuestions(pool, 50, mulberry32(seed));
      const c = (k: string) => out.filter((x) => x.item === k).length;
      expect(c('A')).toBe(25);
      expect([12, 13]).toContain(c('B'));
      expect([12, 13]).toContain(c('C'));
    }
  });
  it('keeps tiny groups possible but never over-allocates beyond group size', () => {
    const skew = [...make('A', 200), ...make('Z', 1)];
    const out = drawQuestions(skew, 50, mulberry32(3));
    expect(out).toHaveLength(50);
    expect(out.filter((x) => x.item === 'Z').length).toBeLessThanOrEqual(1);
  });
  it('returns the whole pool (shuffled) when smaller than the count', () => {
    const small = make('A', 7);
    const out = drawQuestions(small, 50, mulberry32(2));
    expect(out).toHaveLength(7);
    expect(new Set(out.map((x) => x.id))).toEqual(new Set(small.map((x) => x.id)));
  });
  it('is deterministic for a seeded rng and varies across seeds', () => {
    const a = drawQuestions(pool, 50, mulberry32(9)).map((x) => x.id);
    const b = drawQuestions(pool, 50, mulberry32(9)).map((x) => x.id);
    const c = drawQuestions(pool, 50, mulberry32(10)).map((x) => x.id);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
  it('shuffles order (not grouped by 知識點) and never touches options/answer', () => {
    const out = drawQuestions(pool, 50, mulberry32(4));
    const sorted = [...out].sort((x, y) => x.item.localeCompare(y.item));
    expect(out.map((x) => x.id)).not.toEqual(sorted.map((x) => x.id));
    for (const x of out) {
      const orig = pool.find((p) => p.id === x.id)!;
      expect(x.options).toEqual(orig.options);
      expect(x.answer).toBe(orig.answer);
    }
  });
  it('does not mutate the input pool', () => {
    const copy = pool.map((x) => x.id);
    drawQuestions(pool, 50, mulberry32(5));
    expect(pool.map((x) => x.id)).toEqual(copy);
  });
});
