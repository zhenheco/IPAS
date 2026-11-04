import type { FullExam, SourceChoice } from './types';
import { BREAK_CAP_MS, section2StartAt } from './timer';

export const startFull = (id: string, elective: 2 | 3, source: SourceChoice = 'all'): FullExam =>
  ({ id, elective, stage: 'section1', breakDeadline: null, ...(source === 'all' ? {} : { source }) });

export function afterSectionSubmit(s: FullExam, now: number): FullExam {
  if (s.stage === 'section1') return { ...s, stage: 'break', breakDeadline: now + BREAK_CAP_MS };
  if (s.stage === 'section2') return { ...s, stage: 'done' };
  return s;
}

/** Ending the break (early click, or noticing it expired) moves to section 2; `startedAt` is its start time. */
export function endBreak(s: FullExam, now: number): { state: FullExam; startedAt: number | null } {
  if (s.stage !== 'break' || s.breakDeadline === null) return { state: s, startedAt: null };
  return { state: { ...s, stage: 'section2' }, startedAt: section2StartAt(s.breakDeadline, now) };
}

// Recovery actions for a section 2 that cannot start. Each acts only on the exam it was shown for, still in its break, so a
// stale tab cannot clear or change an exam another tab started since.
export const abandonBreak = (cur: FullExam | null, examId: string): FullExam | null =>
  cur && cur.id === examId && cur.stage === 'break' ? null : cur;

export function dropSource(cur: FullExam, examId: string): FullExam {
  if (cur.id !== examId || cur.stage !== 'break') return cur;
  const { source: _dropped, ...rest } = cur;
  return rest;
}
