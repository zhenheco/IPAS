import type { Question, QuestionStat, Subject } from './types';

export interface WeaknessRow { item: string; subject: Subject; attempts: number; correct: number; accuracy: number }

/** Accuracy per 知識點 over all recorded answers, weakest first (ties: more attempts first). */
export function aggregateWeakness(stats: Record<string, QuestionStat>, byId: Record<string, Question>, subject?: Subject) {
  const rows = new Map<string, WeaknessRow>();
  for (const [id, s] of Object.entries(stats)) {
    const q = byId[id];
    if (!q || s.attempts === 0 || (subject && q.subject !== subject)) continue;
    const r = rows.get(q.item) ?? { item: q.item, subject: q.subject, attempts: 0, correct: 0, accuracy: 0 };
    r.attempts += s.attempts;
    r.correct += s.correct;
    r.accuracy = r.correct / r.attempts;
    rows.set(q.item, r);
  }
  return [...rows.values()].sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts || a.item.localeCompare(b.item));
}
