import { QUESTIONS_PER_SESSION } from '../config';
import { drawQuestions } from '../lib/draw';
import { createSession } from '../lib/session';
import type { AppState, FullExam, Mode, Question, Subject } from '../lib/types';
import { go, isUnsaved, newId } from './app';

/** Draw questions, store the new in-progress session (replacing any unfinished one) and open it. */
export async function beginSession(
  update: (fn: (s: AppState) => AppState) => Promise<AppState>,
  o: { mode: Mode; subject: Subject; pool: Question[]; fullId?: string; fullExam?: FullExam; now?: number; go?: boolean; count?: number },
) {
  if (!o.pool.length) return null; // nothing to draw: never replace an unfinished session with an empty one
  const active = createSession({
    id: newId(), mode: o.mode, subject: o.subject, questions: drawQuestions(o.pool, o.count ?? QUESTIONS_PER_SESSION),
    now: o.now ?? Date.now(), fullId: o.fullId,
  });
  const next = await update((s) => ({ ...s, active, ...(o.fullExam ? { fullExam: o.fullExam } : {}) }));
  if (o.go !== false && !isUnsaved()) go('/session/'); // a failed write would be lost on navigation
  return next.active;
}
