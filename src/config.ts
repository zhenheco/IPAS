import type { Level } from './lib/levels';
import type { Mode, Subject } from './lib/types';

/**
 * 梯次 date per level that the countdown points at; change here for the next 梯次.
 * null hides the countdown (初級 is held several times a year: fill in the 梯次 you are preparing for).
 */
export const EXAM_DATES: Record<Level, string | null> = {
  intermediate: '2026-11-14',
  beginner: null,
};
/** @deprecated use EXAM_DATES.intermediate */
export const EXAM_DATE = EXAM_DATES.intermediate!;
export const QUESTIONS_PER_SESSION = 50;

/** 科目 shown even before they have 題目 (科目2 / 初級 appear once they have 題目). */
export const DEFAULT_SUBJECTS: Subject[] = [1, 3];
/** Level shown first when the viewer has not picked one. */
export const DEFAULT_LEVEL: Level = 'intermediate';

export const MODE_LABEL: Record<Mode, string> = {
  practice: '練習',
  exam: '單科模考',
  full: '全真模考',
  redo: '錯題重做',
};
