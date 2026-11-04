import { describe, expect, it } from 'vitest';
import { EVE_REDO_LIMIT, QUICK_REVIEW_LIMIT, buildPlan, planItems, type PlanInput, type PlanTask } from './plan';
import type { Question, Session, Subject } from './types';
import type { WeaknessRow } from './weakness';

const mkQ = (id: string, item: string, subject: Subject = 3): Question => ({
  id, subject, item, stem: '', options: ['a', 'b', 'c', 'd'], answer: 0, explanation: '', related: '', source: 'original',
});
const row = (item: string, attempts: number, correct: number, subject: Subject = 3): WeaknessRow =>
  ({ item, subject, attempts, correct, accuracy: correct / attempts });
const sess = (mode: Session['mode'], subject: Subject, questionIds: string[], at: Date): Session => ({
  id: `${mode}-${at.getTime()}`, mode, subject, startedAt: at.toISOString(), submittedAt: at.toISOString(),
  questionIds, answers: questionIds.map(() => 0), score: 50,
});

const TODAY = new Date(2026, 10, 4, 10, 0); // local; exam 2026-11-14 is 10 days away
const code = (n: number) => `L23${String(n).padStart(3, '0')}`;
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ code: code(101 + i), subject: 3 as Subject }));

const base = (o: Partial<PlanInput> = {}): PlanInput => ({
  today: TODAY, examDate: '2026-11-14', subjects: [3], items: items(6), weakness: [], wrongBook: {}, history: [], byId: {}, ...o,
});
const kinds = (tasks: PlanTask[], kind: PlanTask['kind']) => tasks.filter((t) => t.kind === kind);
const practiceItems = (plan: ReturnType<typeof buildPlan>) => plan.flatMap((d) => kinds(d.tasks, 'practice').map((t) => t.item));

describe('buildPlan: range', () => {
  it('is empty on the exam date and after it', () => {
    expect(buildPlan(base({ today: new Date(2026, 10, 14, 8) }))).toEqual([]);
    expect(buildPlan(base({ today: new Date(2026, 10, 20) }))).toEqual([]);
  });
  it('runs from today through exam eve, one entry per calendar day', () => {
    const plan = buildPlan(base());
    expect(plan).toHaveLength(10);
    expect(plan[0]).toMatchObject({ date: '2026-11-04', daysToExam: 10, eve: false });
    expect(plan.at(-1)).toMatchObject({ date: '2026-11-13', daysToExam: 1, eve: true });
    expect(plan.filter((d) => d.eve)).toHaveLength(1);
  });
});

describe('buildPlan: exam eve', () => {
  it('with 1 day left the only day is a light review: 錯題重做 + weakest 知識點, no 全真模考', () => {
    const plan = buildPlan(base({
      today: new Date(2026, 10, 13, 9), wrongBook: { 3: 4 },
      weakness: [row(code(103), 4, 1), row(code(101), 4, 3)],
    }));
    expect(plan).toHaveLength(1);
    const [eve] = plan;
    expect(eve.eve).toBe(true);
    expect(kinds(eve.tasks, 'full')).toHaveLength(0);
    expect(kinds(eve.tasks, 'redo')).toEqual([{ kind: 'redo', subject: 3, limit: EVE_REDO_LIMIT, done: false }]);
    expect(kinds(eve.tasks, 'practice')).toEqual([{ kind: 'practice', subject: 3, item: code(102), quick: true, limit: QUICK_REVIEW_LIMIT, done: false }]);
  });
  it('quick review picks the weakest 知識點 of each chosen 科目; no redo when 錯題本 is empty', () => {
    const eve = buildPlan(base({
      today: new Date(2026, 10, 13), subjects: [1, 3],
      items: [{ code: 'L21101', subject: 1 }, { code: 'L21102', subject: 1 }, { code: code(101), subject: 3 }],
      weakness: [row('L21101', 4, 4, 1), row(code(101), 4, 2)],
    }))[0];
    expect(eve.tasks.map((t) => [t.kind, t.subject, t.item])).toEqual([['practice', 1, 'L21102'], ['practice', 3, code(101)]]);
  });
});

describe('buildPlan: 全真模考 days', () => {
  const fullIdx = (days: number) => {
    const plan = buildPlan(base({ today: new Date(2026, 10, 14 - days) }));
    return plan.flatMap((d, i) => (kinds(d.tasks, 'full').length ? [i] : []));
  };
  it('falls every 3 days counting back from 3 days before the exam, never on the eve', () => {
    expect(fullIdx(10)).toEqual([1, 4, 7]);
    expect(fullIdx(4)).toEqual([1]);
    expect(fullIdx(3)).toEqual([0]);
  });
  it('with only 2 days left there is still one, 2 days before the exam; with 1 day left none', () => {
    expect(fullIdx(2)).toEqual([0]);
    expect(fullIdx(1)).toEqual([]);
  });
  it('the last 全真模考 is always 2 to 3 days before the exam when the period allows', () => {
    for (let n = 2; n <= 30; n++) {
      const plan = buildPlan(base({ today: new Date(2026, 10, 14 - n) }));
      const last = plan.filter((d) => kinds(d.tasks, 'full').length).at(-1)!;
      expect([2, 3]).toContain(last.daysToExam);
    }
  });
});

describe('buildPlan: 練習 tasks', () => {
  it('orders weakest first, with never-attempted 知識點 weakest of all', () => {
    const weakness = [row(code(101), 4, 1), row(code(102), 4, 3), row(code(103), 4, 2)];
    const plan = buildPlan(base({ items: items(5), weakness, today: new Date(2026, 10, 12) })); // days: 12(full? k=2) and eve
    const first = kinds(plan[0].tasks, 'practice').map((t) => t.item);
    expect(first).toEqual([code(104)]); // full day: 1 practice slot, the first never-attempted item
    const order = practiceItems(buildPlan(base({ items: items(5), weakness })));
    expect(order.slice(0, 5)).toEqual([code(104), code(105), code(101), code(103), code(102)]);
  });
  it('covers every 知識點 at least once before the eve when days allow', () => {
    const plan = buildPlan(base({ items: items(12), weakness: [row(code(101), 2, 1)] }));
    const nonEve = plan.filter((d) => !d.eve);
    const covered = new Set(nonEve.flatMap((d) => kinds(d.tasks, 'practice').map((t) => t.item)));
    expect(covered.size).toBe(12);
  });
  it('every task of a day names a 科目 that was chosen and a 知識點 from the list', () => {
    const plan = buildPlan(base({ subjects: [1, 3], items: [{ code: 'L21101', subject: 1 }, ...items(3)] }));
    for (const t of plan.flatMap((d) => kinds(d.tasks, 'practice'))) {
      expect(t.item).toMatch(/^L2(1101|3\d{3})$/);
      expect(t.subject).toBe(t.item === 'L21101' ? 1 : 3);
    }
  });
  it('with more 知識點 than the days can hold, the weakest are scheduled first and nothing repeats', () => {
    const its = items(40);
    const weakness = its.map((it, i) => row(it.code, 100, i)); // accuracy rises with the code
    const plan = buildPlan(base({ today: new Date(2026, 10, 11), items: its, weakness })); // 3 days: full, normal, eve
    const scheduled = plan.filter((d) => !d.eve).flatMap((d) => kinds(d.tasks, 'practice').map((t) => t.item));
    expect(scheduled).toEqual(its.slice(0, 5).map((i) => i.code));
  });
  it('all strong, no history, and no items each still produce a valid plan', () => {
    const strong = items(4).map((i) => row(i.code, 5, 5));
    expect(buildPlan(base({ items: items(4), weakness: strong })).filter((d) => !d.eve).every((d) => kinds(d.tasks, 'practice').length > 0)).toBe(true);
    expect(buildPlan(base())).toHaveLength(10);
    const none = buildPlan(base({ items: [] }));
    expect(none).toHaveLength(10);
    expect(practiceItems(none)).toEqual([]);
  });
  it('is deterministic', () => {
    expect(buildPlan(base({ items: items(9) }))).toEqual(buildPlan(base({ items: items(9) })));
  });
});

describe('buildPlan: 錯題重做', () => {
  it('appears only while 錯題本 is non-empty', () => {
    expect(buildPlan(base()).flatMap((d) => kinds(d.tasks, 'redo'))).toEqual([]);
    const plan = buildPlan(base({ wrongBook: { 3: 2 } }));
    expect(plan.every((d) => kinds(d.tasks, 'redo').length > 0)).toBe(true);
  });
  it('rotates through the 科目 that have wrong answers', () => {
    const plan = buildPlan(base({ subjects: [1, 3], wrongBook: { 1: 3, 3: 5 } }));
    expect(plan.filter((d) => !d.eve).slice(0, 4).map((d) => kinds(d.tasks, 'redo')[0].subject)).toEqual([1, 3, 1, 3]);
    expect(plan.at(-1)!.tasks.filter((t) => t.kind === 'redo').map((t) => t.subject)).toEqual([1, 3]);
  });
  it('ignores 科目 that are not chosen', () => {
    const plan = buildPlan(base({ wrongBook: { 1: 3 } }));
    expect(plan.flatMap((d) => kinds(d.tasks, 'redo'))).toEqual([]);
  });
});

describe('buildPlan: done', () => {
  const q1 = mkQ('q1', code(101));
  const q2 = mkQ('q2', code(102));
  const byId = { q1, q2 };
  const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 10, 4 + dayOffset, h, m);
  const todayOf = (history: Session[], o: Partial<PlanInput> = {}) =>
    buildPlan(base({ items: [{ code: code(101), subject: 3 }, { code: code(102), subject: 3 }], byId, history, wrongBook: { 3: 1 }, ...o }))[0];
  const done = (d: ReturnType<typeof todayOf>) => d.tasks.filter((t) => t.done).map((t) => [t.kind, t.item]);

  it('nothing is done without history', () => {
    expect(done(todayOf([]))).toEqual([]);
  });
  it('a 練習 on that 知識點 today marks it done, others stay open', () => {
    const d = todayOf([sess('practice', 3, ['q1'], at(9))]);
    expect(done(d)).toEqual([['practice', code(101)]]);
  });
  it('a 練習 that was on another day does not count', () => {
    expect(done(todayOf([sess('practice', 3, ['q1'], at(9, 0, -1))]))).toEqual([]);
  });
  it('uses local calendar days: 23:59 counts for today, 00:01 tomorrow does not', () => {
    expect(done(todayOf([sess('practice', 3, ['q1'], at(23, 59))]))).toEqual([['practice', code(101)]]);
    expect(done(todayOf([sess('practice', 3, ['q1'], at(0, 1, 1))]))).toEqual([]);
  });
  it('only 練習 sessions count for 練習 tasks; 錯題重做 and 全真模考 match their own mode', () => {
    expect(done(todayOf([sess('exam', 3, ['q1'], at(9))]))).toEqual([]);
    expect(done(todayOf([sess('redo', 3, ['q1'], at(9))]))).toEqual([['redo', undefined]]);
  });
  it('a 錯題重做 of another 科目does not complete this one', () => {
    expect(done(todayOf([sess('redo', 1, ['q1'], at(9))]))).toEqual([]);
  });
  it('questions missing from the bank are ignored', () => {
    expect(done(todayOf([sess('practice', 3, ['gone'], at(9))]))).toEqual([]);
  });
  it('days after today are never done', () => {
    const plan = buildPlan(base({ items: [{ code: code(101), subject: 3 }], byId, history: [sess('practice', 3, ['q1'], at(9))] }));
    expect(plan.slice(1).flatMap((d) => d.tasks).some((t) => t.done)).toBe(false);
  });
});

describe('buildPlan: caps for the exam-eve light review', () => {
  it('quick review is 10 題 and exam-eve 錯題重做 is 20 題; ordinary tasks are uncapped', () => {
    expect(QUICK_REVIEW_LIMIT).toBe(10);
    expect(EVE_REDO_LIMIT).toBe(20);
    const eve = buildPlan(base({ today: new Date(2026, 10, 13), wrongBook: { 3: 40 } }))[0];
    expect(eve.tasks.map((t) => [t.kind, t.limit])).toEqual([['redo', 20], ['practice', 10]]);
    const plan = buildPlan(base({ wrongBook: { 3: 40 } }));
    expect(plan.filter((d) => !d.eve).flatMap((d) => d.tasks).every((t) => t.limit === undefined)).toBe(true);
  });
});

describe('buildPlan: 全真模考 is done only when both sections are submitted', () => {
  const T = new Date(2026, 10, 11, 12); // 3 days left: day 0 is a 全真模考 day
  const part = (fullId: string, subject: Subject, at: Date): Session => ({ ...sess('full', subject, ['x'], at), id: `${fullId}-${subject}`, fullId });
  const fullTask = (history: Session[], today = T) => buildPlan(base({ today, items: items(1), history }))[0].tasks.find((t) => t.kind === 'full')!;

  it('section 1 alone does not complete it', () => {
    expect(fullTask([part('F', 1, new Date(2026, 10, 11, 9))]).done).toBe(false);
  });
  it('both sections of the same exam complete it', () => {
    expect(fullTask([part('F', 1, new Date(2026, 10, 11, 9)), part('F', 3, new Date(2026, 10, 11, 11))]).done).toBe(true);
  });
  it('sections of different exams do not combine, and an unlinked session is ignored', () => {
    expect(fullTask([part('A', 1, new Date(2026, 10, 11, 9)), part('B', 3, new Date(2026, 10, 11, 11))]).done).toBe(false);
    expect(fullTask([sess('full', 1, ['x'], new Date(2026, 10, 11, 9)), sess('full', 3, ['x'], new Date(2026, 10, 11, 11))]).done).toBe(false);
  });
  it('is dated by the completion time: finishing after midnight belongs to the next day', () => {
    const history = [part('F', 1, new Date(2026, 10, 11, 23, 30)), part('F', 3, new Date(2026, 10, 12, 0, 30))];
    expect(fullTask(history, new Date(2026, 10, 11, 12)).done).toBe(false);
    expect(fullTask(history, new Date(2026, 10, 12, 12)).done).toBe(true); // 2 days left: day 0 is the 全真模考 day
  });
});

describe('buildPlan: today stays stable while you work through it', () => {
  const its = items(3);
  const qs = Array.from({ length: 5 }, (_, i) => mkQ(`a${i}`, code(101)));
  const byId = Object.fromEntries(qs.map((q) => [q.id, q]));
  const morning = { today: new Date(2026, 10, 4, 8) };
  const practiceToday = sess('practice', 3, qs.map((q) => q.id), new Date(2026, 10, 4, 9));
  // 101 was weakest (1/5); after five correct answers today it is 6/10 and would overtake 102 (50%)
  const before = [row(code(101), 5, 1), row(code(102), 4, 2), row(code(103), 5, 4)];
  const after = [row(code(101), 10, 6), row(code(102), 4, 2), row(code(103), 5, 4)];

  it("finishing today's first 知識點 does not replace it; it is just marked done", () => {
    const planned = buildPlan(base({ ...morning, items: its, byId, weakness: before }))[0];
    const later = buildPlan(base({ ...morning, items: its, byId, weakness: after, history: [practiceToday] }))[0];
    expect(planned.tasks.map((t) => t.item)).toEqual([code(101), code(102)]);
    expect(later.tasks.map((t) => t.item)).toEqual([code(101), code(102)]);
    expect(later.tasks.map((t) => t.done)).toEqual([true, false]);
  });
  it('tomorrow onwards is also unaffected by what was done today', () => {
    const a = buildPlan(base({ ...morning, items: its, byId, weakness: before }));
    const b = buildPlan(base({ ...morning, items: its, byId, weakness: after, history: [practiceToday] }));
    expect(b.map((d) => d.tasks.map((t) => t.item))).toEqual(a.map((d) => d.tasks.map((t) => t.item)));
  });
  it("a 知識點 first attempted today still counts as never-attempted for today's plan", () => {
    const fresh = buildPlan(base({ ...morning, items: its, byId, weakness: [row(code(101), 5, 5), row(code(102), 4, 2), row(code(103), 5, 4)], history: [practiceToday] }))[0];
    // 101's only attempts are today's (5/5): excluding them it has no history, so it ranks first
    expect(fresh.tasks[0]).toMatchObject({ item: code(101), done: true });
  });
  it("today's 錯題重做 stays after the 錯題本 was emptied by it", () => {
    const redo = sess('redo', 3, ['a0'], new Date(2026, 10, 4, 9));
    const t = buildPlan(base({ ...morning, items: its, byId, wrongBook: {}, history: [redo] }))[0];
    expect(kinds(t.tasks, 'redo')).toEqual([{ kind: 'redo', subject: 3, done: true }]);
  });
});

describe("buildPlan: today's 錯題重做 科目 is fixed by the start-of-day 錯題本", () => {
  const w3 = mkQ('w3', code(101), 3);
  const p1 = mkQ('p1', 'L21101', 1);
  const byId = { w3, p1 };
  const wrong = (s: Session): Session => ({ ...s, answers: s.answers.map(() => 1) }); // option 1 is wrong for these questions
  const yesterday = wrong(sess('practice', 3, ['w3'], new Date(2026, 10, 3, 20)));
  const input = (history: Session[], wrongBook: PlanInput['wrongBook']) =>
    base({ subjects: [1, 3], byId, history, wrongBook, items: [{ code: 'L21101', subject: 1 }, { code: code(101), subject: 3 }] });
  const redoOf = (i: PlanInput) => kinds(buildPlan(i)[0].tasks, 'redo').map((t) => t.subject);

  it('stays 科目3 after wrong answers in 科目1 today make 科目1 look like it has a 錯題本', () => {
    expect(redoOf(input([yesterday], { 3: 1 }))).toEqual([3]); // morning
    const todayWrong = wrong(sess('practice', 1, ['p1'], new Date(2026, 10, 4, 9)));
    expect(redoOf(input([yesterday, todayWrong], { 1: 1, 3: 1 }))).toEqual([3]); // after practising 科目1
  });
  it("doing the other 科目's 錯題重做 does not switch today's task; it only decides done", () => {
    const w1 = mkQ('w1', 'L21101', 1);
    const both = { w1, w3 };
    const hist = [wrong(sess('practice', 1, ['w1'], new Date(2026, 10, 3, 20))), yesterday];
    const i = (history: Session[]) => base({ subjects: [1, 3], byId: both, history, wrongBook: { 1: 1, 3: 1 }, items: [{ code: 'L21101', subject: 1 }, { code: code(101), subject: 3 }] });
    const redos = (history: Session[]) => kinds(buildPlan(i(history))[0].tasks, 'redo').map((t) => [t.subject, t.done]);
    expect(redos(hist)).toEqual([[1, false]]); // morning: 科目1 is up
    const redo3 = sess('redo', 3, ['w3'], new Date(2026, 10, 4, 9));
    expect(redos([...hist, redo3])).toEqual([[1, false]]); // after a 科目3 redo: still 科目1, not done
    expect(redos([...hist, sess('redo', 1, ['w1'], new Date(2026, 10, 4, 9))])).toEqual([[1, true]]);
  });
  it('a 科目 whose only wrong answers are from today is not scheduled today, and is tomorrow', () => {
    const todayWrong = wrong(sess('practice', 1, ['p1'], new Date(2026, 10, 4, 9)));
    const plan = buildPlan(input([todayWrong], { 1: 1 }));
    expect(kinds(plan[0].tasks, 'redo')).toEqual([]);
    expect(kinds(plan[1].tasks, 'redo').map((t) => t.subject)).toEqual([1]);
  });
});

describe('planItems', () => {
  it('lists the distinct 知識點 of the chosen 科目 that have 題目, sorted by code', () => {
    const qs = [mkQ('a', 'L23302'), mkQ('b', 'L23301'), mkQ('c', 'L23301'), mkQ('d', 'L21101', 1), mkQ('e', 'L22101', 2)];
    expect(planItems(qs, [1, 3])).toEqual([
      { code: 'L21101', subject: 1 }, { code: 'L23301', subject: 3 }, { code: 'L23302', subject: 3 },
    ]);
  });
});
