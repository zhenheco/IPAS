import type { Question } from './types';

export const PASS_SCORE = 70;

export const isPassed = (score: number) => score >= PASS_SCORE;

/** Each 科目 is scored out of 100, rounded to an integer; blanks are wrong, no negative marking. */
export function scoreAnswers(questions: Question[], answers: (number | null)[]) {
  const total = questions.length;
  const correct = questions.filter((q, i) => answers[i] === q.answer).length;
  const score = total ? Math.round((correct / total) * 100) : 0;
  return { correct, total, score, passed: isPassed(score) };
}

/** 科目1 is shared; the elective decides the 證書類別. Earned only if both 科目 pass. */
export function certificate(elective: 2 | 3, score1: number, scoreElective: number) {
  return {
    name: elective === 3 ? '機器學習' : '數據分析',
    earned: isPassed(score1) && isPassed(scoreElective),
  };
}
