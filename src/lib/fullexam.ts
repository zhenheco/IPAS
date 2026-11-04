import type { FullExam } from './types';
import { BREAK_CAP_MS, section2StartAt } from './timer';

export const startFull = (id: string, elective: 2 | 3): FullExam => ({ id, elective, stage: 'section1', breakDeadline: null });

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
