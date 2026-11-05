import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

const pagesDir = new URL('../pages/', import.meta.url);
const base = readFileSync(new URL('../layouts/Base.astro', import.meta.url), 'utf8');
const pages = readdirSync(pagesDir).filter((f) => f.endsWith('.astro'));
const PRIVATE = ['account', 'login', 'result', 'session'];

describe('robots meta', () => {
  it('Base.astro renders robots noindex only when the noindex prop is set', () => {
    expect(base).toContain('{noindex && <meta name="robots" content="noindex" />}');
    expect(base.match(/name="robots"/g)).toHaveLength(1);
  });

  it('Base.astro defaults noindex to false (no site-wide noindex)', () => {
    expect(base).toMatch(/const\s*\{[^}]*\bnoindex\s*=\s*false\b[^}]*\}\s*=\s*Astro\.props/);
  });

  it('only per-user/transient pages pass noindex', () => {
    const flagged = pages
      .filter((f) => /<Base\b[^>]*\bnoindex\b/.test(readFileSync(new URL(f, pagesDir), 'utf8')))
      .map((f) => f.replace('.astro', ''))
      .sort();
    expect(flagged).toEqual(PRIVATE);
  });
});
