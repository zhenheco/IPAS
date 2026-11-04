export interface SyllabusItem { code: string; name: string }
export interface SyllabusTopic { code: string; name: string; items: SyllabusItem[] }
export interface SyllabusSubject { subject: 1 | 2 | 3; code: string; name: string; topics: SyllabusTopic[] }
export interface Syllabus { subjects: SyllabusSubject[] }

/** 知識點 flattened with its 評鑑主題, in syllabus order. */
export interface ItemRef { code: string; name: string; topicCode: string; topicName: string }

export interface Question {
  id: string;
  subject: 1 | 2 | 3;
  item: string;
  stem: string;
  options: [string, string, string, string];
  answer: 0 | 1 | 2 | 3;
  explanation: string;
  related: string;
  source: "original";
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
