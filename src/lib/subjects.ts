import type { Subject } from './types';

/** Default tab: the first 科目 that has data, else the first 科目 shown. */
export const firstSubjectWithData = (subjects: Subject[], hasData: (s: Subject) => boolean): Subject =>
  subjects.find(hasData) ?? subjects[0] ?? 1;
