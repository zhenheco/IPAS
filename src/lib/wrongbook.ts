import type { Mode, Question, QuestionStat, Subject } from './types';

const fresh = (): QuestionStat => ({ attempts: 0, correct: 0, wrong: 0, lastWrongAt: null, redoStreak: 0, inWrongBook: false });

/** Leave 錯題本 after this many consecutive correct answers in 錯題重做. */
export const REDO_STREAK_TO_LEAVE = 2;

/** `correct` is false for wrong and blank answers alike (owner rule: a blank is wrong everywhere). */
export function applyResults(
  stats: Record<string, QuestionStat>,
  results: { questionId: string; correct: boolean }[],
  mode: Mode,
  nowIso: string,
) {
  const next = { ...stats };
  for (const { questionId, correct } of results) {
    const s = { ...(next[questionId] ?? fresh()) };
    s.attempts++;
    if (correct) {
      s.correct++;
      if (mode === 'redo' && s.inWrongBook && ++s.redoStreak >= REDO_STREAK_TO_LEAVE) {
        s.inWrongBook = false;
        s.redoStreak = 0;
      }
    } else {
      s.wrong++;
      s.lastWrongAt = nowIso;
      s.inWrongBook = true;
      s.redoStreak = 0;
    }
    next[questionId] = s;
  }
  return next;
}

export function wrongBookIds(stats: Record<string, QuestionStat>, byId: Record<string, Question>, subject?: Subject) {
  return Object.keys(stats).filter((id) => stats[id].inWrongBook && byId[id] && (!subject || byId[id].subject === subject));
}

export function groupWrongBook(stats: Record<string, QuestionStat>, byId: Record<string, Question>, subject?: Subject) {
  const groups = new Map<string, { item: string; entries: { question: Question; stat: QuestionStat }[] }>();
  for (const id of wrongBookIds(stats, byId, subject)) {
    const question = byId[id];
    const g = groups.get(question.item) ?? { item: question.item, entries: [] };
    g.entries.push({ question, stat: stats[id] });
    groups.set(question.item, g);
  }
  for (const g of groups.values()) g.entries.sort((a, b) => b.stat.wrong - a.stat.wrong);
  return [...groups.values()].sort((a, b) => a.item.localeCompare(b.item));
}
