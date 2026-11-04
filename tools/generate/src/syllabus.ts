import fs from "node:fs";
import type { ItemRef, Syllabus, SyllabusSubject } from "./types.js";

export function loadSyllabus(path: string): Syllabus {
  return JSON.parse(fs.readFileSync(path, "utf8")) as Syllabus;
}

export function getSubject(s: Syllabus, n: number): SyllabusSubject {
  const sub = s.subjects.find((x) => x.subject === n);
  if (!sub) throw new Error(`syllabus.json has no subject ${n}`);
  return sub;
}

export function subjectItems(s: SyllabusSubject): ItemRef[] {
  return s.topics.flatMap((t) => t.items.map((i) => ({ ...i, topicCode: t.code, topicName: t.name })));
}
