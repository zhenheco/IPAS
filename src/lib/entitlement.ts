/**
 * 免費／付費功能的邊界（純函式）。見 GLOSSARY「會員與付費」。
 *
 * 整個付費機制由 PAYWALL_ENABLED 控制：預設關閉，網站行為與目前自用版完全相同；
 * 擁有者在建置時設定 PUBLIC_PAYWALL_ENABLED=1 才會啟用。
 */
import type { PassLevel } from './pricing';

export const PAYWALL_ENABLED: boolean = import.meta.env.PUBLIC_PAYWALL_ENABLED === '1';

/** 本站功能；名稱對應 GLOSSARY 術語 */
export type Feature =
  | 'practice' // 練習
  | 'history' // 作答歷史
  | 'exam' // 單科模考
  | 'full' // 全真模考
  | 'wrongbook' // 錯題本
  | 'redo' // 錯題重做
  | 'weakness' // 弱點分析
  | 'plan' // 讀書計畫
  | 'noAds'; // 無廣告

export const FEATURE_NAME: Record<Feature, string> = {
  practice: '練習',
  history: '作答歷史',
  exam: '單科模考',
  full: '全真模考',
  wrongbook: '錯題本',
  redo: '錯題重做',
  weakness: '弱點分析',
  plan: '讀書計畫',
  noAds: '無廣告',
};

/** 免費會員可用：練習與作答歷史；其餘皆需該級別的有效考期通行證。 */
export const FREE_FEATURES: readonly Feature[] = ['practice', 'history'];
export const PAID_FEATURES: readonly Feature[] = ['exam', 'full', 'wrongbook', 'redo', 'weakness', 'plan', 'noAds'];

export const isPaidFeature = (f: Feature) => PAID_FEATURES.includes(f);

/** 作答模式（AppState Session.mode）對應的功能 */
export const MODE_FEATURE = { practice: 'practice', exam: 'exam', full: 'full', redo: 'redo' } as const satisfies Record<string, Feature>;

/**
 * 只有「開始」單科模考／全真模考／錯題重做的作答時才回報 /api/usage/paid-feature，
 * 以停止退款資格。開啟錯題本、弱點分析、讀書計畫（僅瀏覽）與「無廣告」不算使用。
 */
export const countsAsPaidUse = (f: Feature) => f === 'exam' || f === 'full' || f === 'redo';

export type EntitlementMap = Record<PassLevel, { paid: boolean; validUntil: string | null }>;

/**
 * 是否可使用某功能。
 * - paywall 關閉：一律可用（目前的自用版行為）。
 * - 免費功能：一律可用（未登入也可）。
 * - 付費功能：需持有該級別的有效通行證（初級與中級分開，ADR 0003）。
 */
export function canUse(f: Feature, level: PassLevel, ent: EntitlementMap | null, paywallEnabled = PAYWALL_ENABLED): boolean {
  if (!paywallEnabled || !isPaidFeature(f)) return true;
  return ent?.[level]?.paid === true;
}

const TAIPEI_OFFSET_MS = 8 * 3_600_000;
const taipeiDay = (ms: number) => new Date(ms + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);

/**
 * 升級提醒：每日（台灣日曆日）至多顯示一次。
 * lastShownAt 為上次顯示的時刻（epoch ms 或 ISO 字串），null/無效代表從未顯示。
 * 時鐘被調回（now 早於上次顯示日）時不顯示，避免同日重複出現。
 */
export function shouldShowUpgradePrompt(lastShownAt: number | string | null | undefined, now: number | Date): boolean {
  const n = typeof now === 'number' ? now : now.getTime();
  if (lastShownAt === null || lastShownAt === undefined) return true;
  const last = typeof lastShownAt === 'number' ? lastShownAt : Date.parse(lastShownAt);
  if (!Number.isFinite(last)) return true;
  return taipeiDay(n) > taipeiDay(last);
}

/** 是否應顯示廣告：paywall 啟用、已設定 AdSense，且使用者沒有任何有效通行證（或沒有指定級別的通行證）。 */
export function shouldShowAds(o: { paywallEnabled: boolean; adClient: string | undefined; ent: EntitlementMap | null; level?: PassLevel }): boolean {
  if (!o.paywallEnabled || !o.adClient) return false;
  if (!o.ent) return true;
  if (o.level) return !o.ent[o.level]?.paid;
  return !Object.values(o.ent).some((e) => e.paid);
}
