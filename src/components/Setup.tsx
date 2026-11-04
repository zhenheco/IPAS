import { useEffect, useState } from 'preact/hooks';
import { MODE_LABEL, QUESTIONS_PER_SESSION, SOURCE_LABEL } from '../config';
import { LEVELS, SUBJECT_INFO, isSubject, levelOf, subjectShort } from '../lib/levels';
import { examBlock } from '../lib/session';
import { filterBySource, hasOfficial } from '../lib/source';
import { filterPool, itemName, topicName, topicOf } from '../lib/syllabus';
import type { SourceChoice, Subject } from '../lib/types';
import { Card, LevelTabs, Loading, SaveWarning, query, useApp, useBank, useLevel } from './app';
import Paywall from './Paywall';
import { beginSession } from './start';

/** 練習 and 單科模考 share one setup screen; only 練習 can narrow to a 評鑑主題 or 知識點. */
export default function Setup({ mode }: { mode: 'practice' | 'exam' }) {
  const { state, update, saveOk } = useApp();
  const { bank, error } = useBank();
  const { level, setLevel } = useLevel(bank?.levels);
  const [picked, setSubject] = useState<Subject | null>(null);
  const [topic, setTopic] = useState('');
  const [item, setItem] = useState('');
  const [paper, setPaper] = useState('');
  const [source, setSource] = useState<SourceChoice>('all');

  useEffect(() => {
    const q = query();
    const s = Number(q.get('subject'));
    if (isSubject(s)) setSubject(s);
    setTopic(q.get('topic') ?? '');
    setItem(q.get('item') ?? '');
    setPaper(q.get('paper') ?? '');
  }, []);

  if (!state || !bank) return <Loading state={state} bank={bank} error={error} />;

  const levelSubjects = bank.subjectsOf(level);
  const subject: Subject = picked && levelOf(picked) === level ? picked : levelSubjects[0] ?? LEVELS[level].subjects[0]!;
  const papers = mode === 'exam' ? bank.papersOf(subject) : [];
  const chosenPaper = papers.find((p) => p.id === paper) ?? null;
  const info = SUBJECT_INFO[subject];

  const inSubject = filterPool(bank.questions, { subject });
  const topics = [...new Set(inSubject.map((q) => topicOf(q.item)))].sort();
  const items = [...new Set(inSubject.filter((q) => !topic || topicOf(q.item) === topic).map((q) => q.item))].sort();
  const showSource = hasOfficial(bank.questions);
  const sourceChoice = showSource ? source : 'all';
  const pool = filterBySource(
    filterPool(bank.questions, { subject, topic: mode === 'practice' ? topic : '', item: mode === 'practice' ? item : '' }),
    sourceChoice,
  );
  const n = Math.min(QUESTIONS_PER_SESSION, pool.length);
  const active = state.active;
  const block = mode === 'exam' && !chosenPaper ? examBlock(subject, pool.length, sourceChoice === 'all' ? undefined : SOURCE_LABEL[sourceChoice]) : null;

  const start = () => {
    if (block) return;
    if (active && !confirm('這會捨棄目前未完成的作答，確定要開始新的嗎？')) return;
    if (chosenPaper) beginSession(update, { mode, subject, pool: chosenPaper.questionIds.map((id) => bank.byId[id]!), paperId: chosenPaper.id, keepOrder: true });
    else beginSession(update, { mode, subject, pool });
  };

  return (
    <>
      <h1>{MODE_LABEL[mode]}</h1>
      <SaveWarning ok={saveOk} />
      {mode === 'practice' ? (
        <p class="muted">不計時，完整作答後才顯示答案、詳解與相關知識。</p>
      ) : (
        <ul class="rules">
          <li>{QUESTIONS_PER_SESSION} 題單選，上限 {info.minutes} 分鐘，時間到自動交卷。</li>
          <li>不可暫停；重新整理頁面計時仍繼續。交卷前不顯示答案。</li>
          <li>可標記題目，並用題號表跳題。{info.passScore} 分以上通過，答錯不倒扣。</li>
        </ul>
      )}

      {active ? (
        <p class="notice">有一份未完成的{MODE_LABEL[active.mode]}。<a class="btn small" href="/session/">繼續作答</a></p>
      ) : null}

      <LevelTabs levels={bank.levels} level={level} onPick={(l) => { setLevel(l); setSubject(null); setTopic(''); setItem(''); setPaper(''); }} />
      <Paywall feature={mode} level={level}>
      <Card>
        <label class="field">科目（{LEVELS[level].name}）
          <select value={subject} onChange={(e) => { setSubject(Number(e.currentTarget.value) as Subject); setTopic(''); setItem(''); setPaper(''); }}>
            {levelSubjects.map((s) => <option key={s} value={s}>{subjectShort(s)} {SUBJECT_INFO[s].name}（{bank.count(s)} 題）</option>)}
          </select>
        </label>

        {papers.length ? (
          <label class="field">試卷
            <select value={chosenPaper?.id ?? ''} onChange={(e) => setPaper(e.currentTarget.value)}>
              <option value="">隨機抽題（依知識點比例）</option>
              {papers.map((p) => <option key={p.id} value={p.id}>模擬試卷 第 {p.no} 回{state.sessions.some((x) => x.paperId === p.id) ? '（已作答）' : ''}</option>)}
            </select>
          </label>
        ) : null}

        {showSource && !chosenPaper ? (
          <label class="field">題目來源
            <select value={source} onChange={(e) => setSource(e.currentTarget.value as SourceChoice)}>
              {(['all', 'official', 'original'] as const).map((c) => <option key={c} value={c}>{SOURCE_LABEL[c]}</option>)}
            </select>
          </label>
        ) : null}

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

        {!chosenPaper && pool.length > 0 && pool.length < QUESTIONS_PER_SESSION ? (
          <p class="muted">這個範圍目前只有 {pool.length} 題，將全部出題。</p>
        ) : null}
        {block ? <p class="notice warn">{block}</p> : null}
        <button class="btn" disabled={(!chosenPaper && pool.length === 0) || !!block} onClick={start}>
          {chosenPaper ? `開始模擬試卷 第 ${chosenPaper.no} 回（${chosenPaper.questionIds.length} 題）` : pool.length === 0 ? '這個範圍沒有題目' : `開始${MODE_LABEL[mode]}（${n} 題）`}
        </button>
      </Card>
      </Paywall>
    </>
  );
}
