import { EXAM_DATES, MODE_LABEL } from '../config';
import { LEVELS, SUBJECT_INFO, subjectLabel, subjectShort } from '../lib/levels';
import { isPassed } from '../lib/scoring';
import { daysUntil } from '../lib/timer';
import { Badge, Card, LevelTabs, Loading, SaveWarning, fmtDate, useApp, useBank, useLevel } from './app';
import { wrongBookIds } from '../lib/wrongbook';
import AdSlot from './AdSlot';

export default function Home() {
  const { state, saveOk } = useApp();
  const { bank, error } = useBank();
  const { level, setLevel } = useLevel(bank?.levels);
  if (!state || !bank) return <Loading state={state} bank={bank} error={error} />;

  const info = LEVELS[level];
  const examDate = EXAM_DATES[level];
  const days = examDate ? daysUntil(examDate, new Date()) : null;
  const recent = [...state.sessions].reverse().slice(0, 5);
  const active = state.active;
  const subjects = bank.subjectsOf(level);
  const first = info.fullFirst;
  const electives = info.fullElectives.filter((s) => subjects.includes(s));

  return (
    <>
      <SaveWarning ok={saveOk} />
      <LevelTabs levels={bank.levels} level={level} onPick={setLevel} />
      {examDate && days !== null ? (
        <Card class="countdown">
          <div class="muted">{info.name}考試倒數 · {examDate.replaceAll('-', '/')} 梯次</div>
          <div class="big">{days > 0 ? <>還有 <b>{days}</b> 天</> : days === 0 ? <b>今天考試，加油！</b> : <b>本梯次已結束</b>}</div>
          {days > 0 ? <div class="row"><a class="btn small" href={`/plan/?level=${level}`}>今日讀書計畫</a></div> : null}
        </Card>
      ) : null}

      {active ? (
        <p class="notice">
          有一份未完成的{MODE_LABEL[active.mode]}（{subjectLabel(active.subject)}）。<a class="btn small" href="/session/">繼續作答</a>
        </p>
      ) : null}

      {bank.questions.length === 0 ? <p class="notice warn">題庫目前沒有題目。</p> : null}

      <h2>選擇科目 · {info.name}</h2>
      <div class="grid">
        {subjects.map((s) => {
          const n = bank.count(s);
          const papers = bank.papersOf(s).length;
          return (
            <Card key={s}>
              <h3>{subjectShort(s)}</h3>
              <p>{SUBJECT_INFO[s].name}</p>
              <p class="muted">題庫 {n} 題{papers ? ` · 模擬試卷 ${papers} 回` : ''} · 錯題本 {wrongBookIds(state.questionStats, bank.byId, s).length} 題</p>
              <div class="row">
                <a class="btn" href={`/practice/?subject=${s}`}>練習</a>
                <a class="btn ghost" href={`/exam/?subject=${s}`}>單科模考</a>
              </div>
            </Card>
          );
        })}
        {electives.length ? (
          <Card>
            <h3>全真模考</h3>
            <p>{subjectShort(first)} → 休息 → {electives.map(subjectShort).join(' 或 ')}，各 {SUBJECT_INFO[first].minutes} 分鐘。</p>
            <div class="row"><a class="btn" href={`/full/?level=${level}`}>進入全真模考</a></div>
          </Card>
        ) : null}
      </div>

      <AdSlot slot="home" level={level} />

      <h2>近期成績</h2>
      {recent.length === 0 ? (
        <p class="muted">還沒有作答紀錄。</p>
      ) : (
        <ul class="list">
          {recent.map((s) => (
            <li key={s.id}>
              <a href={`/result/?id=${s.id}`}>
                <span>{MODE_LABEL[s.mode]} · {subjectLabel(s.subject)}</span>
                <span class="muted">{fmtDate(s.submittedAt)}</span>
                <span class="score">{s.score} 分 <Badge passed={isPassed(s.score, s.subject)} /></span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
