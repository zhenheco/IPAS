import { EXAM_DATE, MODE_LABEL, SUBJECT_NAMES } from '../config';
import { daysUntil } from '../lib/timer';
import { Badge, Card, Loading, SaveWarning, fmtDate, useApp, useBank } from './app';
import { wrongBookIds } from '../lib/wrongbook';

export default function Home() {
  const { state, saveOk } = useApp();
  const { bank, error } = useBank();
  if (!state || !bank) return <Loading state={state} bank={bank} error={error} />;

  const days = daysUntil(EXAM_DATE, new Date());
  const recent = [...state.sessions].reverse().slice(0, 5);
  const active = state.active;

  return (
    <>
      <SaveWarning ok={saveOk} />
      <Card class="countdown">
        <div class="muted">考試倒數 · {EXAM_DATE.replaceAll('-', '/')} 梯次</div>
        <div class="big">{days > 0 ? <>還有 <b>{days}</b> 天</> : days === 0 ? <b>今天考試，加油！</b> : <b>本梯次已結束</b>}</div>
        {days > 0 ? <div class="row"><a class="btn small" href="/plan/">今日讀書計畫</a></div> : null}
      </Card>

      {active ? (
        <p class="notice">
          有一份未完成的{MODE_LABEL[active.mode]}（科目{active.subject}）。<a class="btn small" href="/session/">繼續作答</a>
        </p>
      ) : null}

      {bank.questions.length === 0 ? <p class="notice warn">題庫目前沒有題目。</p> : null}

      <h2>選擇科目</h2>
      <div class="grid">
        {bank.subjects.map((s) => {
          const n = bank.count(s);
          return (
            <Card key={s}>
              <h3>科目{s}</h3>
              <p>{SUBJECT_NAMES[s]}</p>
              <p class="muted">題庫 {n} 題 · 錯題本 {wrongBookIds(state.questionStats, bank.byId, s).length} 題</p>
              <div class="row">
                <a class="btn" href={`/practice/?subject=${s}`}>練習</a>
                <a class="btn ghost" href={`/exam/?subject=${s}`}>單科模考</a>
              </div>
            </Card>
          );
        })}
        <Card>
          <h3>全真模考</h3>
          <p>科目1 → 休息 → 科目3，各 90 分鐘。</p>
          <div class="row"><a class="btn" href="/full/">進入全真模考</a></div>
        </Card>
      </div>

      <h2>近期成績</h2>
      {recent.length === 0 ? (
        <p class="muted">還沒有作答紀錄。</p>
      ) : (
        <ul class="list">
          {recent.map((s) => (
            <li key={s.id}>
              <a href={`/result/?id=${s.id}`}>
                <span>{MODE_LABEL[s.mode]} · 科目{s.subject}</span>
                <span class="muted">{fmtDate(s.submittedAt)}</span>
                <span class="score">{s.score} 分 <Badge passed={s.score >= 70} /></span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
