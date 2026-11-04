import { isSubject, levelOf } from './levels';
import type { ActiveSession, AppState, FullExam, QuestionStat, Session } from './types';

export const STORAGE_KEY = 'ipas.v1';

type Store = Pick<Storage, 'getItem' | 'setItem'>;
type Obj = Record<string, unknown>;

const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isInt = (x: unknown): x is number => Number.isInteger(x);
const isCount = (x: unknown): x is number => isInt(x) && (x as number) >= 0;
const isDate = (x: unknown): x is string => typeof x === 'string' && !Number.isNaN(Date.parse(x));
const isStrArr = (x: unknown): x is string[] => Array.isArray(x) && x.every((v) => typeof v === 'string');
const isAnswer = (v: unknown) => v === null || (isInt(v) && (v as number) >= 0 && (v as number) <= 3);
const isAnswers = (x: unknown): x is (number | null)[] => Array.isArray(x) && x.every(isAnswer);
const MODES = ['practice', 'exam', 'full', 'redo'];
const SOURCES = ['all', 'official', 'original'];

/** Returns why a session record is invalid, or null. Shared by load (drop bad records) and import (reject all). */
export function sessionError(x: unknown): string | null {
  if (!isObj(x)) return '不是物件';
  if (typeof x.id !== 'string' || !x.id) return '缺少 id';
  if (!MODES.includes(x.mode as string)) return 'mode 無效';
  if (!isSubject(x.subject)) return 'subject 無效';
  if (!isDate(x.startedAt) || !isDate(x.submittedAt)) return '時間格式無效';
  if (!isStrArr(x.questionIds)) return 'questionIds 無效';
  if (!isAnswers(x.answers)) return 'answers 必須是 0 到 3 的整數或 null';
  if (x.answers.length !== x.questionIds.length) return 'answers 與 questionIds 數量不一致';
  if (!isInt(x.score) || x.score < 0 || x.score > 100) return 'score 必須是 0 到 100 的整數';
  if (x.fullId !== undefined && typeof x.fullId !== 'string') return 'fullId 無效';
  if (x.paperId !== undefined && typeof x.paperId !== 'string') return 'paperId 無效';
  return null;
}

export function statError(x: unknown): string | null {
  if (!isObj(x)) return '不是物件';
  if (!isCount(x.attempts) || !isCount(x.correct) || !isCount(x.wrong) || !isCount(x.redoStreak)) return '次數必須是非負整數';
  if (x.correct + x.wrong !== x.attempts) return 'attempts 必須等於 correct + wrong';
  if (x.lastWrongAt !== null && !isDate(x.lastWrongAt)) return 'lastWrongAt 無效';
  if (typeof x.inWrongBook !== 'boolean') return 'inWrongBook 必須是布林值';
  return null;
}

const isSession = (x: unknown): x is Session => sessionError(x) === null;
const isStat = (x: unknown): x is QuestionStat => statError(x) === null;

const isActive = (x: unknown): x is ActiveSession =>
  isObj(x) && typeof x.id === 'string' && MODES.includes(x.mode as string) && isSubject(x.subject) &&
  isNum(x.startedAt) && (x.deadline === null || isNum(x.deadline)) && isStrArr(x.questionIds) && isAnswers(x.answers) &&
  x.answers.length === x.questionIds.length && Array.isArray(x.flagged) && x.flagged.length === x.questionIds.length;

const isFull = (x: unknown): x is FullExam =>
  isObj(x) && typeof x.id === 'string' && (x.elective === 2 || x.elective === 3 || x.elective === 12) &&
  ['section1', 'break', 'section2', 'done'].includes(x.stage as string) && (x.breakDeadline === null || isNum(x.breakDeadline)) &&
  (x.source === undefined || SOURCES.includes(x.source as string));

export const emptyState = (): AppState => ({ schemaVersion: 1, sessions: [], questionStats: {}, active: null, fullExam: null });

/** Unknown / corrupt / other-version input yields an empty state; malformed pieces are dropped individually. */
export function parseState(raw: string | null): AppState {
  let o: unknown;
  try { o = raw ? JSON.parse(raw) : null; } catch { return emptyState(); }
  if (!isObj(o) || o.schemaVersion !== 1) return emptyState();
  return {
    schemaVersion: 1,
    sessions: Array.isArray(o.sessions) ? o.sessions.filter(isSession) : [],
    questionStats: isObj(o.questionStats) ? Object.fromEntries(Object.entries(o.questionStats).filter(([, v]) => isStat(v))) as Record<string, QuestionStat> : {},
    active: isActive(o.active) ? o.active : null,
    fullExam: isFull(o.fullExam) ? o.fullExam : null,
  };
}

export function loadState(store: Store | undefined = defaultStore()): AppState {
  try { return parseState(store?.getItem(STORAGE_KEY) ?? null); } catch { return emptyState(); }
}

type LockManagerLike = { request: <T>(name: string, cb: () => T | Promise<T>) => Promise<T> };

/** Serialises read-modify-write cycles across tabs with Web Locks; runs directly where unavailable. */
export const withLock = <T>(locks: LockManagerLike | undefined, fn: () => T | Promise<T>): Promise<T> =>
  locks ? locks.request('ipas-state', fn) : Promise.resolve().then(fn);

/**
 * Read-modify-write at the moment of the write, so several tabs never overwrite each other with stale memory.
 * `fallback` (the tab's in-memory state) is used when storage cannot be read, or when `unsaved` (a previous write failed).
 */
export function updateState(fn: (s: AppState) => AppState, store: Store | undefined = defaultStore(), fallback: AppState = emptyState(), unsaved = false) {
  let base = fallback;
  // after a failed write the stored copy is older than memory; keep building on memory so nothing is lost
  if (!unsaved) try { if (store) base = parseState(store.getItem(STORAGE_KEY)); } catch { /* keep fallback */ }
  const state = fn(base);
  return { state, saved: saveState(state, store) };
}

export function saveState(state: AppState, store: Store | undefined = defaultStore()): boolean {
  try {
    if (!store) return false;
    store.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch { return false; }
}

function defaultStore(): Store | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; }
}

/** Portable records only (history + per-question stats); the in-progress session stays on the device. */
export function exportJson(s: AppState) {
  return JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), sessions: s.sessions, questionStats: s.questionStats }, null, 2);
}

/** Replaces history + stats only if every record is valid; otherwise rejects the whole file with the reason. */
export function importJson(text: string, current: AppState): { ok: true; state: AppState } | { ok: false; error: string } {
  let o: unknown;
  try { o = JSON.parse(text); } catch { return { ok: false, error: '不是有效的 JSON 檔案' }; }
  if (!isObj(o) || o.schemaVersion !== 1) return { ok: false, error: '不支援的紀錄格式或版本' };
  if (!Array.isArray(o.sessions)) return { ok: false, error: '缺少 sessions 陣列' };
  if (!isObj(o.questionStats)) return { ok: false, error: '缺少 questionStats 物件' };
  const seen = new Set<string>();
  for (const [i, s] of o.sessions.entries()) {
    const err = sessionError(s);
    if (err) return { ok: false, error: `第 ${i + 1} 筆作答歷史無效：${err}` };
    const id = (s as Session).id;
    if (seen.has(id)) return { ok: false, error: `第 ${i + 1} 筆作答歷史的 id 重複：${id}` };
    seen.add(id);
  }
  for (const [id, st] of Object.entries(o.questionStats)) {
    const err = statError(st);
    if (err) return { ok: false, error: `題目 ${id} 的作答統計無效：${err}` };
  }
  return { ok: true, state: { ...current, sessions: o.sessions as Session[], questionStats: o.questionStats as Record<string, QuestionStat> } };
}
