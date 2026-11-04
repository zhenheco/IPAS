import type { Question, Subject, Syllabus } from './types';

/** 評鑑主題 code of a 知識點 code (L23301 -> L233). */
export const topicOf = (item: string) => item.slice(0, 4);

export const itemName = (syl: Syllabus, code: string) =>
  syl.subjects.flatMap((s) => s.topics).flatMap((t) => t.items).find((i) => i.code === code)?.name ?? code;

export const topicName = (syl: Syllabus, code: string) =>
  syl.subjects.flatMap((s) => s.topics).find((t) => t.code === code)?.name ?? code;

export function filterPool(pool: Question[], f: { subject: Subject; topic?: string; item?: string }) {
  return pool.filter((q) => q.subject === f.subject && (f.item ? q.item === f.item : !f.topic || topicOf(q.item) === f.topic));
}
