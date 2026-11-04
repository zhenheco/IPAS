import { describe, expect, it } from 'vitest';
import { filterBySource, hasOfficial } from './source';
import type { Question } from './types';

const mk = (id: string, source: Question['source']): Question => ({
  id, subject: 3, item: 'L23301', stem: '', options: ['a', 'b', 'c', 'd'], answer: 0, explanation: '', related: '', source,
});
const pool = [mk('a', 'original'), mk('b', 'official'), mk('c', 'original'), mk('d', 'official')];

describe('filterBySource (題目來源)', () => {
  it('全部 keeps everything', () => {
    expect(filterBySource(pool, 'all').map((q) => q.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('官方歷屆試題 keeps only official', () => {
    expect(filterBySource(pool, 'official').map((q) => q.id)).toEqual(['b', 'd']);
  });
  it('原創模擬題 keeps only original', () => {
    expect(filterBySource(pool, 'original').map((q) => q.id)).toEqual(['a', 'c']);
  });
  it('treats a missing choice as 全部 and does not mutate the pool', () => {
    expect(filterBySource(pool, undefined)).toHaveLength(4);
    expect(pool).toHaveLength(4);
  });
});

describe('hasOfficial', () => {
  it('is true only when the bank contains an official question', () => {
    expect(hasOfficial(pool)).toBe(true);
    expect(hasOfficial([mk('a', 'original')])).toBe(false);
    expect(hasOfficial([])).toBe(false);
  });
});
