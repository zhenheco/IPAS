import { useState } from 'preact/hooks';
import { QUESTIONS_PER_SESSION } from '../config';
import { SUBJECT_INFO, subjectLabel } from '../lib/levels';
import { itemName } from '../lib/syllabus';
import { firstSubjectWithData } from '../lib/subjects';
import type { Subject } from '../lib/types';
import { groupWrongBook, wrongBookIds } from '../lib/wrongbook';
import { Card, Loading, SaveWarning, fmtDate, useApp, useBank } from './app';
import { Review } from './Review';
import { beginSession } from './start';

export default function WrongBook() {
  const { state, update, saveOk } = useApp();
  const { bank, error } = useBank();
  const [picked, setSubject] = useState<Subject | null>(null);
  if (!state || !bank) return <Loading state={state} bank={bank} error={error} />;
  const subject = picked ?? firstSubjectWithData(bank.subjects, (s) => wrongBookIds(state.questionStats, bank.byId, s).length > 0);

  const stats = state.questionStats;
  const ids = wrongBookIds(stats, bank.byId, subject);
  const groups = groupWrongBook(stats, bank.byId, subject);

  const redo = () => {
    if (state.active && !confirm('這會捨棄目前未完成的作答，確定要開始嗎？')) return;
    beginSession(update, { mode: 'redo', subject, pool: ids.map((id) => bank.byId[id]) });
  };

  return (
    <>
      <h1>錯題本</h1>
      <SaveWarning ok={saveOk} />
      <p class="muted">答錯的題目會記錄在這裡；在錯題重做中連續答對 2 次，就會移出錯題本。</p>
      <div class="tabs" role="tablist">
        {bank.subjects.map((s) => (
          <button key={s} role="tab" aria-selected={s === subject} class={s === subject ? 'on' : ''} onClick={() => setSubject(s)}>
            {subjectLabel(s)}（{wrongBookIds(stats, bank.byId, s).length}）
          </button>
        ))}
      </div>
      <p class="muted">{SUBJECT_INFO[subject].name}</p>

      {ids.length === 0 ? (
        <p class="notice">{subjectLabel(subject)}的錯題本是空的。</p>
      ) : (
        <>
          <button class="btn" onClick={redo}>錯題重做（{Math.min(ids.length, QUESTIONS_PER_SESSION)} 題）</button>
          {groups.map((g) => (
            <Card key={g.item}>
              <h3>{g.item} {itemName(bank.syllabus, g.item)} <span class="muted">· {g.entries.length} 題</span></h3>
              {g.entries.map(({ question, stat }) => (
                <details key={question.id}>
                  <summary>
                    <span class="snip">{question.stem.split('\n')[0].slice(0, 60)}</span>
                    <span class="muted"> 錯 {stat.wrong} 次 · 最近 {stat.lastWrongAt ? fmtDate(stat.lastWrongAt) : '-'}</span>
                  </summary>
                  <Review q={question} picked={null} />
                </details>
              ))}
            </Card>
          ))}
        </>
      )}
    </>
  );
}
