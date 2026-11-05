import { useEffect, useRef, useState } from 'preact/hooks';
import { MODE_LABEL } from '../config';
import { levelOf, subjectLabel } from '../lib/levels';
import { applyEdit, applySubmit, type Edit } from '../lib/session';
import { exportJson } from '../lib/storage';
import type { Session as SessionRecord } from '../lib/types';
import { formatClock, remainingMs, shouldAutoSubmit } from '../lib/timer';
import AdSlot from './AdSlot';
import { Loading, SaveWarning, go, isUnsaved, useApp, useBank } from './app';
import { Rich } from './Rich';

const LETTERS = ['A', 'B', 'C', 'D'];

/** The runner for every mode. State lives in localStorage (answers + a deadline timestamp), so a reload resumes. */
export default function Session() {
  const { state, update, saveOk } = useApp();
  const { bank, error } = useBank();
  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [unsavedResult, setUnsavedResult] = useState<{ session: SessionRecord; json: string } | null>(null);
  const submitting = useRef(false);
  const active = state?.active ?? null;

  // every action names the session it belongs to; if the stored active session differs, nothing happens
  const submit = async (sessionId: string) => {
    if (!bank || submitting.current) return;
    submitting.current = true;
    let done: SessionRecord | null = null;
    const next = await update((s) => {
      const r = applySubmit(s, sessionId, bank.byId, Date.now());
      done = r.session;
      return r.state;
    });
    const session = done as SessionRecord | null;
    if (!session) return go('/history/'); // already submitted elsewhere
    if (isUnsaved()) { // navigating would drop the only copy: stay, warn, and offer a backup
      setUnsavedResult({ session, json: exportJson(next) });
      return;
    }
    go(session.mode === 'full' && next.fullExam?.stage === 'break' ? '/full/' : `/result/?id=${session.id}`);
  };

  // tick; the deadline is a stored timestamp so this also catches a deadline passed while the tab was closed
  useEffect(() => {
    if (!active || !bank) return;
    const check = () => {
      const t = Date.now();
      setNow(t);
      if (shouldAutoSubmit(active, t)) submit(active.id);
    };
    check();
    const id = setInterval(check, 1000);
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', check); };
  }, [active?.id, !!bank]);

  if (!state || !bank) return <Loading state={state} bank={bank} error={error} />;
  if (unsavedResult) {
    const download = () => {
      const url = URL.createObjectURL(new Blob([unsavedResult.json], { type: 'application/json' }));
      Object.assign(document.createElement('a'), { href: url, download: 'ipas-records-unsaved.json' }).click();
      URL.revokeObjectURL(url);
    };
    return (
      <>
        <SaveWarning ok={false} />
        <p class="notice">已交卷，成績 {unsavedResult.session.score} 分，但這次紀錄無法儲存。請先匯出備份；離開本頁後這次作答會消失。<button class="btn small" onClick={download}>匯出目前紀錄</button></p>
      </>
    );
  }
  if (!active) return <p class="notice">目前沒有進行中的作答。<a href="/">回首頁</a></p>;

  const qs = active.questionIds.map((id) => bank.byId[id]);
  const i = Math.min(index, qs.length - 1);
  const q = qs[i];
  if (!q) return <p class="notice warn">這份作答的題目已不在題庫中。<button class="btn small" onClick={() => update((s) => ({ ...s, active: null }))}>捨棄</button></p>;

  // the only write path for answers/flags: rejected once the deadline has passed, which submits instead
  const edit = async (e: Edit) => {
    let expired = false;
    await update((s) => {
      const r = applyEdit(s, active.id, e, Date.now());
      expired = r.expired;
      return r.state;
    });
    if (expired) submit(active.id);
  };
  const blanks = active.answers.filter((a) => a === null).length;
  const timed = active.deadline !== null;

  const confirmSubmit = () => {
    if (blanks && !confirm(`還有 ${blanks} 題未作答，確定要交卷嗎？`)) return;
    submit(active.id);
  };

  return (
    <>
      <SaveWarning ok={saveOk} />
      <div class="bar">
        <b>{MODE_LABEL[active.mode]} · {subjectLabel(active.subject)}</b>
        <span class="muted">已答 {qs.length - blanks}/{qs.length}</span>
        {timed ? <span class={`clock ${remainingMs(active.deadline!, now) < 300_000 ? 'low' : ''}`} role="timer">{formatClock(remainingMs(active.deadline!, now))}</span> : null}
        <button class="btn small" onClick={confirmSubmit}>交卷</button>
      </div>

      <div class="card">
        <div class="qhead"><b>第 {i + 1} / {qs.length} 題</b>
          <button class={`btn small ghost ${active.flagged[i] ? 'on' : ''}`} onClick={() => edit({ type: 'flag', index: i })}>
            {active.flagged[i] ? '已標記' : '標記'}
          </button>
        </div>
        <Rich text={q.stem} />
        <div class="choices" role="radiogroup">
          {q.options.map((o, k) => (
            <button key={k} role="radio" aria-checked={active.answers[i] === k} class={`choice ${active.answers[i] === k ? 'sel' : ''}`}
              onClick={() => edit({ type: 'answer', index: i, choice: k })}>
              <span class="letter">{LETTERS[k]}</span><span>{o}</span>
            </button>
          ))}
        </div>
        <div class="row between">
          <button class="btn ghost" disabled={i === 0} onClick={() => setIndex(i - 1)}>上一題</button>
          <button class="btn ghost" disabled={i === qs.length - 1} onClick={() => setIndex(i + 1)}>下一題</button>
        </div>
      </div>

      <h2>題號</h2>
      <div class="qgrid" aria-label="題號表">
        {qs.map((_, k) => (
          <button key={k} onClick={() => setIndex(k)}
            class={`${active.answers[k] !== null ? 'done' : ''} ${active.flagged[k] ? 'flag' : ''} ${k === i ? 'cur' : ''}`}
            aria-label={`第 ${k + 1} 題${active.answers[k] !== null ? '，已作答' : '，未作答'}${active.flagged[k] ? '，已標記' : ''}`}>
            {k + 1}
          </button>
        ))}
      </div>
      <p class="muted legend"><i class="done" /> 已作答 <i class="flag" /> 已標記 <i /> 未作答</p>
      <AdSlot slot="session" level={levelOf(active.subject)} />
    </>
  );
}
