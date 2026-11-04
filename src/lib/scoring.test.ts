import { describe, expect, it } from 'vitest';
import { certificate, isPassed, scoreAnswers } from './scoring';
import type { Question } from './types';

const q = (id: string, answer: number): Question => ({
  id, subject: 1, item: 'L21101', stem: '', options: ['a', 'b', 'c', 'd'], answer, explanation: '', related: '', source: 'original',
});

describe('scoreAnswers', () => {
  it('scores 35/50 as exactly 70 and passes', () => {
    const qs = Array.from({ length: 50 }, (_, i) => q(String(i), 0));
    const answers = qs.map((_, i) => (i < 35 ? 0 : 1));
    expect(scoreAnswers(qs, answers)).toEqual({ correct: 35, total: 50, score: 70, passed: true });
  });
  it('34/50 = 68 fails', () => {
    const qs = Array.from({ length: 50 }, (_, i) => q(String(i), 0));
    const answers = qs.map((_, i) => (i < 34 ? 0 : 1));
    const r = scoreAnswers(qs, answers);
    expect(r.score).toBe(68);
    expect(r.passed).toBe(false);
  });
  it('blank answers count as wrong, no negative marking', () => {
    const qs = [q('a', 0), q('b', 1), q('c', 2), q('d', 3)];
    expect(scoreAnswers(qs, [0, null, 0, null]).score).toBe(25);
  });
  it('rounds to integer on a short draw (2/3 -> 67)', () => {
    const r = scoreAnswers([q('a', 0), q('b', 0), q('c', 0)], [0, 0, 1]);
    expect(r.score).toBe(67);
    expect(r.passed).toBe(false);
  });
  it('rounds 69.5 up to 70 (139/200)', () => {
    const qs = Array.from({ length: 200 }, (_, i) => q(String(i), 0));
    const answers = qs.map((_, i) => (i < 139 ? 0 : 1));
    expect(scoreAnswers(qs, answers).score).toBe(70);
  });
  it('empty draw scores 0 without NaN', () => {
    expect(scoreAnswers([], [])).toEqual({ correct: 0, total: 0, score: 0, passed: false });
  });
});

describe('isPassed / certificate', () => {
  it('pass at 70, fail at 69', () => {
    expect(isPassed(70)).toBe(true);
    expect(isPassed(69)).toBe(false);
  });
  it('機器學習 requires 科目1 and 科目3 both >= 70', () => {
    expect(certificate(3, 70, 70)).toEqual({ name: '機器學習', earned: true });
    expect(certificate(3, 90, 69)).toEqual({ name: '機器學習', earned: false });
    expect(certificate(3, 69, 100)).toEqual({ name: '機器學習', earned: false });
  });
  it('科目2 elective maps to 數據分析', () => {
    expect(certificate(2, 80, 80)).toEqual({ name: '數據分析', earned: true });
  });
});
