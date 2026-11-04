import { describe, expect, it } from 'vitest';
import type { QuestionStat, Session } from '../src/lib/types';
import { chunk } from './db';
import { mergeSync, parseSyncBody, pickStat, type SyncData } from './sync';

const sess = (id: string, submittedAt: string, score = 50): Session => ({
  id, mode: 'exam', subject: 1, startedAt: '2026-09-01T00:00:00.000Z', submittedAt, questionIds: ['a'], answers: [1], score,
});
const stat = (attempts: number, wrong: number, lastWrongAt: string | null = null, redoStreak = 0): QuestionStat => ({
  attempts, correct: attempts - wrong, wrong, lastWrongAt, redoStreak, inWrongBook: wrong > 0 && redoStreak < 2,
});

describe('pickStat', () => {
  it('more attempts wins', () => {
    expect(pickStat(stat(2, 1), stat(3, 0))).toEqual(stat(3, 0));
    expect(pickStat(stat(5, 1), stat(3, 0))).toEqual(stat(5, 1));
  });
  it('tie → later lastWrongAt wins (null earliest)', () => {
    expect(pickStat(stat(2, 1, null), stat(2, 1, '2026-09-01T00:00:00.000Z')).lastWrongAt).toBe('2026-09-01T00:00:00.000Z');
    expect(pickStat(stat(2, 1, '2026-09-02T00:00:00.000Z'), stat(2, 1, '2026-09-01T00:00:00.000Z')).lastWrongAt).toBe('2026-09-02T00:00:00.000Z');
  });
  it('full tie → server', () => {
    const server = stat(2, 1, null, 1);
    expect(pickStat(server, stat(2, 1, null, 0))).toBe(server);
  });
  it('keeps each record internally consistent', () => {
    const p = pickStat(stat(4, 3, '2026-09-01T00:00:00.000Z'), stat(4, 1, '2026-09-03T00:00:00.000Z'));
    expect(p.correct + p.wrong).toBe(p.attempts);
  });
});

describe('mergeSync', () => {
  const server: SyncData = { sessions: [sess('b', '2026-09-02T00:00:00.000Z'), sess('a', '2026-09-01T00:00:00.000Z')], questionStats: { q1: stat(2, 1), q2: stat(1, 0) } };
  const client: SyncData = { sessions: [sess('a', '2026-09-01T00:00:00.000Z', 99), sess('c', '2026-09-01T12:00:00.000Z')], questionStats: { q1: stat(1, 1), q2: stat(4, 2), q3: stat(1, 1) } };

  it('unions sessions by id (server copy wins) sorted by submittedAt', () => {
    const r = mergeSync(server, client);
    expect(r.merged.sessions.map((s) => [s.id, s.score])).toEqual([['a', 50], ['c', 50], ['b', 50]]);
    expect(r.newSessions.map((s) => s.id)).toEqual(['c']);
  });
  it('merges stats per question and reports only changed rows', () => {
    const r = mergeSync(server, client);
    expect(r.merged.questionStats).toEqual({ q1: stat(2, 1), q2: stat(4, 2), q3: stat(1, 1) });
    expect(r.changedStats.map(([id]) => id)).toEqual(['q2', 'q3']);
  });
  it('is idempotent: merging the result again changes nothing', () => {
    const once = mergeSync(server, client).merged;
    const twice = mergeSync(once, client);
    expect(twice.merged).toEqual(once);
    expect(twice.newSessions).toEqual([]);
    expect(twice.changedStats).toEqual([]);
  });
  it('the merged sessions do not depend on which side is the server (ids are disjoint or identical)', () => {
    const ids = (d: SyncData) => d.sessions.map((s) => s.id);
    expect(ids(mergeSync(server, client).merged)).toEqual(ids(mergeSync(client, server).merged));
  });
  it('empty sides', () => {
    expect(mergeSync({ sessions: [], questionStats: {} }, { sessions: [], questionStats: {} }).merged).toEqual({ sessions: [], questionStats: {} });
  });
});

describe('parseSyncBody', () => {
  it('accepts valid AppState export shape and strips unknown fields', () => {
    const r = parseSyncBody({ schemaVersion: 1, exportedAt: 'x', sessions: [{ ...sess('a', '2026-09-01T00:00:00.000Z'), extra: 1 }], questionStats: { q: { ...stat(1, 0), junk: true } } });
    expect(r.ok && r.data).toEqual({ sessions: [sess('a', '2026-09-01T00:00:00.000Z')], questionStats: { q: stat(1, 0) } });
  });
  it('rejects bad shapes, duplicates and oversize ids', () => {
    expect(parseSyncBody(null).ok).toBe(false);
    expect(parseSyncBody({ schemaVersion: 1, sessions: {}, questionStats: {} }).ok).toBe(false);
    expect(parseSyncBody({ schemaVersion: 1, sessions: [], questionStats: [] }).ok).toBe(false);
    const d = sess('a', '2026-09-01T00:00:00.000Z');
    const dup = parseSyncBody({ schemaVersion: 1, sessions: [d, d], questionStats: {} });
    expect(!dup.ok && dup.error).toContain('重複');
    expect(parseSyncBody({ schemaVersion: 1, sessions: [], questionStats: { ['x'.repeat(65)]: stat(1, 0) } }).ok).toBe(false);
  });
});

describe('chunk', () => {
  it('splits rows so each statement stays within 100 bound parameters', () => {
    expect(chunk([1, 2, 3, 4, 5], 40).map((c) => c.length)).toEqual([2, 2, 1]);
    expect(chunk([], 11)).toEqual([]);
    expect(chunk([1], 500)).toEqual([[1]]);
  });
});
