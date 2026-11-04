import { daysUntil } from './timer';
import { applyResults, wrongBookIds } from './wrongbook';
import { fullFirstOf } from './levels';
import type { Question, QuestionStat, Session, Subject } from './types';
import type { WeaknessRow } from './weakness';

export interface PlanTask {
  kind: 'practice' | 'redo' | 'full';
  subject?: Subject;
  /** 知識點 code (練習 only) */
  item?: string;
  /** exam-eve light review */
  quick?: boolean;
  /** cap on the number of 題目 drawn; absent = a normal full set */
  limit?: number;
  done: boolean;
}
/** `date` is the local calendar day (YYYY-MM-DD); `daysToExam` is 1 on exam eve. */
export interface PlanDay { date: string; daysToExam: number; eve: boolean; tasks: PlanTask[] }

export interface PlanInput {
  today: Date;
  examDate: string;
  subjects: Subject[];
  /** 知識點 that can actually be practised (see planItems) */
  items: { code: string; subject: Subject }[];
  weakness: WeaknessRow[];
  /** 錯題本 size per 科目 */
  wrongBook: Partial<Record<Subject, number>>;
  history: Session[];
  byId: Record<string, Question>;
}

export const FULL_EVERY_DAYS = 3;
/** exam-eve light review: 題目 per quick-review 知識點, and in the eve 錯題重做 */
export const QUICK_REVIEW_LIMIT = 10;
export const EVE_REDO_LIMIT = 20;
const MIN_PRACTICE = 2;
// shortcut: with too few days some 知識點 stay unscheduled (weakest first) instead of piling on a day; raise if that proves too soft
const MAX_PRACTICE = 4;

export function planItems(questions: Question[], subjects: Subject[]) {
  const seen = new Map<string, Subject>();
  for (const q of questions) if (subjects.includes(q.subject)) seen.set(q.item, q.subject);
  return [...seen].map(([code, subject]) => ({ code, subject })).sort((a, b) => a.code.localeCompare(b.code));
}

export const dayKey = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** 全真模考 every 3 days counting back from 3 days before the exam; with only 2 days left, 2 days before. Never on the eve. */
const isFullDay = (k: number, n: number) => k >= 2 && (k % FULL_EVERY_DAYS === 0 || (n === 2 && k === 2));

/** Weakest first; a 知識點 never attempted ranks first of all. */
function byWeakness(items: PlanInput['items'], weakness: { item: string; attempts: number; correct: number }[]) {
  const rank = new Map(weakness.map((w) => [w.item, w]));
  const acc = (c: string) => { const w = rank.get(c); return w && w.attempts > 0 ? w.correct / w.attempts : -1; };
  return [...items].sort((a, b) =>
    acc(a.code) - acc(b.code) || (rank.get(b.code)?.attempts ?? 0) - (rank.get(a.code)?.attempts ?? 0) || a.code.localeCompare(b.code));
}

export function buildPlan(i: PlanInput): PlanDay[] {
  const n = daysUntil(i.examDate, i.today);
  if (n <= 0) return [];

  // the plan is built from the records as they stood before today, so finishing a task never reshuffles it
  const todayKey = dayKey(i.today);
  const todays = i.history.filter((s) => dayKey(new Date(s.submittedAt)) === todayKey);
  const adjusted = new Map(i.weakness.map((w) => [w.item, { item: w.item, attempts: w.attempts, correct: w.correct }]));
  for (const s of todays) {
    s.questionIds.forEach((id, idx) => {
      const q = i.byId[id];
      const w = q && adjusted.get(q.item);
      if (!w) return;
      w.attempts = Math.max(0, w.attempts - 1);
      if (s.answers[idx] === q.answer) w.correct = Math.max(0, w.correct - 1);
    });
  }
  const items = byWeakness(i.items.filter((x) => i.subjects.includes(x.subject)), [...adjusted.values()]);
  const redoneToday = i.subjects.filter((s) => todays.some((x) => x.mode === 'redo' && x.subject === s));
  const liveWrong = i.subjects.filter((s) => (i.wrongBook[s] ?? 0) > 0);
  // Today's 錯題重做 follows the 錯題本 as it stood at the start of the day, so wrong answers made today can't switch it.
  // That state is replayed from the earlier sessions; with nothing done today it is simply the live one.
  let startOfDayWrong = liveWrong;
  if (todays.length) {
    let before: Record<string, QuestionStat> = {};
    for (const s of i.history.filter((x) => !todays.includes(x)).sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt))) {
      const results = s.questionIds.flatMap((id, idx) => (i.byId[id] ? [{ questionId: id, correct: s.answers[idx] === i.byId[id].answer }] : []));
      before = applyResults(before, results, s.mode, s.submittedAt);
    }
    startOfDayWrong = i.subjects.filter((s) => wrongBookIds(before, i.byId, s).length > 0 || redoneToday.includes(s));
  }
  const fullDays = Array.from({ length: n - 1 }, (_, idx) => n - idx).filter((k) => isFullDay(k, n)).length;
  const studyDays = n - 1;
  const perDay = Math.min(MAX_PRACTICE, Math.max(MIN_PRACTICE, Math.ceil((items.length - fullDays) / Math.max(1, studyDays - fullDays))));

  // done = matching activity submitted on that local calendar day
  const sessionsByDay = new Map<string, Session[]>();
  for (const s of i.history) {
    const k = dayKey(new Date(s.submittedAt));
    sessionsByDay.set(k, [...(sessionsByDay.get(k) ?? []), s]);
  }
  const practiced = (day: string, item: string) =>
    (sessionsByDay.get(day) ?? []).some((s) => s.mode === 'practice' && s.questionIds.some((id) => i.byId[id]?.item === item));
  const didRedo = (day: string, subject: Subject) =>
    (sessionsByDay.get(day) ?? []).some((s) => s.mode === 'redo' && s.subject === subject);
  // 全真模考 counts once both sections of one exam are submitted, on the day the second one was
  const fullDoneDays = new Set<string>();
  const fullParts = new Map<string, Session[]>();
  for (const s of i.history) if (s.mode === 'full' && s.fullId) fullParts.set(s.fullId, [...(fullParts.get(s.fullId) ?? []), s]);
  for (const parts of fullParts.values()) {
    const first = fullFirstOf(parts[0]!.subject); // 初級 or 中級: both sections share the level
    if (parts.some((s) => s.subject === first) && parts.some((s) => s.subject !== first)) {
      fullDoneDays.add(dayKey(new Date(Math.max(...parts.map((s) => Date.parse(s.submittedAt))))));
    }
  }

  const wrongFor = (d: number) => (d === 0 ? startOfDayWrong : liveWrong);

  let cursor = 0; // next 知識點 in weakest-first order; wraps so later days repeat the weakest first
  const days: PlanDay[] = [];
  for (let d = 0; d < n; d++) {
    const date = dayKey(new Date(i.today.getFullYear(), i.today.getMonth(), i.today.getDate() + d));
    const k = n - d;
    const eve = k === 1;
    const tasks: PlanTask[] = [];

    if (eve) {
      for (const s of wrongFor(d)) tasks.push({ kind: 'redo', subject: s, limit: EVE_REDO_LIMIT, done: didRedo(date, s) });
      for (const s of i.subjects) {
        const weakest = items.find((x) => x.subject === s);
        if (weakest) tasks.push({ kind: 'practice', subject: s, item: weakest.code, quick: true, limit: QUICK_REVIEW_LIMIT, done: practiced(date, weakest.code) });
      }
    } else {
      const full = isFullDay(k, n);
      const count = Math.min(items.length, full ? 1 : perDay);
      for (let j = 0; j < count; j++) {
        const it = items[(cursor + j) % items.length];
        tasks.push({ kind: 'practice', subject: it.subject, item: it.code, done: practiced(date, it.code) });
      }
      cursor += count;
      const wrongSubjects = wrongFor(d);
      if (wrongSubjects.length) {
        const s = wrongSubjects[d % wrongSubjects.length];
        tasks.push({ kind: 'redo', subject: s, done: didRedo(date, s) });
      }
      if (full) tasks.push({ kind: 'full', done: fullDoneDays.has(date) });
    }
    days.push({ date, daysToExam: k, eve, tasks });
  }
  return days;
}
