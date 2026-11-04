import type { ActiveSession, AppState, Mode, Question, QuestionStat, Session, Subject } from './types';
import { afterSectionSubmit, endBreak } from './fullexam';
import { scoreAnswers } from './scoring';
import { EXAM_CAP_MS, deadlineFor, effectiveSubmitAt, shouldAutoSubmit } from './timer';
import { applyResults } from './wrongbook';

export const EXAM_MIN_QUESTIONS = 50;

/** 單科模考 and 全真模考 need a full pool; returns the reason to block starting, or null. */
export const examBlock = (subject: Subject, count: number) =>
  count >= EXAM_MIN_QUESTIONS ? null : `科目${subject}目前題庫只有 ${count} 題，需要至少 ${EXAM_MIN_QUESTIONS} 題才能開始。`;

export function createSession(o: { id: string; mode: Mode; subject: Subject; questions: Question[]; now: number; fullId?: string }): ActiveSession {
  const n = o.questions.length;
  return {
    id: o.id,
    mode: o.mode,
    subject: o.subject,
    startedAt: o.now,
    deadline: o.mode === 'exam' || o.mode === 'full' ? deadlineFor(o.now, EXAM_CAP_MS) : null,
    questionIds: o.questions.map((q) => q.id),
    answers: Array(n).fill(null),
    flagged: Array(n).fill(false),
    ...(o.fullId ? { fullId: o.fullId } : {}),
  };
}

export type Edit = { type: 'answer'; index: number; choice: number } | { type: 'flag'; index: number };

/** The single write entry point for an in-progress session: nothing changes at or after the deadline. */
export function editActive(a: ActiveSession, now: number, edit: Edit): { active: ActiveSession; expired: boolean } {
  if (shouldAutoSubmit(a, now)) return { active: a, expired: true };
  if (edit.index < 0 || edit.index >= a.questionIds.length) return { active: a, expired: false };
  const next = { ...a, answers: [...a.answers], flagged: [...a.flagged] };
  if (edit.type === 'flag') next.flagged[edit.index] = !next.flagged[edit.index];
  else next.answers[edit.index] = next.answers[edit.index] === edit.choice ? null : edit.choice;
  return { active: next, expired: false };
}

export function submitSession(a: ActiveSession, byId: Record<string, Question>, stats: Record<string, QuestionStat>, now: number) {
  const at = effectiveSubmitAt(a.deadline, now);
  const qs = a.questionIds.map((id) => byId[id]);
  const known = qs.filter(Boolean);
  const { score } = scoreAnswers(known, a.answers.filter((_, i) => qs[i]));
  const iso = new Date(at).toISOString();
  const session: Session = {
    id: a.id, mode: a.mode, subject: a.subject,
    startedAt: new Date(a.startedAt).toISOString(), submittedAt: iso,
    questionIds: a.questionIds, answers: a.answers, score,
    ...(a.fullId ? { fullId: a.fullId } : {}),
  };
  // questions no longer in the bank are skipped; a blank answer counts as wrong
  const results = qs.flatMap((q, i) => (q ? [{ questionId: q.id, correct: a.answers[i] === q.answer }] : []));
  return { session, stats: applyResults(stats, results, a.mode, iso) };
}

// State-level actions. Each carries the id of the session it belongs to and does nothing when the stored
// active session is a different (or already submitted) one, so a stale tab or timer cannot touch another session.

export function applyEdit(s: AppState, sessionId: string, edit: Edit, now: number): { state: AppState; expired: boolean } {
  if (s.active?.id !== sessionId) return { state: s, expired: false };
  const r = editActive(s.active, now, edit);
  return { state: r.active === s.active ? s : { ...s, active: r.active }, expired: r.expired };
}

export function applySubmit(s: AppState, sessionId: string, byId: Record<string, Question>, now: number): { state: AppState; session: Session | null } {
  const a = s.active;
  if (!a || a.id !== sessionId) return { state: s, session: null };
  const { session, stats } = submitSession(a, byId, s.questionStats, now);
  // a late submit is stamped at the deadline, so 全真模考 phases follow the original schedule
  const fullExam = a.mode === 'full' && s.fullExam && s.fullExam.id === a.fullId
    ? afterSectionSubmit(s.fullExam, effectiveSubmitAt(a.deadline, now))
    : s.fullExam;
  return { state: { ...s, sessions: [...s.sessions, session], questionStats: stats, active: null, fullExam }, session };
}

/** break -> section 2, checked against the latest stored fullExam so it runs exactly once however many tabs/ticks ask. */
export function advanceToSection2(s: AppState, examId: string, now: number, makeActive: (startedAt: number) => ActiveSession): AppState {
  if (!s.fullExam || s.fullExam.id !== examId || s.fullExam.stage !== 'break') return s;
  const { state, startedAt } = endBreak(s.fullExam, now);
  return startedAt === null ? s : { ...s, fullExam: state, active: makeActive(startedAt) };
}
