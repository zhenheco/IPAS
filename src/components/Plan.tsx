import { EXAM_DATES, MODE_LABEL, QUESTIONS_PER_SESSION } from '../config';
import { LEVELS, subjectLabel, subjectShort } from '../lib/levels';
import { buildPlan, planItems, type PlanTask } from '../lib/plan';
import { filterPool, itemName } from '../lib/syllabus';
import { daysUntil } from '../lib/timer';
import type { Subject } from '../lib/types';
import { aggregateWeakness } from '../lib/weakness';
import { wrongBookIds } from '../lib/wrongbook';
import { Card, LevelTabs, Loading, SaveWarning, useApp, useBank, useLevel } from './app';
import Paywall from './Paywall';
import { beginSession } from './start';

const md = (iso: string) => iso.slice(5).replace('-', '/');

/** 讀書計畫: rebuilt from the current records on every visit; nothing is stored. */
export default function Plan() {
  const { state, update, saveOk } = useApp();
  const { bank, error } = useBank();
  const { level, setLevel } = useLevel(bank?.levels);
  if (!state || !bank) return <Loading state={state} bank={bank} error={error} />;

  const info = LEVELS[level];
  const examDate = EXAM_DATES[level];
  const header = (
    <>
      <h1>讀書計畫 · {info.name}</h1>
      <SaveWarning ok={saveOk} />
      <LevelTabs levels={bank.levels} level={level} onPick={setLevel} />
    </>
  );
  if (!examDate) return <>{header}<p class="notice">{info.name}還沒有設定目標梯次的考試日期，無法排讀書計畫（在 src/config.ts 的 EXAM_DATES 填入）。</p></>;

  const now = new Date();
  const days = daysUntil(examDate, now);
  const subjects = bank.subjectsOf(level);
  const first = info.fullFirst;
  const second = info.fullElectives.find((s) => subjects.includes(s)) ?? info.fullElectives[0]!;
  const stats = state.questionStats;
  const wrongBook = Object.fromEntries(subjects.map((s) => [s, wrongBookIds(stats, bank.byId, s).length])) as Partial<Record<Subject, number>>;
  const plan = buildPlan({
    today: now, examDate, subjects, items: planItems(bank.questions, subjects),
    weakness: aggregateWeakness(stats, bank.byId), wrongBook, history: state.sessions.filter((s) => subjects.includes(s.subject)), byId: bank.byId,
  });
  const [today, ...rest] = plan;

  const label = (t: PlanTask) =>
    t.kind === 'practice' ? `${t.quick ? '快速複習' : MODE_LABEL.practice} ${subjectLabel(t.subject!)} ${t.item} ${itemName(bank.syllabus, t.item!)}${t.limit ? `（${t.limit} 題）` : ''}`
      : t.kind === 'redo' ? `${MODE_LABEL.redo} ${subjectLabel(t.subject!)}（${Math.min(wrongBook[t.subject!] ?? 0, t.limit ?? QUESTIONS_PER_SESSION)} 題）`
        : `${MODE_LABEL.full}（${subjectShort(first)} → 休息 → ${subjectShort(second)}）`;

  const poolOf = (t: PlanTask) =>
    t.kind === 'redo' ? wrongBookIds(stats, bank.byId, t.subject!).map((id) => bank.byId[id]) : filterPool(bank.questions, { subject: t.subject!, item: t.item });

  const start = (t: PlanTask) => {
    const pool = poolOf(t);
    if (!pool.length) return; // e.g. today's 錯題重做 already emptied the 錯題本; checked before asking to discard anything
    if (state.active && !confirm('這會捨棄目前未完成的作答，確定要開始新的嗎？')) return;
    const subject = t.subject!;
    beginSession(update, { mode: t.kind === 'redo' ? 'redo' : 'practice', subject, pool, count: t.limit });
  };

  return (
    <>
      {header}
      <Paywall feature="plan" level={level}>
      <Card class="countdown">
        <div class="muted">{info.name}考試倒數 · {examDate.replaceAll('-', '/')} 梯次</div>
        <div class="big">{days > 0 ? <>還有 <b>{days}</b> 天</> : days === 0 ? <b>今天考試，加油！</b> : <b>本梯次已結束</b>}</div>
      </Card>

      {!today ? (
        <p class="notice">{days === 0 ? '今天就是考試日，不再安排讀書計畫。祝考試順利！' : '本梯次已結束，沒有待辦的讀書計畫。'}</p>
      ) : (
        <>
          <h2>今日待辦 · {md(today.date)}{today.eve ? '（考前一天，輕量複習）' : ''}</h2>
          <Card>
            {today.tasks.length === 0 ? <p class="muted">今天沒有安排，題庫中沒有可練習的知識點。</p> : (
              <ul class="list tasks">
                {today.tasks.map((t, k) => (
                  <li key={k} class={t.done ? 'done' : ''}>
                    <span>{label(t)} {t.done ? <span class="badge ok">已完成</span> : null}</span>
                    {t.kind === 'full'
                      ? <a class={`btn small ${t.done ? 'ghost' : ''}`} href={`/full/?level=${level}`}>進入全真模考</a>
                      : <button class={`btn small ${t.done ? 'ghost' : ''}`} disabled={poolOf(t).length === 0} onClick={() => start(t)}>{t.kind === 'redo' ? '開始重做' : '開始練習'}</button>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {rest.length ? (
            <>
              <h2>接下來的計畫</h2>
              <ol class="plandays">
                {rest.map((d) => (
                  <li key={d.date}>
                    <b>{md(d.date)}</b> <span class="muted">· 還有 {d.daysToExam} 天{d.eve ? '（考前一天）' : ''}</span>
                    <ul>{d.tasks.map((t, k) => <li key={k}>{label(t)}</li>)}</ul>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </>
      )}
      </Paywall>
    </>
  );
}

