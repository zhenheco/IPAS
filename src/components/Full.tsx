import { useEffect, useRef, useState } from 'preact/hooks';
import { QUESTIONS_PER_SESSION, SOURCE_LABEL } from '../config';
import { LEVELS, SUBJECT_INFO, certificateName, fullFirstOf, levelOf, subjectShort } from '../lib/levels';
import type { Subject } from '../lib/types';
import { drawQuestions } from '../lib/draw';
import { startFull } from '../lib/fullexam';
import { abandonBreak, dropSource } from '../lib/fullexam';
import { advanceToSection2, createSession, examBlock, section2Action, section2Pool } from '../lib/session';
import { filterBySource, hasOfficial } from '../lib/source';
import { filterPool } from '../lib/syllabus';
import type { SourceChoice } from '../lib/types';
import { formatClock, remainingMs } from '../lib/timer';
import { Card, LevelTabs, Loading, SaveWarning, go, isUnsaved, newId, useApp, useBank, useLevel } from './app';
import Paywall from './Paywall';
import { beginSession } from './start';

export default function Full() {
  const { state, update, saveOk } = useApp();
  const { bank, error } = useBank();
  const { level: viewLevel, setLevel } = useLevel(bank?.levels);
  const [picked, setElective] = useState<Subject | null>(null);
  const [source, setSource] = useState<SourceChoice>('all');
  const [now, setNow] = useState(Date.now());
  const exam = state?.fullExam ?? null;
  const started = useRef(false);

  // one idempotent update decided against the latest stored fullExam (inside the lock): runs once however many tabs/ticks ask
  const startSection2 = async () => {
    if (!bank || !exam || started.current) return;
    const { pool, block } = section2Pool(bank.questions, exam);
    if (block) return; // shown on screen with a way out; never create an empty or short section
    started.current = true;
    const next = await update((s) =>
      advanceToSection2(s, exam.id, Date.now(), (startedAt) =>
        createSession({ id: newId(), mode: 'full', subject: exam.elective, questions: drawQuestions(pool, QUESTIONS_PER_SESSION), now: startedAt, fullId: exam.id }),
      ),
    );
    if (next.fullExam?.stage === 'section2' && !isUnsaved()) go('/session/');
    else started.current = false;
  };

  // the timer below outlives renders, so it reads the latest exam/bank (e.g. after 改用全部題目) through this ref
  const latest = useRef({ exam, bank, startSection2 });
  latest.current = { exam, bank, startSection2 };

  // the break is a stored deadline; when it expires (even while away) section 2 starts automatically
  useEffect(() => {
    if (exam?.stage !== 'break' || !bank) return;
    const tick = () => {
      setNow(Date.now());
      const l = latest.current;
      if (l.exam && l.bank && section2Action(l.bank.questions, l.exam, Date.now()) === 'start') l.startSection2();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [exam?.id, exam?.stage, !!bank]);

  if (!state || !bank) return <Loading state={state} bank={bank} error={error} />;

  // an exam in progress pins the level; otherwise the viewer's pick
  const level = exam && exam.stage !== 'done' ? levelOf(exam.elective) : viewLevel;
  const info = LEVELS[level];
  const first = info.fullFirst;
  const electives = info.fullElectives.filter((s) => bank.subjects.includes(s));
  const elective: Subject = picked && electives.includes(picked) ? picked : electives[0] ?? info.fullElectives[0]!;
  const minutes = SUBJECT_INFO[first].minutes;

  const showSource = hasOfficial(bank.questions);
  const sourceChoice = showSource ? source : 'all';
  const poolOf = (subject: Subject) => filterBySource(filterPool(bank.questions, { subject }), sourceChoice);
  const label = sourceChoice === 'all' ? undefined : SOURCE_LABEL[sourceChoice];
  const blocks = [examBlock(first, poolOf(first).length, label), examBlock(elective, poolOf(elective).length, label)].filter(Boolean) as string[];

  const start = () => {
    if (blocks.length) return;
    if (state.active && !confirm('這會捨棄目前未完成的作答，確定要開始嗎？')) return;
    const e = startFull(newId(), elective, sourceChoice);
    beginSession(update, { mode: 'full', subject: first, pool: poolOf(first), fullId: e.id, fullExam: e });
  };

  if (exam && exam.stage !== 'done') {
    const inSession = state.active?.fullId === exam.id;
    const sec2Block = exam.stage === 'break' ? section2Pool(bank.questions, exam).block : null;
    // recovery: drop the 題目來源 filter (the break timer keeps running and section 2 then starts as usual)
    const useAll = () => update((s) => (s.fullExam ? { ...s, fullExam: dropSource(s.fullExam, exam.id) } : s));
    return (
      <>
        <h1>全真模考 · {info.name}</h1>
        <SaveWarning ok={saveOk} />
        {exam.stage === 'break' ? (
          <Card>
            <h3>休息中</h3>
            <p class="clock big" role="timer">{formatClock(remainingMs(exam.breakDeadline!, now))}</p>
            <p class="muted">休息上限 30 分鐘，時間到會自動開始{subjectShort(exam.elective)}；可提早結束休息。</p>
            {sec2Block ? (
              <div class="notice warn" role="alert">
                <span>無法開始{subjectShort(exam.elective)}：{sec2Block}</span>
                {exam.source && exam.source !== 'all' && section2Pool(bank.questions, { ...exam, source: 'all' }).block === null
                  ? <button class="btn small" onClick={useAll}>改用全部題目</button> : null}
                <button class="btn small ghost" onClick={() => update((s) => ({ ...s, fullExam: abandonBreak(s.fullExam, exam.id) }))}>放棄這次全真模考</button>
              </div>
            ) : null}
            <button class="btn" disabled={!!sec2Block} onClick={startSection2}>結束休息，開始{subjectShort(exam.elective)}</button>
          </Card>
        ) : inSession ? (
          <p class="notice">{subjectShort(exam.stage === 'section1' ? fullFirstOf(exam.elective) : exam.elective)}作答進行中。<a class="btn small" href="/session/">繼續作答</a></p>
        ) : (
          <p class="notice warn">找不到進行中的作答。<button class="btn small" onClick={() => update((s) => ({ ...s, fullExam: null }))}>重置全真模考</button></p>
        )}
      </>
    );
  }

  const last = exam ? state.sessions.filter((s) => s.fullId === exam.id).at(-1) : undefined;
  // an exam already under way is never locked mid-way; only starting a new one is paid
  return (
    <>
      <h1>全真模考 · {info.name}</h1>
      <SaveWarning ok={saveOk} />
      <LevelTabs levels={bank.levels} level={level} onPick={(l) => { setLevel(l); setElective(null); }} />
      <Paywall feature="full" level={level}>
      <ul class="rules">
        <li>依序進行{subjectShort(first)}（必考）→ 休息（至多 30 分鐘，可提早結束）→ {subjectShort(elective)}，各 {QUESTIONS_PER_SESSION} 題、上限 {minutes} 分鐘，時間到自動交卷。</li>
        <li>開始時間由你決定；開始後不可暫停。</li>
        <li>兩科皆 {SUBJECT_INFO[first].passScore} 分以上，才符合{certificateName(elective)}證書的及格條件。</li>
      </ul>
      {last ? <p class="notice">上一次的全真模考已完成。<a class="btn small" href={`/result/?id=${last.id}`}>查看成績</a></p> : null}
      <Card>
        {electives.length > 1 ? (
          <label class="field">第二科
            <select value={elective} onChange={(e) => setElective(Number(e.currentTarget.value) as Subject)}>
              {electives.map((s) => <option key={s} value={s}>{subjectShort(s)} {SUBJECT_INFO[s].name}</option>)}
            </select>
          </label>
        ) : <p>{subjectShort(first)} {SUBJECT_INFO[first].name} → {subjectShort(elective)} {SUBJECT_INFO[elective].name}</p>}
        {showSource ? (
          <label class="field">題目來源
            <select value={source} onChange={(e) => setSource(e.currentTarget.value as SourceChoice)}>
              {(['all', 'official', 'original'] as const).map((c) => <option key={c} value={c}>{SOURCE_LABEL[c]}</option>)}
            </select>
          </label>
        ) : null}
        {blocks.map((m) => <p key={m} class="notice warn">{m}</p>)}
        <button class="btn" disabled={blocks.length > 0} onClick={start}>開始全真模考</button>
      </Card>
      </Paywall>
    </>
  );
}
