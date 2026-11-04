import { useEffect, useState } from 'preact/hooks';
import { MODE_LABEL, QUESTIONS_PER_SESSION, SUBJECT_NAMES } from '../config';
import { examBlock } from '../lib/session';
import { filterPool, itemName, topicName, topicOf } from '../lib/syllabus';
import type { Subject } from '../lib/types';
import { Card, Loading, SaveWarning, query, useApp, useBank } from './app';
import { beginSession } from './start';

/** 練習 and 單科模考 share one setup screen; only 練習 can narrow to a 評鑑主題 or 知識點. */
export default function Setup({ mode }: { mode: 'practice' | 'exam' }) {
  const { state, update, saveOk } = useApp();
  const { bank, error } = useBank();
  const [subject, setSubject] = useState<Subject>(1);
  const [topic, setTopic] = useState('');
  const [item, setItem] = useState('');

  useEffect(() => {
    const q = query();
    const s = Number(q.get('subject'));
    if (s === 1 || s === 2 || s === 3) setSubject(s);
    setTopic(q.get('topic') ?? '');
    setItem(q.get('item') ?? '');
  }, []);

  if (!state || !bank) return <Loading state={state} bank={bank} error={error} />;

  const inSubject = filterPool(bank.questions, { subject });
  const topics = [...new Set(inSubject.map((q) => topicOf(q.item)))].sort();
  const items = [...new Set(inSubject.filter((q) => !topic || topicOf(q.item) === topic).map((q) => q.item))].sort();
  const pool = filterPool(bank.questions, { subject, topic: mode === 'practice' ? topic : '', item: mode === 'practice' ? item : '' });
  const n = Math.min(QUESTIONS_PER_SESSION, pool.length);
  const active = state.active;
  const block = mode === 'exam' ? examBlock(subject, pool.length) : null;

  const start = () => {
    if (block) return;
    if (active && !confirm('這會捨棄目前未完成的作答，確定要開始新的嗎？')) return;
    beginSession(update, { mode, subject, pool });
  };

  return (
    <>
      <h1>{MODE_LABEL[mode]}</h1>
      <SaveWarning ok={saveOk} />
      {mode === 'practice' ? (
        <p class="muted">不計時，完整作答後才顯示答案、詳解與相關知識。</p>
      ) : (
        <ul class="rules">
          <li>{QUESTIONS_PER_SESSION} 題單選，上限 90 分鐘，時間到自動交卷。</li>
          <li>不可暫停；重新整理頁面計時仍繼續。交卷前不顯示答案。</li>
          <li>可標記題目，並用題號表跳題。70 分以上通過，答錯不倒扣。</li>
        </ul>
      )}

      {active ? (
        <p class="notice">有一份未完成的{MODE_LABEL[active.mode]}。<a class="btn small" href="/session/">繼續作答</a></p>
      ) : null}

      <Card>
        <label class="field">科目
          <select value={subject} onChange={(e) => { setSubject(Number(e.currentTarget.value) as Subject); setTopic(''); setItem(''); }}>
            {bank.subjects.map((s) => <option key={s} value={s}>科目{s} {SUBJECT_NAMES[s]}（{bank.count(s)} 題）</option>)}
          </select>
        </label>

        {mode === 'practice' ? (
          <>
            <label class="field">評鑑主題
              <select value={topic} onChange={(e) => { setTopic(e.currentTarget.value); setItem(''); }}>
                <option value="">全部</option>
                {topics.map((t) => <option key={t} value={t}>{t} {topicName(bank.syllabus, t)}</option>)}
              </select>
            </label>
            <label class="field">知識點
              <select value={item} onChange={(e) => setItem(e.currentTarget.value)}>
                <option value="">全部</option>
                {items.map((i) => <option key={i} value={i}>{i} {itemName(bank.syllabus, i)}</option>)}
              </select>
            </label>
          </>
        ) : null}

        {pool.length > 0 && pool.length < QUESTIONS_PER_SESSION ? (
          <p class="muted">這個範圍目前只有 {pool.length} 題，將全部出題。</p>
        ) : null}
        {block ? <p class="notice warn">{block}</p> : null}
        <button class="btn" disabled={pool.length === 0 || !!block} onClick={start}>
          {pool.length === 0 ? '這個範圍沒有題目' : `開始${MODE_LABEL[mode]}（${n} 題）`}
        </button>
      </Card>
    </>
  );
}
