import { describe, expect, it } from 'vitest';
import { ALL_SUBJECTS, LEVELS, certificateName, examCapMs, fullFirstOf, isSubject, levelOf, subjectLabel } from './levels';
import { certificate, isPassed } from './scoring';
import { createSession } from './session';
import { parseState, sessionError } from './storage';

const NOW = 1_700_000_000_000;

describe('levels', () => {
  it('knows both levels and their 科目', () => {
    expect(ALL_SUBJECTS).toEqual([1, 2, 3, 11, 12]);
    expect(LEVELS.beginner.subjects).toEqual([11, 12]);
    expect(levelOf(12)).toBe('beginner');
    expect(levelOf(3)).toBe('intermediate');
    expect(isSubject(11)).toBe(true);
    expect(isSubject(4)).toBe(false);
  });
  it('labels 科目 unambiguously across levels', () => {
    expect(subjectLabel(11)).toBe('初級科目1');
    expect(subjectLabel(1)).toBe('中級科目1');
  });
  it('全真模考 first 科目 follows the level of the second', () => {
    expect(fullFirstOf(12)).toBe(11);
    expect(fullFirstOf(3)).toBe(1);
    expect(certificateName(12)).toBe('初級');
    expect(certificateName(2)).toBe('數據分析');
  });
  it('單科模考 deadline uses the 科目 time limit', () => {
    const q = { id: 'L11101-001' } as never;
    expect(createSession({ id: 'a', mode: 'exam', subject: 11, questions: [q], now: NOW }).deadline).toBe(NOW + examCapMs(11));
    expect(examCapMs(11)).toBe(75 * 60_000);
    expect(createSession({ id: 'b', mode: 'exam', subject: 1, questions: [q], now: NOW }).deadline).toBe(NOW + 90 * 60_000);
  });
  it('passing uses the 科目 pass score', () => {
    expect(isPassed(70, 11)).toBe(true);
    expect(isPassed(69, 12)).toBe(false);
    expect(certificate(12, 80, 70, 11)).toEqual({ name: '初級', earned: true });
  });
});

describe('storage with 初級 records', () => {
  const session = { id: 's', mode: 'exam', subject: 11, startedAt: new Date(NOW).toISOString(), submittedAt: new Date(NOW).toISOString(), questionIds: ['x'], answers: [1], score: 100, paperId: 'P11-01' };
  it('accepts 初級 sessions and a 初級 全真模考', () => {
    expect(sessionError(session)).toBeNull();
    const st = parseState(JSON.stringify({ schemaVersion: 1, sessions: [session], questionStats: {}, active: null, fullExam: { id: 'F', elective: 12, stage: 'break', breakDeadline: 5 } }));
    expect(st.sessions).toHaveLength(1);
    expect(st.fullExam?.elective).toBe(12);
  });
  it('rejects unknown subjects and a bad paperId', () => {
    expect(sessionError({ ...session, subject: 4 })).not.toBeNull();
    expect(sessionError({ ...session, paperId: 3 })).not.toBeNull();
  });
});
