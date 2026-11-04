import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { DEFAULT_LEVEL, DEFAULT_SUBJECTS } from '../config';
import { ALL_SUBJECTS, LEVELS, LEVEL_ORDER, isLevel, isSubject, levelOf, type Level } from '../lib/levels';
import { STORAGE_KEY, emptyState, loadState, updateState, withLock } from '../lib/storage';
import type { AppState, Bank, Question, Subject } from '../lib/types';

let mem: AppState | null = null;
/** true after a failed write: memory is newer than storage and must keep being used */
let unsaved = false;
export const isUnsaved = () => unsaved;

/**
 * App state backed by localStorage. Every write re-reads the latest stored state and applies the change to it
 * (so several tabs cannot overwrite each other); the `storage` event refreshes this tab when another one writes.
 * In-memory fallback applies only when storage is blocked.
 */
export function useApp() {
  const [state, setState] = useState<AppState | null>(null);
  const [saveOk, setSaveOk] = useState(true);
  useEffect(() => {
    mem = loadState();
    setState(mem);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== STORAGE_KEY) return;
      if (unsaved) return; // never replace newer unsaved memory with the stored copy
      mem = loadState();
      setState(mem);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  // read-modify-write under a Web Lock; resolves with the new state once the change is applied
  const update = useCallback(
    (fn: (s: AppState) => AppState) =>
      withLock(typeof navigator === 'undefined' ? undefined : navigator.locks, () => {
        const r = updateState(fn, undefined, mem ?? emptyState(), unsaved);
        mem = r.state;
        unsaved = !r.saved;
        setSaveOk(r.saved);
        setState(r.state);
        return r.state;
      }),
    [],
  );
  return { state, update, saveOk };
}

export function useBank() {
  const [bank, setBank] = useState<Bank | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch('/bank.json')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setBank, () => setError(true));
  }, []);
  const derived = useMemo(() => {
    if (!bank) return null;
    const byId: Record<string, Question> = Object.fromEntries(bank.questions.map((q) => [q.id, q]));
    const count = (s: Subject) => bank.questions.filter((q) => q.subject === s).length;
    const subjects = ALL_SUBJECTS.filter((s) => DEFAULT_SUBJECTS.includes(s) || count(s) > 0);
    const levels = LEVEL_ORDER.filter((l) => subjects.some((s) => levelOf(s) === l));
    const subjectsOf = (l: Level) => subjects.filter((s) => levelOf(s) === l);
    const papersOf = (s: Subject) => (bank.papers ?? []).filter((p) => p.subject === s).sort((a, b) => a.no - b.no);
    return { ...bank, byId, count, subjects, levels, subjectsOf, papersOf };
  }, [bank]);
  return { bank: derived, error };
}

export type LoadedBank = NonNullable<ReturnType<typeof useBank>['bank']>;

const LEVEL_KEY = 'ipas.level';

/**
 * The level (初級/中級) being viewed: ?level= or ?subject= in the URL, else the last one picked on this device.
 * Remembering it is a per-viewer convenience only, so storage errors are ignored.
 */
export function useLevel(available: Level[] | undefined) {
  const [picked, setPicked] = useState<Level | null>(null);
  useEffect(() => {
    const q = query();
    const fromUrl = q.get('level');
    const s = Number(q.get('subject'));
    let stored: string | null = null;
    try { stored = localStorage.getItem(LEVEL_KEY); } catch { /* ignore */ }
    const l = isLevel(fromUrl) ? fromUrl : isSubject(s) ? levelOf(s) : isLevel(stored) ? stored : null;
    if (l) setPicked(l);
  }, []);
  const set = (l: Level) => {
    setPicked(l);
    try { localStorage.setItem(LEVEL_KEY, l); } catch { /* ignore */ }
  };
  const list = available?.length ? available : [DEFAULT_LEVEL];
  const level = picked && list.includes(picked) ? picked : list.includes(DEFAULT_LEVEL) ? DEFAULT_LEVEL : list[0]!;
  return { level, setLevel: set };
}

export function LevelTabs({ levels, level, onPick }: { levels: Level[]; level: Level; onPick: (l: Level) => void }) {
  if (levels.length < 2) return null;
  return (
    <div class="tabs" role="tablist" aria-label="級別">
      {levels.map((l) => (
        <button key={l} role="tab" aria-selected={l === level} class={l === level ? 'on' : ''} onClick={() => onPick(l)}>{LEVELS[l].name}</button>
      ))}
    </div>
  );
}

export const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
export const go = (url: string) => { location.href = url; };
export const query = () => new URLSearchParams(location.search);

export const fmtDate = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function Loading({ state, bank, error }: { state: unknown; bank: unknown; error: boolean }) {
  if (error) return <p class="notice warn">題目資料載入失敗，請重新整理頁面。</p>;
  return state && bank ? null : <p class="muted">載入中…</p>;
}

export function SaveWarning({ ok }: { ok: boolean }) {
  return ok ? null : (
    <p class="notice warn" role="alert">
      紀錄沒有被儲存（儲存空間已滿，或瀏覽器封鎖了網站資料）。目前的作答只保留在這個頁面，重新整理或關閉後會消失；請到「設定」匯出紀錄備份並清出空間。
    </p>
  );
}

export function Badge({ passed }: { passed: boolean }) {
  return <span class={`badge ${passed ? 'ok' : 'bad'}`}>{passed ? '通過' : '未通過'}</span>;
}

export function Card({ children, class: c }: { children: ComponentChildren; class?: string }) {
  return <section class={`card ${c ?? ''}`}>{children}</section>;
}
