import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSiteBank } from './bankfile';
import { checkDist } from './distCheck';

// Deploys must never carry official questions or their -V<n> variants (iPAS reply 2026-11-05, ADR 0004).
// INCLUDE_OFFICIAL=1 stays valid for the owner's local self-study build, so the block is on the deploy path.
const q = (id: string, source = 'original') => ({ id, subject: 3, item: 'L23101', stem: 's', options: ['a', 'b', 'c', 'd'], answer: 0, explanation: '', related: '', source });
const dist = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'dist-'));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return dir;
};
const bank = (...qs: object[]) => JSON.stringify({ questions: qs, syllabus: { subjects: [] }, papers: [] });
const root = (p: string) => join(import.meta.dirname, '..', '..', p);

describe('checkDist', () => {
  it('passes a bank of original questions', () => {
    expect(checkDist(dist({ 'bank.json': bank(q('L23101-001'), q('L23101-002')), 'index.html': '<html></html>' }), {})).toEqual([]);
  });
  it('fails a bank that holds an official question', () => {
    const problems = checkDist(dist({ 'bank.json': bank(q('L23101-001'), q('OFF-115-1-S3-01', 'official')) }), {});
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('bank.json');
  });
  it('fails a bank that holds a -V<n> variant, even when marked original', () => {
    expect(checkDist(dist({ 'bank.json': bank(q('L23101-V001')) }), {})).toHaveLength(1);
  });
  it('also looks in other built files that embed questions (pretty-printed JSON, HTML-escaped props)', () => {
    expect(checkDist(dist({ 'a/data.json': JSON.stringify(JSON.parse(bank(q('x', 'official'))), null, 2) }), {})).toHaveLength(1);
    expect(checkDist(dist({ 'practice/index.html': '<x props="{&quot;id&quot;:&quot;L23101-V002&quot;}">' }), {})).toHaveLength(1);
  });
  it('fails when the build was made with INCLUDE_OFFICIAL=1', () => {
    expect(checkDist(dist({ 'bank.json': bank(q('L23101-001')) }), { INCLUDE_OFFICIAL: '1' })[0]).toContain('INCLUDE_OFFICIAL');
  });
  it('rejects a missing dist directory', () => {
    expect(checkDist(join(tmpdir(), 'no-such-dist-dir'), {})).toHaveLength(1);
  });
});

describe('deploy path', () => {
  const pkg = JSON.parse(readFileSync(root('package.json'), 'utf8')) as { scripts: Record<string, string> };
  const deploys = Object.entries(pkg.scripts).filter(([, cmd]) => cmd.includes('wrangler deploy'));
  it('both wrangler configs have a deploy script', () => {
    expect(deploys.map(([, c]) => c).some((c) => c.includes('-c wrangler.app.jsonc'))).toBe(true);
    expect(deploys.map(([, c]) => c).some((c) => !c.includes('-c '))).toBe(true);
  });
  it.each(deploys)('%s builds without INCLUDE_OFFICIAL, then runs the dist check, then deploys', (_name, cmd) => {
    const [build, check, deploy] = [cmd.indexOf('astro build'), cmd.indexOf('check:dist'), cmd.indexOf('wrangler deploy')];
    expect(build).toBeGreaterThanOrEqual(0);
    expect(cmd).toMatch(/env -u INCLUDE_OFFICIAL\b[^&]*astro build/);
    expect(check).toBeGreaterThan(build);
    expect(deploy).toBeGreaterThan(check);
  });
  it('a bare `wrangler deploy` of either config also runs the dist check first', () => {
    for (const f of ['wrangler.jsonc', 'wrangler.app.jsonc']) expect(readFileSync(root(f), 'utf8')).toMatch(/"build":\s*\{\s*"command":\s*"npm run check:dist"/);
  });
});

describe('loadSiteBank refuses INCLUDE_OFFICIAL=1 in CI', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('throws when CI is set', () => {
    vi.stubEnv('INCLUDE_OFFICIAL', '1');
    vi.stubEnv('CI', 'true');
    expect(() => loadSiteBank()).toThrow(/INCLUDE_OFFICIAL/);
  });
  it('still works locally (no CI)', () => {
    vi.stubEnv('INCLUDE_OFFICIAL', '1');
    vi.stubEnv('CI', '');
    expect(() => loadSiteBank()).not.toThrow();
  });
});
