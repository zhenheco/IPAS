import { certificateName, passScoreOf } from './levels';
import type { Question, Subject } from './types';

/** 中級 pass mark; use passScoreOf(subject) for a specific 科目 */
export const PASS_SCORE = 70;

export const isPassed = (score: number, subject?: Subject) => score >= (subject === undefined ? PASS_SCORE : passScoreOf(subject));

/** Each 科目 is scored out of 100, rounded to an integer; blanks are wrong, no negative marking. */
export function scoreAnswers(questions: Question[], answers: (number | null)[], subject?: Subject) {
  const total = questions.length;
  const correct = questions.filter((q, i) => answers[i] === q.answer).length;
  const score = total ? Math.round((correct / total) * 100) : 0;
  return { correct, total, score, passed: isPassed(score, subject) };
}

/** The first 科目 is shared; for 中級 the elective decides the 證書類別. Earned only if both 科目 pass. */
export function certificate(elective: Subject, score1: number, scoreElective: number, first?: Subject) {
  return {
    name: certificateName(elective),
    earned: isPassed(score1, first) && isPassed(scoreElective, elective),
  };
}
