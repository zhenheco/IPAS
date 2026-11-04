/** 中級 time limit; per-科目 limits come from levels.ts examCapMs */
export const EXAM_CAP_MS = 90 * 60_000;
export const BREAK_CAP_MS = 30 * 60_000;

export const deadlineFor = (startedAt: number, capMs: number) => startedAt + capMs;
export const remainingMs = (deadline: number, now: number) => Math.max(0, deadline - now);

/** Timed sessions auto-submit at or after the stored deadline (also when the page was closed). */
export const shouldAutoSubmit = (s: { deadline: number | null }, now: number) =>
  s.deadline !== null && now >= s.deadline;

export function formatClock(ms: number) {
  const total = Math.floor(ms / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  return `${mm}:${String(total % 60).padStart(2, '0')}`;
}

/** 全真模考 section 2 starts when the break ends: early end = now, expiry = the break deadline. */
export const section2StartAt = (breakDeadline: number, now: number) => Math.min(now, breakDeadline);

/** Whole calendar days from `now` (local) to an ISO date; negative once passed. */
export function daysUntil(isoDate: string, now: Date) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

/** When a submit counts as having happened: late (reopened/auto) submits are stamped at the deadline. */
export const effectiveSubmitAt = (deadline: number | null, now: number) => (deadline === null ? now : Math.min(now, deadline));
