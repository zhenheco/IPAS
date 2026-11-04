import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reportPaidFeatureUse } from '../lib/account';
import { emptyState } from '../lib/storage';
import type { AppState, Question } from '../lib/types';
import { beginSession } from './start';

vi.mock('../lib/account', async (orig) => ({ ...(await orig<typeof import('../lib/account')>()), reportPaidFeatureUse: vi.fn() }));

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

describe('beginSession reports paid use only when a paid session starts', () => {
  beforeEach(() => vi.mocked(reportPaidFeatureUse).mockClear());
  const start = (mode: 'practice' | 'exam' | 'full' | 'redo') => beginSession(async (fn) => fn(emptyState()), { mode, subject: 3, pool, go: false });
  it('exam / full / redo each report their feature for the 級別 of the subject', async () => {
    for (const mode of ['exam', 'full', 'redo'] as const) await start(mode);
    expect(vi.mocked(reportPaidFeatureUse).mock.calls.map((c) => c.slice(0, 2))).toEqual([['intermediate', 'exam'], ['intermediate', 'full'], ['intermediate', 'redo']]);
  });
  it('practice does not report', async () => {
    await start('practice');
    expect(reportPaidFeatureUse).not.toHaveBeenCalled();
  });
});
