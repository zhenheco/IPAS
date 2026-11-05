// Run after `astro build`, before any deploy: fails if dist embeds official questions or -V<n> variants (ADR 0004).
import path from 'node:path';
import { checkDist } from '../src/lib/distCheck';

const problems = checkDist(path.resolve(process.cwd(), 'dist'), process.env);
if (problems.length) {
  console.error(`dist check failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('dist check passed: no official or variant questions in the built output');
