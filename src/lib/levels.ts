import type { Subject } from './types';

/** 初級 (L11/L12) and 中級 (L21/L22/L23) share one site; a 科目 number identifies its level. */
export type Level = 'beginner' | 'intermediate';

export interface SubjectInfo {
  subject: Subject;
  level: Level;
  /** official code, e.g. L11 */
  code: string;
  /** number shown to the user within its level (科目1, 科目2…) */
  no: number;
  name: string;
  /** 單科模考 time limit */
  minutes: number;
  passScore: number;
}

export interface LevelInfo {
  level: Level;
  name: '初級' | '中級';
  subjects: Subject[];
  /** 全真模考: the first 科目 is fixed, the second is one of `electives` */
  fullFirst: Subject;
  fullElectives: Subject[];
}

// 初級 time limit (75 分鐘) and pass score (每科 70 分) confirmed against the 115 年度簡章 (0410 version) on 2026-11-04; re-check each year's 簡章.
export const SUBJECT_INFO: Record<Subject, SubjectInfo> = {
  1: { subject: 1, level: 'intermediate', code: 'L21', no: 1, name: '人工智慧技術應用與規劃', minutes: 90, passScore: 70 },
  2: { subject: 2, level: 'intermediate', code: 'L22', no: 2, name: '大數據處理分析與應用', minutes: 90, passScore: 70 },
  3: { subject: 3, level: 'intermediate', code: 'L23', no: 3, name: '機器學習技術與應用', minutes: 90, passScore: 70 },
  11: { subject: 11, level: 'beginner', code: 'L11', no: 1, name: '人工智慧基礎概論', minutes: 75, passScore: 70 },
  12: { subject: 12, level: 'beginner', code: 'L12', no: 2, name: '生成式AI應用與規劃', minutes: 75, passScore: 70 },
};

export const ALL_SUBJECTS = Object.keys(SUBJECT_INFO).map(Number) as Subject[];

export const LEVELS: Record<Level, LevelInfo> = {
  beginner: { level: 'beginner', name: '初級', subjects: [11, 12], fullFirst: 11, fullElectives: [12] },
  intermediate: { level: 'intermediate', name: '中級', subjects: [1, 2, 3], fullFirst: 1, fullElectives: [3, 2] },
};
export const LEVEL_ORDER: Level[] = ['beginner', 'intermediate'];

export const isSubject = (x: unknown): x is Subject => typeof x === 'number' && x in SUBJECT_INFO;
export const levelOf = (s: Subject): Level => SUBJECT_INFO[s].level;
export const isLevel = (x: unknown): x is Level => x === 'beginner' || x === 'intermediate';

/** 科目1 (within its level) */
export const subjectShort = (s: Subject) => `科目${SUBJECT_INFO[s].no}`;
/** 初級科目1: unambiguous across levels */
export const subjectLabel = (s: Subject) => `${LEVELS[levelOf(s)].name}${subjectShort(s)}`;

export const passScoreOf = (s: Subject) => SUBJECT_INFO[s].passScore;
export const examCapMs = (s: Subject) => SUBJECT_INFO[s].minutes * 60_000;

/** First 科目 of the 全真模考 whose second 科目 is `elective`. */
export const fullFirstOf = (elective: Subject) => LEVELS[levelOf(elective)].fullFirst;

/** 中級 elective decides the 證書類別; 初級 has a single certificate. */
export function certificateName(elective: Subject): string {
  if (levelOf(elective) === 'beginner') return '初級';
  return elective === 3 ? '機器學習' : '數據分析';
}
