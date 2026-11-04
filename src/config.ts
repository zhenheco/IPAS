import type { Mode, Subject } from './lib/types';

/** 梯次 the owner is preparing for; change here for the next 梯次. */
export const EXAM_DATE = '2026-11-14';
export const QUESTIONS_PER_SESSION = 50;

export const SUBJECT_NAMES: Record<Subject, string> = {
  1: '人工智慧技術應用與規劃',
  2: '大數據處理分析與應用',
  3: '機器學習技術與應用',
};
/** 科目2 is shown only when it has 題目. */
export const DEFAULT_SUBJECTS: Subject[] = [1, 3];

export const MODE_LABEL: Record<Mode, string> = {
  practice: '練習',
  exam: '單科模考',
  full: '全真模考',
  redo: '錯題重做',
};
