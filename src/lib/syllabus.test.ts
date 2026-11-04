import { describe, expect, it } from 'vitest';
import { filterPool, itemName, topicName, topicOf } from './syllabus';
import type { Question, Syllabus } from './types';

const syl: Syllabus = { subjects: [{ subject: 3, code: 'L23', name: 'ML', topics: [
  { code: 'L233', name: '機器學習建模與參數調校', items: [{ code: 'L23301', name: '數據準備與特徵工程' }] },
] }] };
const mk = (id: string, subject: 1 | 3, item: string): Question => ({
  id, subject, item, stem: '', options: ['a', 'b', 'c', 'd'], answer: 0, explanation: '', related: '', source: 'original',
});
const pool = [mk('a', 3, 'L23301'), mk('b', 3, 'L23302'), mk('c', 3, 'L23101'), mk('d', 1, 'L21101')];

describe('syllabus helpers', () => {
  it('topicOf derives the 評鑑主題 from a 知識點 code', () => {
    expect(topicOf('L23301')).toBe('L233');
  });
  it('names come from the syllabus, falling back to the code', () => {
    expect(itemName(syl, 'L23301')).toBe('數據準備與特徵工程');
    expect(itemName(syl, 'L23302')).toBe('L23302');
    expect(topicName(syl, 'L233')).toBe('機器學習建模與參數調校');
    expect(topicName({ subjects: [] }, 'L233')).toBe('L233');
  });
});

describe('filterPool', () => {
  it('filters by 科目 only', () => {
    expect(filterPool(pool, { subject: 3 }).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('narrows to one 評鑑主題', () => {
    expect(filterPool(pool, { subject: 3, topic: 'L233' }).map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('narrows to one 知識點 (wins over topic)', () => {
    expect(filterPool(pool, { subject: 3, topic: 'L231', item: 'L23301' }).map((x) => x.id)).toEqual(['a']);
  });
});
