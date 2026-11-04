// npm run papers: (re)build data/papers.json from data/questions; existing papers are kept, new ones appended.
import fs from 'node:fs';
import path from 'node:path';
import { QUESTIONS_PER_SESSION } from '../src/config';
import { loadBank } from '../src/lib/bank';
import { ALL_SUBJECTS, subjectLabel } from '../src/lib/levels';
import { buildPapers } from '../src/lib/papers';
import type { Paper } from '../src/lib/types';

const dataDir = path.resolve(process.cwd(), 'data');
const file = path.join(dataDir, 'papers.json');
const bank = loadBank({ dataDir });
const existing: Paper[] = bank.papers;
const all = ALL_SUBJECTS.flatMap((s) => buildPapers(bank.questions, s, QUESTIONS_PER_SESSION, existing));
fs.writeFileSync(file, JSON.stringify(all, null, 1) + '\n');
for (const s of ALL_SUBJECTS) {
  const n = all.filter((p) => p.subject === s).length;
  if (n) console.log(`${subjectLabel(s)}: ${n} 回`);
}
