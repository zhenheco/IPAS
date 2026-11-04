export interface SyllabusItem { code: string; name: string }
export interface SyllabusTopic { code: string; name: string; items: SyllabusItem[] }
/** 中級 1-3 (L21-L23), 初級 11-12 (L11-L12) */
export type SubjectNo = 1 | 2 | 3 | 11 | 12;
export const SUBJECT_NOS: readonly SubjectNo[] = [1, 2, 3, 11, 12];

export interface SyllabusSubject { subject: SubjectNo; code: string; name: string; topics: SyllabusTopic[] }
export interface Syllabus { subjects: SyllabusSubject[] }

/** 知識點 flattened with its 評鑑主題, in syllabus order. */
export interface ItemRef { code: string; name: string; topicCode: string; topicName: string }

export interface Question {
  id: string;
  subject: SubjectNo;
  item: string;
  stem: string;
  options: [string, string, string, string];
  answer: 0 | 1 | 2 | 3;
  explanation: string;
  related: string;
  source: "original" | "official";
}

/** What the model returns per question (no id/subject/item/source: we own those). */
export interface RawQuestion {
  stem: string;
  options: string[];
  answer: number;
  explanation: string;
  related: string;
}

export interface Usage { input: number; output: number }
