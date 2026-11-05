import fs from 'node:fs';
import path from 'node:path';

// Official questions and their -V<n> variants must never ship (iPAS reply 2026-11-05, ADR 0004). Text scan, so it also
// catches questions inlined in HTML/JS, pretty-printed JSON, and HTML-escaped props (&quot;).
const OFFICIAL = /"source"\s*:\s*"official"/;
const VARIANT = /"id"\s*:\s*"[^"]*-V\d+"/;

function* files(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (/\.(json|html|js|mjs|txt)$/.test(e.name)) yield p;
  }
}

/** Problems that make a build undeployable; empty means safe. `env` is the environment the build ran in. */
export function checkDist(dist: string, env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  if (env.INCLUDE_OFFICIAL === '1') problems.push('INCLUDE_OFFICIAL=1 is set: that is the local self-study build, never deploy it');
  if (!fs.existsSync(dist)) return [...problems, `${dist} does not exist; run the build first`];
  for (const f of files(dist)) {
    const text = fs.readFileSync(f, 'utf8').replaceAll('&quot;', '"');
    if (OFFICIAL.test(text)) problems.push(`${f} contains a question with source "official"`);
    if (VARIANT.test(text)) problems.push(`${f} contains a -V<n> variant question`);
  }
  return problems;
}
