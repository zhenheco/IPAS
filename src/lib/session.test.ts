import { describe, expect, it } from 'vitest';
import { EXAM_MIN_QUESTIONS, advanceToSection2, applyEdit, applySubmit, createSession, editActive, examBlock, submitSession } from './session';
import { afterSectionSubmit, startFull } from './fullexam';
import { emptyState } from './storage';
import { BREAK_CAP_MS } from './timer';
import { EXAM_CAP_MS } from './timer';
import type { Question } from './types';

const qs: Question[] = Array.from({ length: 4 }, (_, i) => ({
  id: `q${i}`, subject: 3, item: 'L23301', stem: '', options: ['a', 'b', 'c', 'd'], answer: 0, explanation: '', related: '', source: 'original',
}));
const byId = Object.fromEntries(qs.map((x) => [x.id, x]));
const NOW = Date.UTC(2026, 10, 5, 8, 0, 0);

describe('createSession', () => {
  it('exam mode gets a 90-minute deadline; practice is untimed', () => {
    const e = createSession({ id: 'e', mode: 'exam', subject: 3, questions: qs, now: NOW });
    expect(e.deadline).toBe(NOW + EXAM_CAP_MS);
    expect(e.answers).toEqual([null, null, null, null]);
    expect(e.flagged).toEqual([false, false, false, false]);
    expect(e.questionIds).toEqual(['q0', 'q1', 'q2', 'q3']);
    expect(createSession({ id: 'p', mode: 'practice', subject: 3, questions: qs, now: NOW }).deadline).toBeNull();
  });
  it('full mode is timed from an explicit start (section 2 may start in the past)', () => {
    const f = createSession({ id: 'f', mode: 'full', subject: 3, questions: qs, now: NOW, fullId: 'F1' });
    expect(f.deadline).toBe(NOW + EXAM_CAP_MS);
    expect(f.fullId).toBe('F1');
  });
});

describe('submitSession', () => {
  it('produces the stored session shape, a score, and updated stats', () => {
    const a = createSession({ id: 's', mode: 'practice', subject: 3, questions: qs, now: NOW });
    a.answers = [0, 1, null, 0]; // 2 right, 1 wrong, 1 blank
    const { session, stats } = submitSession(a, byId, {}, NOW + 60_000);
    expect(session).toEqual({
      id: 's', mode: 'practice', subject: 3,
      startedAt: new Date(NOW).toISOString(), submittedAt: new Date(NOW + 60_000).toISOString(),
      questionIds: ['q0', 'q1', 'q2', 'q3'], answers: [0, 1, null, 0], score: 50,
    });
    expect(stats.q1).toMatchObject({ wrong: 1, inWrongBook: true });
    expect(stats.q0).toMatchObject({ correct: 1, inWrongBook: false });
    // owner rule: a blank answer counts as wrong everywhere
    expect(stats.q2).toMatchObject({ attempts: 1, wrong: 1, inWrongBook: true, lastWrongAt: new Date(NOW + 60_000).toISOString() });
  });
  it('a blank answer in 錯題重做 resets the streak and keeps the question in the book', () => {
    const a = createSession({ id: 'r', mode: 'redo', subject: 3, questions: qs, now: NOW });
    a.answers = [null, 0, 0, 0];
    const prior = { q0: { attempts: 2, correct: 1, wrong: 1, lastWrongAt: 'x', redoStreak: 1, inWrongBook: true } };
    const { stats } = submitSession(a, byId, prior, NOW);
    expect(stats.q0).toMatchObject({ redoStreak: 0, inWrongBook: true, wrong: 2 });
  });
  it('questions missing from the bank are skipped, not counted wrong', () => {
    const a = createSession({ id: 'm', mode: 'practice', subject: 3, questions: qs, now: NOW });
    a.questionIds[3] = 'gone';
    const { stats } = submitSession(a, byId, {}, NOW);
    expect(stats.gone).toBeUndefined();
  });
  it('a timed session submitted late is stamped at its deadline, not at the late moment', () => {
    const a = createSession({ id: 'e', mode: 'exam', subject: 3, questions: qs, now: NOW });
    const { session } = submitSession(a, byId, {}, NOW + 4 * 3_600_000);
    expect(session.submittedAt).toBe(new Date(NOW + EXAM_CAP_MS).toISOString());
    const early = submitSession(a, byId, {}, NOW + 60_000).session;
    expect(early.submittedAt).toBe(new Date(NOW + 60_000).toISOString());
  });
  it('redo mode applies the two-in-a-row rule', () => {
    const a = createSession({ id: 'r', mode: 'redo', subject: 3, questions: qs, now: NOW });
    a.answers = [0, 0, 0, 0];
    const prior = { q0: { attempts: 1, correct: 0, wrong: 1, lastWrongAt: 'x', redoStreak: 1, inWrongBook: true } };
    const { stats } = submitSession(a, byId, prior, NOW);
    expect(stats.q0.inWrongBook).toBe(false);
  });
  it('carries fullId onto the session', () => {
    const a = createSession({ id: 'f', mode: 'full', subject: 3, questions: qs, now: NOW, fullId: 'F1' });
    expect(submitSession(a, byId, {}, NOW).session.fullId).toBe('F1');
  });
});

describe('editActive (write entry point)', () => {
  const mk = (mode: 'exam' | 'practice') => createSession({ id: 'x', mode, subject: 3, questions: qs, now: NOW });
  it('applies answers and flags before the deadline', () => {
    const a = mk('exam');
    const r1 = editActive(a, NOW + 1000, { type: 'answer', index: 1, choice: 2 });
    expect(r1.expired).toBe(false);
    expect(r1.active.answers[1]).toBe(2);
    const r2 = editActive(r1.active, NOW + 2000, { type: 'flag', index: 1 });
    expect(r2.active.flagged[1]).toBe(true);
    expect(editActive(r2.active, NOW + 3000, { type: 'answer', index: 1, choice: 2 }).active.answers[1]).toBeNull();
  });
  it('rejects changes at or after the deadline and reports expiry', () => {
    const a = mk('exam');
    const at = editActive(a, a.deadline!, { type: 'answer', index: 0, choice: 1 });
    expect(at.expired).toBe(true);
    expect(at.active.answers[0]).toBeNull();
    const late = editActive(a, a.deadline! + 5000, { type: 'flag', index: 0 });
    expect(late.expired).toBe(true);
    expect(late.active.flagged[0]).toBe(false);
  });
  it('untimed sessions never expire; out-of-range edits are ignored; input is not mutated', () => {
    const p = mk('practice');
    expect(editActive(p, NOW + 1e12, { type: 'answer', index: 0, choice: 3 }).active.answers[0]).toBe(3);
    expect(editActive(p, NOW, { type: 'answer', index: 99, choice: 1 }).active).toEqual(p);
    expect(p.answers[0]).toBeNull();
  });
});

describe('examBlock (單科模考 / 全真模考 need a full pool)', () => {
  it('requires at least 50 題 per 科目 and states the current count', () => {
    expect(EXAM_MIN_QUESTIONS).toBe(50);
    expect(examBlock(3, 50)).toBeNull();
    expect(examBlock(3, 120)).toBeNull();
    const msg = examBlock(3, 31)!;
    expect(msg).toContain('31');
    expect(msg).toContain('50');
    expect(msg).toContain('科目3');
  });
});

describe('state-level actions carry the session id they belong to', () => {
  const stateWith = (mode: 'exam' | 'practice', id = 'A') => ({ ...emptyState(), active: createSession({ id, mode, subject: 3 as const, questions: qs, now: NOW }) });

  it('applyEdit does nothing when the stored active session is a different one', () => {
    const s = stateWith('exam', 'A');
    const r = applyEdit(s, 'B', { type: 'answer', index: 0, choice: 1 }, NOW + 1000);
    expect(r.state).toBe(s);
    expect(r.expired).toBe(false);
    expect(applyEdit({ ...s, active: null }, 'A', { type: 'flag', index: 0 }, NOW).state.active).toBeNull();
  });
  it('applyEdit applies to the matching session and reports expiry', () => {
    const s = stateWith('exam', 'A');
    expect(applyEdit(s, 'A', { type: 'answer', index: 0, choice: 1 }, NOW + 1000).state.active!.answers[0]).toBe(1);
    expect(applyEdit(s, 'A', { type: 'answer', index: 0, choice: 1 }, s.active!.deadline!).expired).toBe(true);
  });
  it('applySubmit does nothing for a different or already-submitted session', () => {
    const s = stateWith('practice', 'A');
    const wrong = applySubmit(s, 'B', byId, NOW);
    expect(wrong.state).toBe(s);
    expect(wrong.session).toBeNull();
    const first = applySubmit(s, 'A', byId, NOW + 1000);
    expect(first.session!.id).toBe('A');
    expect(first.state.active).toBeNull();
    expect(first.state.sessions).toHaveLength(1);
    const again = applySubmit(first.state, 'A', byId, NOW + 2000); // double submit (two tabs / double tick)
    expect(again.session).toBeNull();
    expect(again.state.sessions).toHaveLength(1);
  });
  it('a 全真模考 section submit opens the break from the effective submit time; unrelated sessions leave fullExam alone', () => {
    const active = createSession({ id: 'F1', mode: 'full', subject: 3, questions: qs, now: NOW, fullId: 'F' });
    const s = { ...emptyState(), active, fullExam: startFull('F', 3) };
    const late = applySubmit(s, 'F1', byId, NOW + 5 * 3_600_000);
    expect(late.state.fullExam).toMatchObject({ stage: 'break', breakDeadline: NOW + EXAM_CAP_MS + BREAK_CAP_MS });
    const other = { ...emptyState(), active: createSession({ id: 'P', mode: 'practice', subject: 3, questions: qs, now: NOW }), fullExam: { ...startFull('F', 3), stage: 'break' as const, breakDeadline: NOW } };
    expect(applySubmit(other, 'P', byId, NOW).state.fullExam).toEqual(other.fullExam);
  });
});

describe('advanceToSection2 (idempotent break -> section 2)', () => {
  const brk = (id = 'F') => ({ ...emptyState(), fullExam: afterSectionSubmit(startFull(id, 3), NOW) });
  const make = (calls: number[]) => (startedAt: number) => {
    calls.push(startedAt);
    return createSession({ id: 'S2', mode: 'full', subject: 3, questions: qs, now: startedAt, fullId: 'F' });
  };
  it('starts section 2 once; a second run (other tab / double tick) is a no-op', () => {
    const calls: number[] = [];
    const once = advanceToSection2(brk(), 'F', NOW + 60_000, make(calls));
    expect(once.fullExam!.stage).toBe('section2');
    expect(once.active!.id).toBe('S2');
    expect(once.active!.startedAt).toBe(NOW + 60_000);
    const twice = advanceToSection2(once, 'F', NOW + 61_000, make(calls));
    expect(twice).toBe(once);
    expect(calls).toHaveLength(1);
  });
  it('an expired break starts section 2 at the break deadline', () => {
    const calls: number[] = [];
    const s = advanceToSection2(brk(), 'F', NOW + 5 * 3_600_000, make(calls));
    expect(calls).toEqual([NOW + BREAK_CAP_MS]);
    expect(s.active!.deadline).toBe(NOW + BREAK_CAP_MS + EXAM_CAP_MS);
  });
  it('ignores another exam id, a missing exam, or a phase that is not the break', () => {
    const calls: number[] = [];
    const s = brk('F');
    expect(advanceToSection2(s, 'OTHER', NOW, make(calls))).toBe(s);
    expect(advanceToSection2(emptyState(), 'F', NOW, make(calls))).toEqual(emptyState());
    const s1 = { ...emptyState(), fullExam: startFull('F', 3) };
    expect(advanceToSection2(s1, 'F', NOW, make(calls))).toBe(s1);
    expect(calls).toEqual([]);
  });
});
