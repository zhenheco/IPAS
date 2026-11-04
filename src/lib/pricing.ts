/**
 * 考期通行證的定價、有效期與退款規則（純函式，前端價目頁與 Worker 共用）。
 * 決策見 docs/adr/0001-exam-pass-pricing.md 與 docs/adr/0003-beginner-level-pass.md。
 *
 * 所有「日期」皆以台灣時間（Asia/Taipei，UTC+8，無日光節約）的日曆日判斷。
 */

/** 等同 src/lib/levels.ts 的 Level；在此自行定義，讓 Worker 不依賴前端題庫模組。 */
export type PassLevel = 'beginner' | 'intermediate';
export const PASS_LEVELS: PassLevel[] = ['beginner', 'intermediate'];
export const PASS_LEVEL_NAME: Record<PassLevel, string> = { beginner: '初級', intermediate: '中級' };
export const isPassLevel = (x: unknown): x is PassLevel => x === 'beginner' || x === 'intermediate';

export type PriceType = 'early' | 'regular' | 'renewal';
export const PRICE_TYPE_NAME: Record<PriceType, string> = { regular: '定價', early: '早鳥價', renewal: '續購價' };

/**
 * 唯一的價格設定。金額為新臺幣整數元（TWD 實務上無小數，PAYUNi TradeAmt 亦為整數元）。
 * 初級價格 290/249/199 為擁有者 2026-11-05 確認（ADR 0003）。
 */
export const PRICING = {
  prices: {
    intermediate: { regular: 590, early: 490, renewal: 390 },
    beginner: { regular: 290, early: 249, renewal: 199 },
  } satisfies Record<PassLevel, Record<PriceType, number>>,
  /** 考試日前 N 天（含）以上購買適用早鳥價 */
  earlyBirdDays: 45,
  /** 通行證有效至考試日後 N 天（該日台灣時間 23:59:59.999 止） */
  validDaysAfterExam: 30,
  /** 購買後 N 天內（以 24 小時計）且尚未開始模擬考／全真模考／錯題重做可全額退款 */
  refundWindowDays: 7,
} as const;

const DAY_MS = 86_400_000;
const TAIPEI_OFFSET_MS = 8 * 3_600_000;

const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
function ymdToUtcMs(ymd: string): number {
  if (!isYmd(ymd)) throw new Error(`日期格式須為 YYYY-MM-DD：${ymd}`);
  return Date.parse(`${ymd}T00:00:00Z`);
}

/** 某時刻在台灣的日曆日 YYYY-MM-DD */
export const taipeiDate = (t: Date): string => new Date(t.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);

/** 兩個日曆日相差天數（to - from） */
export const daysBetween = (from: string, to: string) => Math.round((ymdToUtcMs(to) - ymdToUtcMs(from)) / DAY_MS);

/** 日曆日加 N 天 */
export const addDays = (ymd: string, n: number) => new Date(ymdToUtcMs(ymd) + n * DAY_MS).toISOString().slice(0, 10);

/** 台灣某日曆日的最後一毫秒（UTC ISO 字串） */
export const endOfTaipeiDay = (ymd: string) => new Date(ymdToUtcMs(ymd) + DAY_MS - TAIPEI_OFFSET_MS - 1).toISOString();

export interface PriceQuote {
  priceType: PriceType;
  amount: number;
  /** 所有適用的價格，供說明「為何是這個價」 */
  applicable: { priceType: PriceType; amount: number }[];
}

/**
 * 計算應付價格：列出所有適用價格後取最低者。
 * - 定價：永遠適用。
 * - 早鳥價：購買日（台灣日曆日）在考試日前 earlyBirdDays 天（含）以上。
 * - 續購價：使用者曾有一筆已付款（未退款）的考期通行證，不限級別（ADR 0003，擁有者已確認）。
 * 同額時依 renewal → early → regular 的順序取第一個（僅影響標示，不影響金額）。
 */
export function quotePrice(o: { level: PassLevel; examDate: string; now: Date; hasPriorPaidPass: boolean }): PriceQuote {
  const p = PRICING.prices[o.level];
  const applicable: { priceType: PriceType; amount: number }[] = [];
  if (o.hasPriorPaidPass) applicable.push({ priceType: 'renewal', amount: p.renewal });
  if (daysBetween(taipeiDate(o.now), o.examDate) >= PRICING.earlyBirdDays) applicable.push({ priceType: 'early', amount: p.early });
  applicable.push({ priceType: 'regular', amount: p.regular });
  const best = applicable.reduce((a, b) => (b.amount < a.amount ? b : a));
  return { ...best, applicable };
}

/** 通行證有效期：自購買（付款）當下起，至考試日後 validDaysAfterExam 天的台灣時間當日結束 */
export function passValidity(examDate: string, purchasedAt: Date): { validFrom: string; validUntil: string } {
  return { validFrom: purchasedAt.toISOString(), validUntil: endOfTaipeiDay(addDays(examDate, PRICING.validDaysAfterExam)) };
}

/**
 * 是否仍可購買該梯次：梯次開放販售，且尚未過考試日（台灣時間考試日當天仍可購買）。
 * 考後購買的有效期僅剩 30 天且已無備考價值，故不販售（ADR 0003，擁有者已確認）。
 */
export function isPurchasable(s: { examDate: string; saleOpen: boolean }, now: Date): boolean {
  return s.saleOpen && taipeiDate(now) <= s.examDate;
}

export type RefundBlock = 'not_paid' | 'window_passed' | 'feature_used' | 'already_requested';

/** 退款資格：已付款、購買後 refundWindowDays×24 小時內、且尚未開始任何模擬考／全真模考／錯題重做。 */
export function refundEligibility(o: {
  status: string;
  paidAt: string | null;
  firstPaidFeatureUsedAt: string | null;
  refundRequestedAt?: string | null;
  now: Date;
}): { eligible: true } | { eligible: false; reason: RefundBlock } {
  if (o.status !== 'paid' || !o.paidAt) return { eligible: false, reason: 'not_paid' };
  if (o.refundRequestedAt) return { eligible: false, reason: 'already_requested' };
  if (o.firstPaidFeatureUsedAt) return { eligible: false, reason: 'feature_used' };
  if (o.now.getTime() - Date.parse(o.paidAt) > PRICING.refundWindowDays * DAY_MS) return { eligible: false, reason: 'window_passed' };
  return { eligible: true };
}

export const REFUND_BLOCK_TEXT: Record<RefundBlock, string> = {
  not_paid: '此訂單尚未付款或已退款',
  window_passed: '已超過購買後 7 天的退款期限',
  feature_used: '已開始過模擬考、全真模考或錯題重做，依退款規則不適用全額退款',
  already_requested: '已送出退款申請，處理中',
};

export interface PassLike { level: PassLevel; validFrom: string; validUntil: string; revokedAt: string | null }
export interface LevelEntitlement { paid: boolean; validUntil: string | null }

/** 每個級別是否持有有效通行證；validUntil 取有效通行證中最晚者。 */
export function entitlementsByLevel(passes: PassLike[], now: Date): Record<PassLevel, LevelEntitlement> {
  const t = now.getTime();
  const out = { beginner: { paid: false, validUntil: null }, intermediate: { paid: false, validUntil: null } } as Record<PassLevel, LevelEntitlement>;
  for (const p of passes) {
    if (p.revokedAt || Date.parse(p.validFrom) > t || Date.parse(p.validUntil) < t) continue;
    const e = out[p.level];
    e.paid = true;
    if (!e.validUntil || p.validUntil > e.validUntil) e.validUntil = p.validUntil;
  }
  return out;
}
