import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The repo has no DOM test environment, so this is checked at source level (same approach as src/lib/legal.test.ts).
const dir = import.meta.dirname;
const sources = readdirSync(dir).filter((f) => /\.(tsx?|astro)$/.test(f) && !f.endsWith('.test.ts')).map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);

describe('viewing a paid page does not end 退款資格', () => {
  it('Paywall never calls the usage endpoint or the report helper', () => {
    const paywall = readFileSync(join(dir, 'Paywall.tsx'), 'utf8');
    expect(paywall).not.toMatch(/reportPaidFeatureUse|usage\/paid-feature/);
  });
  it('start.ts (a session starting) is the only component that reports paid use', () => {
    expect(sources.filter(([, src]) => /reportPaidFeatureUse|usage\/paid-feature/.test(src)).map(([f]) => f)).toEqual(['start.ts']);
  });
});
