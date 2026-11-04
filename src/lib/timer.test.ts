import { describe, expect, it } from 'vitest';
import { BREAK_CAP_MS, EXAM_CAP_MS, daysUntil, deadlineFor, effectiveSubmitAt, formatClock, remainingMs, section2StartAt, shouldAutoSubmit } from './timer';

describe('timer', () => {
  const start = 1_700_000_000_000;
  it('caps are 90 and 30 minutes', () => {
    expect(EXAM_CAP_MS).toBe(90 * 60_000);
    expect(BREAK_CAP_MS).toBe(30 * 60_000);
  });
  it('deadline is a timestamp; remaining derives from it, so reload keeps time', () => {
    const d = deadlineFor(start, EXAM_CAP_MS);
    expect(d).toBe(start + 5_400_000);
    expect(remainingMs(d, start)).toBe(5_400_000);
    expect(remainingMs(d, start + 600_000)).toBe(4_800_000);
    // "reload" 30 minutes later: no stored remaining seconds needed
    expect(remainingMs(d, start + 1_800_000)).toBe(3_600_000);
  });
  it('remaining is clamped at 0', () => {
    expect(remainingMs(start, start + 5_000)).toBe(0);
  });
  it('auto-submit decision: only for timed sessions, at or after the deadline', () => {
    const d = deadlineFor(start, EXAM_CAP_MS);
    expect(shouldAutoSubmit({ deadline: d }, d - 1)).toBe(false);
    expect(shouldAutoSubmit({ deadline: d }, d)).toBe(true);
    expect(shouldAutoSubmit({ deadline: d }, d + 10 * 3_600_000)).toBe(true);
    expect(shouldAutoSubmit({ deadline: null }, d + 1e12)).toBe(false);
  });
  it('formatClock mm:ss, minutes may exceed 59', () => {
    expect(formatClock(5_400_000)).toBe('90:00');
    expect(formatClock(61_000)).toBe('01:01');
    expect(formatClock(999)).toBe('00:00');
    expect(formatClock(1000)).toBe('00:01');
    expect(formatClock(0)).toBe('00:00');
  });
  it('section 2 starts when the break ends: early end = now, expiry = break deadline', () => {
    const bd = start + BREAK_CAP_MS;
    expect(section2StartAt(bd, start + 60_000)).toBe(start + 60_000);
    expect(section2StartAt(bd, bd + 5 * 60_000)).toBe(bd);
  });
});

describe('effectiveSubmitAt', () => {
  it('is the earlier of now and the deadline; untimed uses now', () => {
    expect(effectiveSubmitAt(1000, 500)).toBe(500);
    expect(effectiveSubmitAt(1000, 9999)).toBe(1000);
    expect(effectiveSubmitAt(null, 9999)).toBe(9999);
  });
});

describe('daysUntil', () => {
  it('counts calendar days to the exam date', () => {
    expect(daysUntil('2026-11-14', new Date(2026, 10, 4, 23, 59))).toBe(10);
    expect(daysUntil('2026-11-14', new Date(2026, 10, 14, 0, 1))).toBe(0);
    expect(daysUntil('2026-11-14', new Date(2026, 10, 15, 9, 0))).toBe(-1);
  });
});
