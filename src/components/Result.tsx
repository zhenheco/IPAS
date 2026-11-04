import { useEffect, useState } from 'preact/hooks';
import { MODE_LABEL } from '../config';
import { buildReview } from '../lib/review';
import { certificate, isPassed, PASS_SCORE } from '../lib/scoring';
import { Badge, Card, Loading, fmtDate, query, useApp, useBank } from './app';
import { Review } from './Review';

export default function Result() {
  const { state } = useApp();
  const { bank, error } = useBank();
  const [id, setId] = useState<string | null>(null);
  const [onlyWrong, setOnlyWrong] = useState(false);
  useEffect(() => setId(query().get('id')), []);
  if (!state || !bank) return <Loading state={state} bank={bank} error={error} />;

  const s = state.sessions.find((x) => x.id === id);
  if (!s) return <p class="notice">找不到這筆成績。<a href="/history/">看作答歷史</a></p>;

  const review = buildReview(s, bank.byId);
  const minutes = Math.max(1, Math.round((Date.parse(s.submittedAt) - Date.parse(s.startedAt)) / 60_000));

  const parts = s.fullId ? state.sessions.filter((x) => x.fullId === s.fullId) : [];
  const first = parts.find((x) => x.subject === 1);
  const second = parts.find((x) => x.subject !== 1);
  const cert = first && second ? certificate(second.subject === 2 ? 2 : 3, first.score, second.score) : null;

  return (
    <>
      <h1>{MODE_LABEL[s.mode]}成績 · 科目{s.subject}</h1>
      <Card class="scorecard">
        <div class="big"><b>{s.score}</b> 分 <Badge passed={isPassed(s.score)} /></div>
        <p>
          {review.correct === null ? `共 ${s.questionIds.length} 題（${review.removed} 題已從題庫移除）` : `答對 ${review.correct} / ${s.questionIds.length} 題`}
          {' '}· 通過門檻 {PASS_SCORE} 分 · 作答 {minutes} 分鐘
        </p>
        <p class="muted">{fmtDate(s.submittedAt)}</p>
      </Card>

      {s.fullId ? (
        <Card>
          <h3>全真模考結果</h3>
          <p>科目1：{first ? <>{first.score} 分 <Badge passed={first.score >= PASS_SCORE} /></> : '尚未完成'}</p>
          <p>科目{second?.subject ?? 3}：{second ? <>{second.score} 分 <Badge passed={second.score >= PASS_SCORE} /></> : '尚未完成'}</p>
          {cert ? <p><b>{cert.name}證書條件：{cert.earned ? '已達成（兩科皆 70 分以上）' : '未達成（需兩科皆 70 分以上）'}</b></p> : null}
        </Card>
      ) : null}

      <div class="row">
        <a class="btn" href="/practice/">再練習</a>
        <a class="btn ghost" href="/wrongbook/">錯題本</a>
        <a class="btn ghost" href="/weakness/">弱點分析</a>
      </div>

      <h2>逐題檢討</h2>
      <label class="check"><input type="checkbox" checked={onlyWrong} onChange={(e) => setOnlyWrong(e.currentTarget.checked)} /> 只看答錯或未作答</label>
      {review.rows
        .filter((x) => !onlyWrong || x.removed || x.picked !== x.question!.answer)
        .map((x) => x.removed
          ? <div key={x.index} class="review"><b>第 {x.index + 1} 題</b> <span class="muted">此題已移除</span></div>
          : <Review key={x.index} q={x.question!} picked={x.picked} index={x.index} />)}
    </>
  );
}
