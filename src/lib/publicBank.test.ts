import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// data/questions is committed and deployed (public). iPAS's 2026-11-05 reply: official questions may not be reproduced or
// adapted (改作), so neither official questions nor variants written from them (ids ending -V<n>) may ship. See ADR 0004.
const dir = join(import.meta.dirname, '..', '..', 'data', 'questions');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

describe('public question bank (data/questions)', () => {
  it('has question files to check', () => expect(files.length).toBeGreaterThan(0));
  it.each(files)('%s has no official question and no -V<n> variant', (f) => {
    const qs = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { id: string; source?: string }[];
    const bad = qs.filter((q) => q.source === 'official' || /-V\d+$/.test(String(q.id))).map((q) => q.id);
    expect(bad).toEqual([]);
  });
});
