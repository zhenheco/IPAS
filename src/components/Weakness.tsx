import { useState } from 'preact/hooks';
import { subjectLabel } from '../lib/levels';
import { itemName } from '../lib/syllabus';
import { firstSubjectWithData } from '../lib/subjects';
import type { Subject } from '../lib/types';
import { aggregateWeakness } from '../lib/weakness';
import { Loading, useApp, useBank } from './app';

export default function Weakness() {
  const { state } = useApp();
  const { bank, error } = useBank();
  const [picked, setSubject] = useState<Subject | null>(null);
  if (!state || !bank) return <Loading state={state} bank={bank} error={error} />;
  const subject = picked ?? firstSubjectWithData(bank.subjects, (s) => aggregateWeakness(state.questionStats, bank.byId, s).length > 0);

  const rows = aggregateWeakness(state.questionStats, bank.byId, subject);
  return (
    <>
      <h1>弱點分析</h1>
      <p class="muted">依全部作答紀錄統計各知識點的正確率，由最弱排起。</p>
      <div class="tabs" role="tablist">
        {bank.subjects.map((s) => (
          <button key={s} role="tab" aria-selected={s === subject} class={s === subject ? 'on' : ''} onClick={() => setSubject(s)}>{subjectLabel(s)}</button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p class="notice">{subjectLabel(subject)}還沒有作答紀錄。</p>
      ) : (
        <div class="tablewrap">
          <table>
            <thead><tr><th>知識點</th><th>正確率</th><th>答對 / 作答</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item}>
                  <td>{r.item}<br /><span class="muted">{itemName(bank.syllabus, r.item)}</span></td>
                  <td><div class="meter"><i style={{ width: `${Math.round(r.accuracy * 100)}%` }} /></div>{Math.round(r.accuracy * 100)}%</td>
                  <td>{r.correct} / {r.attempts}</td>
                  <td><a class="btn small" href={`/practice/?subject=${r.subject}&item=${r.item}`}>練習</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
