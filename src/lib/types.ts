/** 中級 1-3 (L21-L23), 初級 11-12 (L11-L12); see levels.ts */
export type Subject = 1 | 2 | 3 | 11 | 12;
export type Mode = 'practice' | 'exam' | 'full' | 'redo';

export interface Question {
  id: string;
  subject: Subject;
  /** 知識點 code, e.g. L23301 */
  item: string;
  stem: string;
  options: string[];
  answer: number;
  explanation: string;
  related: string;
  source: 'original' | 'official';
}

export interface SyllabusItem { code: string; name: string }
export interface SyllabusTopic { code: string; name: string; items: SyllabusItem[] }
export interface SyllabusSubject { subject: Subject; code: string; name: string; topics: SyllabusTopic[] }
export interface Syllabus { subjects: SyllabusSubject[] }

/** A submitted session; shaped so it can later be imported into an account. */
export interface Session {
  id: string;
  mode: Mode;
  subject: Subject;
  startedAt: string;
  submittedAt: string;
  questionIds: string[];
  answers: (number | null)[];
  score: number;
  fullId?: string;
  /** fixed 模擬試卷 id, when the session used one */
  paperId?: string;
}

/** Per-question stats, keyed by question id in AppState.questionStats. */
export interface QuestionStat {
  attempts: number;
  correct: number;
  wrong: number;
  lastWrongAt: string | null;
  /** consecutive correct answers in 錯題重做 */
  redoStreak: number;
  inWrongBook: boolean;
}

export interface ActiveSession {
  id: string;
  mode: Mode;
  subject: Subject;
  startedAt: number;
  /** epoch ms; null = untimed */
  deadline: number | null;
  questionIds: string[];
  answers: (number | null)[];
  flagged: boolean[];
  fullId?: string;
  paperId?: string;
}

export interface FullExam {
  id: string;
  /** second 科目 (中級 2 or 3, 初級 12); the first is fullFirstOf(elective) */
  elective: Subject;
  stage: 'section1' | 'break' | 'section2' | 'done';
  breakDeadline: number | null;
}

export interface AppState {
  schemaVersion: 1;
  sessions: Session[];
  questionStats: Record<string, QuestionStat>;
  active: ActiveSession | null;
  fullExam: FullExam | null;
}

/** A fixed 模擬試卷: 50 question ids drawn once with the 知識點 distribution, stable across builds. */
export interface Paper { id: string; subject: Subject; no: number; questionIds: string[] }

export interface Bank {
  questions: Question[];
  syllabus: Syllabus;
  papers: Paper[];
}
