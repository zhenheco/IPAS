import { QUESTIONS_PER_SESSION } from '../config';
import { reportPaidFeatureUse } from '../lib/account';
import { drawQuestions } from '../lib/draw';
import { MODE_FEATURE } from '../lib/entitlement';
import { levelOf } from '../lib/levels';
import { createSession } from '../lib/session';
import type { AppState, FullExam, Mode, Question, Subject } from '../lib/types';
import { go, isUnsaved, newId } from './app';

/** Draw questions, store the new in-progress session (replacing any unfinished one) and open it. */
export async function beginSession(
  update: (fn: (s: AppState) => AppState) => Promise<AppState>,
  o: { mode: Mode; subject: Subject; pool: Question[]; fullId?: string; fullExam?: FullExam; now?: number; go?: boolean; paperId?: string; keepOrder?: boolean },
) {
  const active = createSession({
    id: newId(), mode: o.mode, subject: o.subject, questions: o.keepOrder ? o.pool : drawQuestions(o.pool, QUESTIONS_PER_SESSION),
    now: o.now ?? Date.now(), fullId: o.fullId, paperId: o.paperId,
  });
  if (o.mode !== 'practice') void reportPaidFeatureUse(levelOf(o.subject), MODE_FEATURE[o.mode]); // ends refund eligibility; no-op while the paywall is off
  const next = await update((s) => ({ ...s, active, ...(o.fullExam ? { fullExam: o.fullExam } : {}) }));
  if (o.go !== false && !isUnsaved()) go('/session/'); // a failed write would be lost on navigation
  return next.active;
}
