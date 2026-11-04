import type { Question, SourceChoice } from './types';

/** The 題目來源 choice is offered only when the loaded bank actually has 官方歷屆試題. */
export const hasOfficial = (questions: Question[]) => questions.some((q) => q.source === 'official');

export const filterBySource = (pool: Question[], choice: SourceChoice | undefined) =>
  !choice || choice === 'all' ? pool : pool.filter((q) => q.source === choice);
