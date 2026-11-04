import { MODE_LABEL } from '../config';
import { subjectLabel } from '../lib/levels';
import { isPassed } from '../lib/scoring';
import { Badge, Loading, fmtDate, useApp, useBank } from './app';

export default function History() {
  const { state } = useApp();
  const { bank, error } = useBank();
  if (!state || !bank) return <Loading state={state} bank={bank} error={error} />;
  const list = [...state.sessions].reverse();
  return (
    <>
      <h1>作答歷史</h1>
      {list.length === 0 ? <p class="notice">還沒有作答紀錄。</p> : (
        <div class="tablewrap">
          <table>
            <thead><tr><th>日期</th><th>模式</th><th>科目</th><th>分數</th><th>用時</th><th></th></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td>{fmtDate(s.submittedAt)}</td>
                  <td>{MODE_LABEL[s.mode]}</td>
                  <td>{subjectLabel(s.subject)}</td>
                  <td>{s.score} <Badge passed={isPassed(s.score, s.subject)} /></td>
                  <td>{Math.max(1, Math.round((Date.parse(s.submittedAt) - Date.parse(s.startedAt)) / 60_000))} 分</td>
                  <td><a href={`/result/?id=${s.id}`}>檢討</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
