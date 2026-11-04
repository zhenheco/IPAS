import { describe, expect, it } from 'vitest';
import { abandonBreak, afterSectionSubmit, endBreak, startFull, dropSource } from './fullexam';
import { createSession, submitSession } from './session';
import { BREAK_CAP_MS, effectiveSubmitAt, shouldAutoSubmit } from './timer';

const NOW = 1_700_000_000_000;

describe('全真模考 flow', () => {
  it('starts at section 1 with the chosen elective', () => {
    expect(startFull('F', 3)).toEqual({ id: 'F', elective: 3, stage: 'section1', breakDeadline: null });
  });
  it('remembers a 題目來源 choice so section 2 draws from the same pool, and omits it for 全部', () => {
    expect(startFull('F', 3, 'official')).toEqual({ id: 'F', elective: 3, stage: 'section1', breakDeadline: null, source: 'official' });
    expect(startFull('F', 3, 'all')).not.toHaveProperty('source');
    const next = afterSectionSubmit(startFull('F', 3, 'original'), NOW);
    expect(next.source).toBe('original');
  });
  it('submitting section 1 opens a 30-minute break', () => {
    const s = afterSectionSubmit(startFull('F', 3), NOW);
    expect(s).toMatchObject({ stage: 'break', breakDeadline: NOW + BREAK_CAP_MS });
  });
  it('submitting section 2 finishes the exam', () => {
    const { state } = endBreak(afterSectionSubmit(startFull('F', 3), NOW), NOW + 1000);
    expect(afterSectionSubmit(state, NOW + 2000).stage).toBe('done');
  });
  it('ending the break early starts section 2 now', () => {
    const b = afterSectionSubmit(startFull('F', 3), NOW);
    const r = endBreak(b, NOW + 60_000);
    expect(r.state.stage).toBe('section2');
    expect(r.startedAt).toBe(NOW + 60_000);
  });
  it('a break that already expired starts section 2 at the break deadline', () => {
    const b = afterSectionSubmit(startFull('F', 3), NOW);
    expect(endBreak(b, NOW + 3 * 3_600_000).startedAt).toBe(NOW + BREAK_CAP_MS);
  });
  it('endBreak outside the break stage is a no-op', () => {
    const s = startFull('F', 3);
    expect(endBreak(s, NOW)).toEqual({ state: s, startedAt: null });
  });
});

describe('全真模考 late reopen keeps the original deadlines (09:00 start, reopened 13:00)', () => {
  const at = (h: number, m = 0) => Date.UTC(2026, 10, 14, h, m);
  it('catches up through every phase from the original deadlines', () => {
    const reopen = at(13);
    const a1 = createSession({ id: 'a1', mode: 'full', subject: 1, questions: [], now: at(9), fullId: 'F' });
    expect(a1.deadline).toBe(at(10, 30));
    expect(shouldAutoSubmit(a1, reopen)).toBe(true);

    // section 1 is stamped at its deadline, so the break runs 10:30 -> 11:00
    const t1 = effectiveSubmitAt(a1.deadline, reopen);
    expect(t1).toBe(at(10, 30));
    const exam = afterSectionSubmit(startFull('F', 3), t1);
    expect(exam.breakDeadline).toBe(at(11));

    // break already over at 13:00: section 2 starts at 11:00 and ends 12:30
    const { state, startedAt } = endBreak(exam, reopen);
    expect(startedAt).toBe(at(11));
    const a2 = createSession({ id: 'a2', mode: 'full', subject: 3, questions: [], now: startedAt!, fullId: 'F' });
    expect(a2.deadline).toBe(at(12, 30));
    expect(shouldAutoSubmit(a2, reopen)).toBe(true);
    const t2 = effectiveSubmitAt(a2.deadline, reopen);
    expect(afterSectionSubmit(state, t2).stage).toBe('done');
    expect(t2).toBe(at(12, 30));
  });
  it('an early section 1 submit shortens the schedule: break = submit time + 30 min', () => {
    const a1 = createSession({ id: 'a1', mode: 'full', subject: 1, questions: [], now: at(9), fullId: 'F' });
    const t1 = effectiveSubmitAt(a1.deadline, at(9, 50));
    expect(afterSectionSubmit(startFull('F', 3), t1).breakDeadline).toBe(at(10, 20));
  });
  it('submitSession stamps each late section at its own deadline', () => {
    const a1 = createSession({ id: 'a1', mode: 'full', subject: 1, questions: [], now: at(9), fullId: 'F' });
    expect(submitSession(a1, {}, {}, at(13)).session.submittedAt).toBe(new Date(at(10, 30)).toISOString());
  });
});

describe('recovery actions on the section 2 shortage notice (guarded against a stale tab)', () => {
  const brk = (id: string, source?: 'official') => ({ ...afterSectionSubmit(startFull(id, 3, source), NOW) });

  it('abandon clears the exam only if it is still the same exam in its break', () => {
    expect(abandonBreak(brk('A', 'official'), 'A')).toBeNull();
  });
  it('abandon leaves a newer exam (another tab started one) untouched', () => {
    const newer = startFull('B', 3);
    expect(abandonBreak(newer, 'A')).toBe(newer);
    expect(abandonBreak(brk('B'), 'A')).toEqual(brk('B'));
  });
  it('abandon leaves the same exam alone once it has left the break', () => {
    const s2 = endBreak(brk('A'), NOW + 1000).state;
    expect(abandonBreak(s2, 'A')).toBe(s2);
    expect(abandonBreak(null, 'A')).toBeNull();
  });
  it('dropSource drops the 題目來源 only on the same exam in its break', () => {
    expect(dropSource(brk('A', 'official'), 'A')).not.toHaveProperty('source');
    const other = brk('B', 'official');
    expect(dropSource(other, 'A')).toBe(other);
    const s2 = endBreak(brk('A', 'official'), NOW + 1000).state;
    expect(dropSource(s2, 'A')).toBe(s2);
  });
});
