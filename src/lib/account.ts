/**
 * 前端帳號狀態：呼叫 /api/me，離線、404（純靜態部署沒有 API）或任何非預期回應都視為「paywall 停用」，
 * 讓網站維持目前自用版的行為（所有功能可用、無廣告）。
 */
import { PAYWALL_ENABLED, countsAsPaidUse, type EntitlementMap, type Feature } from './entitlement';
import type { PassLevel, PriceType, RefundBlock } from './pricing';
import type { QuestionStat, Session } from './types';

/** 與 worker/orders.ts 的 Me 相同形狀（前端不直接依賴 Worker 程式碼） */
export interface Me {
  user: { id: string; email: string; name: string; image: string | null };
  passes: { id: string; sittingId: string; level: PassLevel; examDate: string; validFrom: string; validUntil: string; firstPaidFeatureUsedAt: string | null; revokedAt: string | null }[];
  entitlements: EntitlementMap;
  orders: {
    id: string; merchantTradeNo: string; sittingId: string; level: PassLevel; priceType: PriceType; amount: number;
    status: 'pending' | 'paid' | 'failed' | 'refunded'; createdAt: string; paidAt: string | null; refundRequestedAt: string | null;
    refund: { eligible: true } | { eligible: false; reason: RefundBlock };
  }[];
}

export type AccountState =
  | { status: 'disabled' } // paywall 關閉或 API 不可用：一切照舊
  | { status: 'anonymous' } // 未登入（免費使用者）
  | { status: 'signed-in'; me: Me };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: FetchLike = (i, init) => fetch(i, { credentials: 'same-origin', ...init });

export async function fetchAccount(fetchImpl: FetchLike = defaultFetch, enabled = PAYWALL_ENABLED): Promise<AccountState> {
  if (!enabled) return { status: 'disabled' };
  try {
    const r = await fetchImpl('/api/me', { headers: { accept: 'application/json' } });
    if (r.status === 401) return { status: 'anonymous' };
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('application/json')) return { status: 'disabled' };
    const me = (await r.json()) as Me;
    if (!me?.user?.id || !me.entitlements) return { status: 'disabled' };
    return { status: 'signed-in', me };
  } catch {
    return { status: 'disabled' };
  }
}

let cached: Promise<AccountState> | null = null;
/** 同一頁面只查一次；登入狀態改變後以 force 重新查詢 */
export function getAccount(force = false): Promise<AccountState> {
  if (!cached || force) cached = fetchAccount();
  return cached;
}

/** 帳號狀態下是否可使用某級別的付費權益；disabled 視為全部可用 */
export function isEntitled(a: AccountState | null, level: PassLevel): boolean {
  if (!a) return false;
  if (a.status === 'disabled') return true;
  return a.status === 'signed-in' && a.me.entitlements[level]?.paid === true;
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/**
 * 開始單科模考、全真模考、錯題重做的作答時呼叫，讓伺服器記錄首次使用時間（之後即不適用退款）。
 * 僅瀏覽錯題本、弱點分析、讀書計畫不算。失敗不影響使用。
 * keepalive：呼叫端不等待結果就導向 /session/，要讓請求不被換頁中斷。
 */
export async function reportPaidFeatureUse(
  level: PassLevel, feature: Feature, fetchImpl: FetchLike = defaultFetch, enabled = PAYWALL_ENABLED, account: () => Promise<AccountState> = getAccount,
): Promise<boolean> {
  if (!enabled || !countsAsPaidUse(feature)) return false;
  const a = await account();
  if (a.status !== 'signed-in' || !a.me.entitlements[level]?.paid) return false;
  try { return (await fetchImpl('/api/usage/paid-feature', { ...json({ level, feature }), keepalive: true })).ok; } catch { return false; }
}

export async function signOut(fetchImpl: FetchLike = defaultFetch) {
  await fetchImpl('/api/auth/sign-out', json({}));
  cached = null;
}

export async function requestRefund(orderId: string, reason: string, fetchImpl: FetchLike = defaultFetch): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const r = await fetchImpl('/api/refund-request', json({ orderId, reason: reason || undefined }));
    if (r.ok) return { ok: true };
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: j.error ?? `HTTP ${r.status}` };
  } catch { return { ok: false, error: 'network' }; }
}

/** 上傳本機作答歷史與統計，取回與帳號合併後的結果 */
export async function syncWithAccount(local: { sessions: Session[]; questionStats: Record<string, QuestionStat> }, fetchImpl: FetchLike = defaultFetch):
  Promise<{ ok: true; sessions: Session[]; questionStats: Record<string, QuestionStat> } | { ok: false; error: string }> {
  try {
    const r = await fetchImpl('/api/sync', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ schemaVersion: 1, sessions: local.sessions, questionStats: local.questionStats }) });
    const j = (await r.json().catch(() => null)) as { sessions?: Session[]; questionStats?: Record<string, QuestionStat>; message?: string; error?: string } | null;
    if (!r.ok || !j?.sessions || !j.questionStats) return { ok: false, error: j?.message ?? j?.error ?? `HTTP ${r.status}` };
    return { ok: true, sessions: j.sessions, questionStats: j.questionStats };
  } catch { return { ok: false, error: 'network' }; }
}

/** 只接受站內相對路徑，避免開放式重新導向 */
export const safeNext = (next: string | null, fallback = '/account/') => (next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : fallback);
