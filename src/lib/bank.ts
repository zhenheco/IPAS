import fs from 'node:fs';
import path from 'node:path';
import type { Bank, Question, Syllabus } from './types';

export function isValidQuestion(x: unknown): x is Question {
  const q = x as Question;
  return !!q && typeof q === 'object' && typeof q.id === 'string' && [1, 2, 3].includes(q.subject) && typeof q.item === 'string' &&
    typeof q.stem === 'string' && Array.isArray(q.options) && q.options.length === 4 && q.options.every((o) => typeof o === 'string') &&
    Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 3 && (q.source === 'original' || q.source === 'official');
}

function readJson(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
}

function jsonFiles(dir: string): string[] {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(dir, f)); } catch { return []; }
}

export interface LoadOptions {
  dataDir: string;
  /** include source "official" (data/official/*.json); off by default */
  includeOfficial?: boolean;
  /** dev only: used when dataDir has no question files */
  fallbackDir?: string;
}

/** Never throws: missing/corrupt files give an empty bank so the build always succeeds. */
export function loadBank(o: LoadOptions): Bank {
  let files = jsonFiles(path.join(o.dataDir, 'questions'));
  let root = o.dataDir;
  if (!files.length && !(o.includeOfficial && jsonFiles(path.join(o.dataDir, 'official')).length) && o.fallbackDir) {
    root = o.fallbackDir;
    files = jsonFiles(path.join(root, 'questions'));
  }
  if (o.includeOfficial) files = [...files, ...jsonFiles(path.join(root, 'official'))];

  const seen = new Set<string>();
  const questions: Question[] = [];
  for (const f of files) {
    const data = readJson(f);
    for (const q of Array.isArray(data) ? data : []) {
      if (!isValidQuestion(q) || seen.has(q.id) || (q.source === 'official' && !o.includeOfficial)) continue;
      seen.add(q.id);
      questions.push(q);
    }
  }
  const syl = readJson(path.join(root, 'syllabus.json')) as Syllabus | undefined;
  return { questions, syllabus: syl && Array.isArray(syl.subjects) ? syl : { subjects: [] } };
}

/** Production build gate: the real data must be present, otherwise the site would ship empty. */
export function assertBankComplete(bank: Bank) {
  const problems: string[] = [];
  if (!bank.syllabus.subjects.length) problems.push('data/syllabus.json 不存在或無有效內容');
  if (!bank.questions.length) problems.push('data/questions/*.json 沒有任何有效題目');
  for (const s of [1, 3] as const) {
    if (bank.questions.length && !bank.questions.some((q) => q.subject === s)) problems.push(`data/questions 中沒有科目${s}的題目`);
  }
  if (problems.length) throw new Error(`題庫資料不完整，無法建置正式版：\n- ${problems.join('\n- ')}`);
}
