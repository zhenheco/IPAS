import { describe, expect, it } from 'vitest';
import { aggregateWeakness } from './weakness';
import type { Question, QuestionStat } from './types';

const mk = (id: string, item: string, subject: 1 | 3 = 3): Question => ({
  id, subject, item, stem: '', options: ['a', 'b', 'c', 'd'], answer: 0, explanation: '', related: '', source: 'original',
});
const st = (attempts: number, correct: number): QuestionStat => ({
  attempts, correct, wrong: attempts - correct, lastWrongAt: null, redoStreak: 0, inWrongBook: false,
});

describe('aggregateWeakness', () => {
  const qs = [mk('a', 'L23301'), mk('b', 'L23301'), mk('c', 'L23101'), mk('d', 'L23201'), mk('e', 'L21101', 1), mk('f', 'L23401')];
  const byId = Object.fromEntries(qs.map((x) => [x.id, x]));
  const stats = { a: st(2, 0), b: st(2, 1), c: st(4, 4), d: st(1, 0), e: st(3, 3), unknown: st(5, 0) };

  it('sums attempts per 知識點, computes accuracy, weakest first', () => {
    const rows = aggregateWeakness(stats, byId);
    expect(rows.map((r) => r.item)).toEqual(['L23201', 'L23301', 'L23101', 'L21101']);
    expect(rows[1]).toMatchObject({ item: 'L23301', attempts: 4, correct: 1, accuracy: 0.25 });
  });
  it('ties on accuracy put the item with more attempts first', () => {
    const rows = aggregateWeakness({ a: st(1, 0), d: st(3, 0) }, byId);
    expect(rows.map((r) => r.item)).toEqual(['L23201', 'L23301']);
  });
  it('filters by 科目 and skips unattempted items and unknown questions', () => {
    const rows = aggregateWeakness(stats, byId, 3);
    expect(rows.map((r) => r.item)).not.toContain('L21101');
    expect(rows.map((r) => r.item)).not.toContain('L23401');
  });
  it('empty history gives no rows', () => {
    expect(aggregateWeakness({}, byId)).toEqual([]);
  });
});
