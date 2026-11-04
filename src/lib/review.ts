import type { Question, Session } from './types';

export interface ReviewRow { index: number; question: Question | null; removed: boolean; picked: number | null }

/** Per-question review of a saved session. The saved score stays authoritative; it is never re-computed. */
export function buildReview(session: Session, byId: Record<string, Question>) {
  const rows: ReviewRow[] = session.questionIds.map((id, index) => ({
    index, question: byId[id] ?? null, removed: !byId[id], picked: session.answers[index] ?? null,
  }));
  const removed = rows.filter((r) => r.removed).length;
  const correct = removed ? null : rows.filter((r) => r.picked === r.question!.answer).length;
  return { rows, removed, correct };
}
