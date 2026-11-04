/**
 * 帳號同步：把 localStorage AppState 的 sessions（作答歷史）與 questionStats 合併到帳號。
 *
 * 合併規則（確定性、與呼叫順序無關的部分已在測試中驗證）：
 * - sessions：依 id 聯集。已交卷的 Session 不會再變動，同 id 兩邊都有時保留伺服器版本。
 *   結果依 submittedAt、再依 id 排序。
 * - questionStats：同一題兩邊都有時「整筆擇一」，不逐欄相加（兩台裝置的計數無法分辨重疊，相加會重複計算）：
 *   1. attempts 較多者勝（作答次數在單一裝置上只增不減，較多代表較新、較完整）
 *   2. 相同時 lastWrongAt 較晚者勝（null 視為最早）
 *   3. 仍相同時保留伺服器版本
 *   整筆擇一可保持 attempts = correct + wrong、redoStreak 與 inWrongBook 的一致性。
 *   代價：同一題在兩台裝置「同步之前」各自作答時，次數較少那邊的增量會遺失（文件已說明，建議每台裝置開始前先同步）。
 */
import { sessionError, statError } from '../src/lib/storage';
import type { QuestionStat, Session } from '../src/lib/types';
import { bool, chunk, type Store } from './db';

export interface SyncData {
  sessions: Session[];
  questionStats: Record<string, QuestionStat>;
}

export const SYNC_LIMITS = { sessions: 20_000, stats: 100_000, questionIdLength: 64 };

const cmpSession = (a: Session, b: Session) => (a.submittedAt < b.submittedAt ? -1 : a.submittedAt > b.submittedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** 回傳 server 與 client 中應保留的那筆（見檔頭規則 1–3） */
export function pickStat(server: QuestionStat, client: QuestionStat): QuestionStat {
  if (client.attempts !== server.attempts) return client.attempts > server.attempts ? client : server;
  const sw = server.lastWrongAt ? Date.parse(server.lastWrongAt) : -Infinity;
  const cw = client.lastWrongAt ? Date.parse(client.lastWrongAt) : -Infinity;
  if (cw !== sw) return cw > sw ? client : server;
  return server;
}

const sameStat = (a: QuestionStat, b: QuestionStat) =>
  a.attempts === b.attempts && a.correct === b.correct && a.wrong === b.wrong && a.lastWrongAt === b.lastWrongAt &&
  a.redoStreak === b.redoStreak && a.inWrongBook === b.inWrongBook;

export function mergeSync(server: SyncData, client: SyncData): { merged: SyncData; newSessions: Session[]; changedStats: [string, QuestionStat][] } {
  const byId = new Map(server.sessions.map((s) => [s.id, s]));
  const newSessions: Session[] = [];
  for (const s of client.sessions) if (!byId.has(s.id)) { byId.set(s.id, s); newSessions.push(s); }
  const questionStats: Record<string, QuestionStat> = { ...server.questionStats };
  const changedStats: [string, QuestionStat][] = [];
  for (const [id, c] of Object.entries(client.questionStats)) {
    const s = server.questionStats[id];
    const pick = s ? pickStat(s, c) : c;
    if (!s || !sameStat(s, pick)) { questionStats[id] = pick; changedStats.push([id, pick]); }
  }
  return { merged: { sessions: [...byId.values()].sort(cmpSession), questionStats }, newSessions, changedStats };
}

/** 驗證 PUT /api/sync 的內容；規則與 src/lib/storage.ts 匯入相同，任一筆無效即整批拒絕。 */
export function parseSyncBody(x: unknown): { ok: true; data: SyncData } | { ok: false; error: string } {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return { ok: false, error: '內容必須是物件' };
  const o = x as Record<string, unknown>;
  if (o.schemaVersion !== 1) return { ok: false, error: '不支援的 schemaVersion' };
  if (!Array.isArray(o.sessions)) return { ok: false, error: '缺少 sessions 陣列' };
  if (typeof o.questionStats !== 'object' || o.questionStats === null || Array.isArray(o.questionStats)) return { ok: false, error: '缺少 questionStats 物件' };
  if (o.sessions.length > SYNC_LIMITS.sessions) return { ok: false, error: '作答歷史筆數超過上限' };
  const stats = Object.entries(o.questionStats as Record<string, unknown>);
  if (stats.length > SYNC_LIMITS.stats) return { ok: false, error: '作答統計筆數超過上限' };
  const seen = new Set<string>();
  for (const [i, s] of o.sessions.entries()) {
    const err = sessionError(s);
    if (err) return { ok: false, error: `第 ${i + 1} 筆作答歷史無效：${err}` };
    const id = (s as Session).id;
    if (seen.has(id)) return { ok: false, error: `作答歷史 id 重複：${id}` };
    seen.add(id);
  }
  for (const [id, st] of stats) {
    if (!id || id.length > SYNC_LIMITS.questionIdLength) return { ok: false, error: `題目 id 無效：${id.slice(0, 80)}` };
    const err = statError(st);
    if (err) return { ok: false, error: `題目 ${id} 的作答統計無效：${err}` };
  }
  // 只保留已知欄位，避免把多餘資料寫入資料庫
  const sessions = (o.sessions as Session[]).map((s) => ({
    id: s.id, mode: s.mode, subject: s.subject, startedAt: s.startedAt, submittedAt: s.submittedAt,
    questionIds: s.questionIds, answers: s.answers, score: s.score, ...(s.fullId !== undefined ? { fullId: s.fullId } : {}),
  }));
  const questionStats = Object.fromEntries(stats.map(([id, v]) => {
    const s = v as QuestionStat;
    return [id, { attempts: s.attempts, correct: s.correct, wrong: s.wrong, lastWrongAt: s.lastWrongAt, redoStreak: s.redoStreak, inWrongBook: s.inWrongBook }];
  }));
  return { ok: true, data: { sessions, questionStats } };
}

export async function loadSync(store: Store, userId: string): Promise<SyncData> {
  const [rows, stats] = await Promise.all([
    store.db.selectFrom('sync_sessions').selectAll().where('user_id', '=', userId).execute(),
    store.db.selectFrom('sync_question_stats').selectAll().where('user_id', '=', userId).execute(),
  ]);
  const sessions = rows.map((r): Session => ({
    id: r.session_id, mode: r.mode as Session['mode'], subject: Number(r.subject) as Session['subject'],
    startedAt: r.started_at, submittedAt: r.submitted_at,
    questionIds: JSON.parse(r.question_ids), answers: JSON.parse(r.answers), score: Number(r.score),
    ...(r.full_id !== null ? { fullId: r.full_id } : {}),
  })).sort(cmpSession);
  const questionStats = Object.fromEntries(stats.map((r) => [r.question_id, {
    attempts: Number(r.attempts), correct: Number(r.correct), wrong: Number(r.wrong), lastWrongAt: r.last_wrong_at,
    redoStreak: Number(r.redo_streak), inWrongBook: bool(r.in_wrong_book),
  } satisfies QuestionStat]));
  return { sessions, questionStats };
}

/** 讀取 → 合併 → 只寫入新增/變動的列（單一 batch） */
export async function syncUser(store: Store, userId: string, client: SyncData, now: Date): Promise<SyncData> {
  const server = await loadSync(store, userId);
  const { merged, newSessions, changedStats } = mergeSync(server, client);
  const ts = now.toISOString();
  const queries = [
    ...chunk(newSessions, 11).map((rows) => store.db.insertInto('sync_sessions').values(rows.map((s) => ({
      user_id: userId, session_id: s.id, mode: s.mode, subject: s.subject, started_at: s.startedAt, submitted_at: s.submittedAt,
      question_ids: JSON.stringify(s.questionIds), answers: JSON.stringify(s.answers), score: s.score, full_id: s.fullId ?? null, created_at: ts,
    }))).onConflict((oc) => oc.columns(['user_id', 'session_id']).doNothing())),
    ...chunk(changedStats, 9).map((rows) => store.db.insertInto('sync_question_stats').values(rows.map(([id, s]) => ({
      user_id: userId, question_id: id, attempts: s.attempts, correct: s.correct, wrong: s.wrong, last_wrong_at: s.lastWrongAt,
      redo_streak: s.redoStreak, in_wrong_book: s.inWrongBook, updated_at: ts,
    }))).onConflict((oc) => oc.columns(['user_id', 'question_id']).doUpdateSet((eb) => ({
      attempts: eb.ref('excluded.attempts'), correct: eb.ref('excluded.correct'), wrong: eb.ref('excluded.wrong'),
      last_wrong_at: eb.ref('excluded.last_wrong_at'), redo_streak: eb.ref('excluded.redo_streak'),
      in_wrong_book: eb.ref('excluded.in_wrong_book'), updated_at: eb.ref('excluded.updated_at'),
    })))),
  ];
  await store.atomic(queries);
  return merged;
}
