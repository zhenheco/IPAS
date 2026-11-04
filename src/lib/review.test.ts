import { describe, expect, it } from 'vitest';
import { buildReview } from './review';
import type { Question, Session } from './types';

const mk = (id: string, answer = 0): Question => ({ id, subject: 3, item: 'L23301', stem: '', options: ['a', 'b', 'c', 'd'], answer, explanation: '', related: '', source: 'original' });
const session: Session = { id: 's', mode: 'practice', subject: 3, startedAt: '', submittedAt: '', questionIds: ['a', 'b', 'c'], answers: [0, 1, null], score: 67 };

describe('buildReview', () => {
  it('lists every recorded question; questions gone from the bank are marked, not re-scored', () => {
    const byId = { a: mk('a'), c: mk('c') };
    const r = buildReview(session, byId);
    expect(r.rows.map((x) => x.question?.id ?? null)).toEqual(['a', null, 'c']);
    expect(r.rows[1]).toMatchObject({ index: 1, removed: true, picked: 1 });
    expect(r.removed).toBe(1);
    expect(r.correct).toBeNull(); // cannot count what we cannot see; the saved score stays authoritative
  });
  it('counts correct answers when every question is still in the bank', () => {
    const byId = { a: mk('a'), b: mk('b', 1), c: mk('c') };
    const r = buildReview(session, byId);
    expect(r.removed).toBe(0);
    expect(r.correct).toBe(2);
    expect(r.rows.every((x) => !x.removed)).toBe(true);
  });
});
