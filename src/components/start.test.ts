import { describe, expect, it } from 'vitest';
import { emptyState } from '../lib/storage';
import type { AppState, Question } from '../lib/types';
import { beginSession } from './start';

const pool: Question[] = Array.from({ length: 60 }, (_, i) => ({
  id: `q${i}`, subject: 3, item: 'L23301', stem: '', options: ['a', 'b', 'c', 'd'], answer: 0, explanation: '', related: '', source: 'original',
}));
const run = async (count?: number) => {
  let saved: AppState = emptyState();
  await beginSession(async (fn) => (saved = fn(saved)), { mode: 'practice', subject: 3, pool, count, go: false });
  return saved.active!;
};

describe('beginSession refuses an empty pool', () => {
  it('does not touch the stored state, so an unfinished session is never overwritten', async () => {
    let calls = 0;
    const r = await beginSession(async (fn) => { calls++; return fn(emptyState()); }, { mode: 'redo', subject: 3, pool: [], go: false });
    expect(r).toBeNull();
    expect(calls).toBe(0);
  });
});

describe('beginSession question count', () => {
  it('defaults to a full set of 50', async () => {
    expect((await run()).questionIds).toHaveLength(50);
  });
  it('honours a smaller cap (exam-eve quick review / 錯題重做)', async () => {
    expect((await run(10)).questionIds).toHaveLength(10);
    expect((await run(20)).answers).toHaveLength(20);
  });
});
