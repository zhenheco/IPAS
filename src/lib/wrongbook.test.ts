import { describe, expect, it } from 'vitest';
import { applyResults, groupWrongBook, wrongBookIds } from './wrongbook';
import type { Question, QuestionStat } from './types';

const T1 = '2026-11-01T00:00:00.000Z';
const T2 = '2026-11-02T00:00:00.000Z';
const NOW = (stats: Record<string, QuestionStat>, ok: boolean, mode: 'practice' | 'redo', at = T1, id = 'q1') =>
  applyResults(stats, [{ questionId: id, correct: ok }], mode, at);

describe('applyResults (錯題本 rules)', () => {
  it('records a wrong answer: wrong count, last wrong date, in book', () => {
    const s = NOW({}, false, 'practice');
    expect(s.q1).toEqual({ attempts: 1, correct: 0, wrong: 1, lastWrongAt: T1, redoStreak: 0, inWrongBook: true });
  });
  it('accumulates wrong count and updates last wrong date', () => {
    const s = NOW(NOW({}, false, 'practice', T1), false, 'practice', T2);
    expect(s.q1.wrong).toBe(2);
    expect(s.q1.lastWrongAt).toBe(T2);
  });
  it('a correct answer for a never-wrong question does not enter the book', () => {
    const s = NOW({}, true, 'practice');
    expect(s.q1).toMatchObject({ attempts: 1, correct: 1, wrong: 0, inWrongBook: false });
  });
  it('leaves the book after two consecutive correct answers in 錯題重做', () => {
    let s = NOW({}, false, 'practice');
    s = NOW(s, true, 'redo');
    expect(s.q1.inWrongBook).toBe(true);
    expect(s.q1.redoStreak).toBe(1);
    s = NOW(s, true, 'redo');
    expect(s.q1.inWrongBook).toBe(false);
    expect(s.q1.redoStreak).toBe(0);
    expect(s.q1.wrong).toBe(1); // history retained
  });
  it('a wrong answer in between resets the streak', () => {
    let s = NOW({}, false, 'practice');
    s = NOW(s, true, 'redo');
    s = NOW(s, false, 'redo');
    s = NOW(s, true, 'redo');
    expect(s.q1.inWrongBook).toBe(true);
    expect(s.q1.redoStreak).toBe(1);
  });
  it('correct answers outside 錯題重做 do not count toward leaving', () => {
    let s = NOW({}, false, 'practice');
    s = NOW(s, true, 'practice');
    s = NOW(s, true, 'practice');
    expect(s.q1.inWrongBook).toBe(true);
    expect(s.q1.redoStreak).toBe(0);
  });
  it('re-enters the book when answered wrong again after leaving', () => {
    let s = NOW({}, false, 'practice');
    s = NOW(NOW(s, true, 'redo'), true, 'redo');
    s = NOW(s, false, 'practice', T2);
    expect(s.q1.inWrongBook).toBe(true);
    expect(s.q1.wrong).toBe(2);
  });
  it('does not mutate the previous stats', () => {
    const before = NOW({}, false, 'practice');
    const snap = JSON.stringify(before);
    NOW(before, true, 'redo');
    expect(JSON.stringify(before)).toBe(snap);
  });
});

describe('wrongBookIds / groupWrongBook', () => {
  const mk = (id: string, subject: 1 | 3, item: string): Question => ({
    id, subject, item, stem: '', options: ['a', 'b', 'c', 'd'], answer: 0, explanation: '', related: '', source: 'original',
  });
  const qs = [mk('a', 1, 'L21101'), mk('b', 3, 'L23301'), mk('c', 3, 'L23301'), mk('d', 3, 'L23101')];
  const byId = Object.fromEntries(qs.map((x) => [x.id, x]));
  let stats: Record<string, QuestionStat> = {};
  stats = applyResults(stats, [
    { questionId: 'a', correct: false }, { questionId: 'b', correct: false },
    { questionId: 'c', correct: false }, { questionId: 'd', correct: true },
  ], 'practice', T1);
  stats = applyResults(stats, [{ questionId: 'c', correct: false }], 'practice', T2);

  it('lists only in-book ids, optionally per 科目', () => {
    expect(wrongBookIds(stats, byId).sort()).toEqual(['a', 'b', 'c']);
    expect(wrongBookIds(stats, byId, 3).sort()).toEqual(['b', 'c']);
  });
  it('ignores ids whose question no longer exists', () => {
    const s = applyResults(stats, [{ questionId: 'gone', correct: false }], 'practice', T1);
    expect(wrongBookIds(s, byId)).not.toContain('gone');
  });
  it('groups by 知識點, most wrong first within a group', () => {
    const g = groupWrongBook(stats, byId, 3);
    expect(g).toHaveLength(1);
    expect(g[0].item).toBe('L23301');
    expect(g[0].entries.map((e) => e.question.id)).toEqual(['c', 'b']);
    expect(g[0].entries[0].stat.wrong).toBe(2);
  });
});
