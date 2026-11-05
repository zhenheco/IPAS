import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AD_UNITS } from './adUnits';

const src = (f: string) => readFileSync(new URL(`../components/${f}`, import.meta.url), 'utf8');
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe('AD_UNITS', () => {
  it('maps the three AdSense ad units to their 10-digit IDs', () => {
    expect(AD_UNITS).toEqual({ home: '8140139966', session: '1669713341', result: '3461307163' });
    for (const id of Object.values(AD_UNITS)) expect(id).toMatch(/^\d{10}$/);
  });
});

// no component-test setup (no jsdom), so the wiring is asserted on source
describe('ad slot wiring', () => {
  it('AdSlot renders the mapped numeric ID, not the raw slot name', () => {
    const s = src('AdSlot.tsx');
    expect(s).toContain('data-ad-slot={AD_UNITS[slot]}');
    expect(s).toContain('slot: AdUnit');
  });
  it('Home and Result use their own slot, once', () => {
    expect(count(src('Home.tsx'), 'slot="home"')).toBe(1);
    expect(count(src('Result.tsx'), 'slot="result"')).toBe(1);
  });
  it('Session renders the session ad once, after the question-grid legend', () => {
    const s = src('Session.tsx');
    expect(count(s, '<AdSlot slot="session" level={levelOf(active.subject)} />')).toBe(1);
    expect(s.indexOf('<AdSlot')).toBeGreaterThan(s.indexOf('class="muted legend"'));
  });
});
