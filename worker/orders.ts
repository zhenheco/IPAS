/**
 * 訂單、考期通行證與權益（Worker 端業務邏輯）。價格與退款規則本身在 src/lib/pricing.ts（純函式）。
 */
import { sql } from 'kysely';
import {
  PASS_LEVEL_NAME, entitlementsByLevel, isPurchasable, passValidity, quotePrice, refundEligibility,
  type LevelEntitlement, type PassLevel, type PriceQuote, type PriceType, type RefundBlock,
} from '../src/lib/pricing';
import { bool, type Store } from './db';
import type { OrderStatus } from './db/schema';
import { newMerTradeNo, paymentOutcome, type PayuniResult } from './payuni';

const uuid = () => crypto.randomUUID();

/** 使用者是否曾有一筆已付款（未退款）的通行證 → 適用續購價 */
async function hasPriorPaidPass(store: Store, userId: string): Promise<boolean> {
  const r = await store.db.selectFrom('orders').select('id').where('user_id', '=', userId).where('status', '=', 'paid').limit(1).executeTakeFirst();
  return !!r;
}

export interface SittingOffer {
  id: string;
  level: PassLevel;
  name: string;
  examDate: string;
  purchasable: boolean;
  /** 已持有此梯次通行證 */
  owned: boolean;
  quote: PriceQuote;
  validUntil: string;
}

/** 價目：每個尚未結束的梯次，以目前使用者（未登入則不含續購價）計價 */
export async function listOffers(store: Store, userId: string | null, now: Date): Promise<SittingOffer[]> {
  const sittings = await store.db.selectFrom('exam_sittings').selectAll().orderBy('exam_date').orderBy('level').execute();
  const prior = userId ? await hasPriorPaidPass(store, userId) : false;
  const owned = userId
    ? new Set((await store.db.selectFrom('passes').select('sitting_id').where('user_id', '=', userId).where('revoked_at', 'is', null).execute()).map((r) => r.sitting_id))
    : new Set<string>();
  return sittings
    .filter((s) => isPurchasable({ examDate: s.exam_date, saleOpen: bool(s.sale_open) }, now) || owned.has(s.id))
    .map((s) => ({
      id: s.id, level: s.level, name: s.name, examDate: s.exam_date,
      purchasable: isPurchasable({ examDate: s.exam_date, saleOpen: bool(s.sale_open) }, now) && !owned.has(s.id),
      owned: owned.has(s.id),
      quote: quotePrice({ level: s.level, examDate: s.exam_date, now, hasPriorPaidPass: prior }),
      validUntil: passValidity(s.exam_date, now).validUntil,
    }));
}

export type CheckoutError = 'sitting_not_found' | 'not_purchasable' | 'already_owned';

export interface NewOrder {
  id: string;
  merchantTradeNo: string;
  amount: number;
  priceType: PriceType;
  level: PassLevel;
  prodDesc: string;
}

/** 建立待付款訂單。金額一律在伺服器端重新計價。 */
export async function createOrder(store: Store, o: { userId: string; sittingId: string; now: Date }): Promise<{ ok: true; order: NewOrder } | { ok: false; error: CheckoutError }> {
  const s = await store.db.selectFrom('exam_sittings').selectAll().where('id', '=', o.sittingId).executeTakeFirst();
  if (!s) return { ok: false, error: 'sitting_not_found' };
  if (!isPurchasable({ examDate: s.exam_date, saleOpen: bool(s.sale_open) }, o.now)) return { ok: false, error: 'not_purchasable' };
  const owned = await store.db.selectFrom('passes').select('id').where('user_id', '=', o.userId).where('sitting_id', '=', s.id).where('revoked_at', 'is', null).executeTakeFirst();
  if (owned) return { ok: false, error: 'already_owned' };
  const quote = quotePrice({ level: s.level, examDate: s.exam_date, now: o.now, hasPriorPaidPass: await hasPriorPaidPass(store, o.userId) });
  const ts = o.now.toISOString();
  const order: NewOrder = {
    id: uuid(), merchantTradeNo: newMerTradeNo(o.now), amount: quote.amount, priceType: quote.priceType, level: s.level,
    prodDesc: `iPAS AI 應用規劃師${PASS_LEVEL_NAME[s.level]}考期通行證（${s.exam_date} 梯次）`,
  };
  await store.db.insertInto('orders').values({
    id: order.id, merchant_trade_no: order.merchantTradeNo, user_id: o.userId, sitting_id: s.id, level: s.level,
    price_type: quote.priceType, amount_twd: quote.amount, status: 'pending', payuni_trade_no: null,
    // 使用者在結帳前勾選同意「數位內容立即提供、不適用 7 天鑑賞期」；呼叫端已驗證 consent === true
    consent_at: ts, paid_at: null, refund_requested_at: null, refund_reason: null, refunded_at: null, last_notify: null, note: null,
    created_at: ts, updated_at: ts,
  }).execute();
  return { ok: true, order };
}

export type FulfilResult =
  | { ok: true; outcome: 'paid'; orderId: string; alreadyPaid: boolean; passCreated: boolean }
  | { ok: true; outcome: 'failed' | 'pending'; orderId: string }
  | { ok: false; error: 'order_not_found' | 'amount_mismatch' | 'order_refunded' };

/**
 * 處理已驗證、解密的 PAYUNi 回傳（NotifyURL 與 ReturnURL 共用）。
 * 冪等：重複通知不會重複建立通行證；「訂單改為已付款」與「建立通行證」在同一個 batch（交易）中完成，
 * 且建立通行證以「該訂單已由本次通知標記為 paid」為條件，避免已退款/失敗的訂單被補發通行證。
 */
export async function fulfilPayment(store: Store, r: PayuniResult, now: Date): Promise<FulfilResult> {
  const order = await store.db.selectFrom('orders').selectAll().where('merchant_trade_no', '=', r.merTradeNo).executeTakeFirst();
  if (!order) return { ok: false, error: 'order_not_found' };
  if (r.tradeAmt !== order.amount_twd) return { ok: false, error: 'amount_mismatch' };
  const outcome = paymentOutcome(r);
  const ts = now.toISOString();

  if (outcome !== 'paid') {
    await store.db.updateTable('orders').set({ status: outcome === 'failed' ? 'failed' : order.status, last_notify: r.raw, updated_at: ts })
      .where('id', '=', order.id).where('status', 'in', ['pending', 'failed']).execute();
    return { ok: true, outcome, orderId: order.id };
  }
  if (order.status === 'refunded') return { ok: false, error: 'order_refunded' };
  if (order.status === 'paid') return { ok: true, outcome: 'paid', orderId: order.id, alreadyPaid: true, passCreated: false };

  const sitting = await store.db.selectFrom('exam_sittings').select(['exam_date']).where('id', '=', order.sitting_id).executeTakeFirstOrThrow();
  const v = passValidity(sitting.exam_date, now);
  const tradeNo = r.tradeNo || r.merTradeNo;
  const passId = uuid();
  const db = store.db;
  const [upd, ins] = await store.atomic([
    db.updateTable('orders').set({ status: 'paid', paid_at: ts, payuni_trade_no: tradeNo, last_notify: r.raw, updated_at: ts })
      .where('id', '=', order.id).where('status', 'in', ['pending', 'failed']),
    db.insertInto('passes')
      .columns(['id', 'user_id', 'sitting_id', 'level', 'valid_from', 'valid_until', 'order_id', 'created_at'])
      .expression(db.selectNoFrom([
        sql<string>`${passId}`.as('id'), sql<string>`${order.user_id}`.as('user_id'), sql<string>`${order.sitting_id}`.as('sitting_id'),
        sql<string>`${order.level}`.as('level'), sql<string>`${v.validFrom}`.as('valid_from'), sql<string>`${v.validUntil}`.as('valid_until'),
        sql<string>`${order.id}`.as('order_id'), sql<string>`${ts}`.as('created_at'),
      ]).where((eb) => eb.exists(eb.selectFrom('orders').select('id')
        .where('id', '=', order.id).where('status', '=', 'paid').where('paid_at', '=', ts).where('payuni_trade_no', '=', tradeNo))))
      .onConflict((oc) => oc.doNothing()),
  ]);
  if (upd.changes === 0) return { ok: true, outcome: 'paid', orderId: order.id, alreadyPaid: true, passCreated: false };
  if (ins.changes === 0) {
    // 同一使用者同一梯次已有通行證（兩筆訂單都付款）：保留付款紀錄並標記，需人工退款
    await db.updateTable('orders').set({ note: 'duplicate_pass', updated_at: ts }).where('id', '=', order.id).execute();
    console.error(`[payuni] order ${order.id} paid but user already holds a pass for ${order.sitting_id}; manual refund needed`);
  }
  return { ok: true, outcome: 'paid', orderId: order.id, alreadyPaid: false, passCreated: ins.changes > 0 };
}

export interface MeOrder {
  id: string;
  merchantTradeNo: string;
  sittingId: string;
  level: PassLevel;
  priceType: PriceType;
  amount: number;
  status: OrderStatus;
  createdAt: string;
  paidAt: string | null;
  refundRequestedAt: string | null;
  refund: { eligible: true } | { eligible: false; reason: RefundBlock };
}

export interface MePass {
  id: string;
  sittingId: string;
  level: PassLevel;
  examDate: string;
  validFrom: string;
  validUntil: string;
  firstPaidFeatureUsedAt: string | null;
  revokedAt: string | null;
}

export interface Me {
  user: { id: string; email: string; name: string; image: string | null };
  passes: MePass[];
  entitlements: Record<PassLevel, LevelEntitlement>;
  orders: MeOrder[];
}

export async function getMe(store: Store, user: Me['user'], now: Date): Promise<Me> {
  const passRows = await store.db.selectFrom('passes').innerJoin('exam_sittings', 'exam_sittings.id', 'passes.sitting_id')
    .select(['passes.id', 'passes.sitting_id', 'passes.level', 'exam_sittings.exam_date', 'passes.valid_from', 'passes.valid_until',
      'passes.first_paid_feature_used_at', 'passes.revoked_at', 'passes.order_id'])
    .where('passes.user_id', '=', user.id).orderBy('passes.valid_until', 'desc').execute();
  const orderRows = await store.db.selectFrom('orders').selectAll().where('user_id', '=', user.id).where('status', '!=', 'pending')
    .orderBy('created_at', 'desc').execute();
  const passes: MePass[] = passRows.map((p) => ({
    id: p.id, sittingId: p.sitting_id, level: p.level, examDate: p.exam_date, validFrom: p.valid_from, validUntil: p.valid_until,
    firstPaidFeatureUsedAt: p.first_paid_feature_used_at, revokedAt: p.revoked_at,
  }));
  const usedByOrder = new Map(passRows.map((p) => [p.order_id, p.first_paid_feature_used_at]));
  const orders: MeOrder[] = orderRows.map((o) => ({
    id: o.id, merchantTradeNo: o.merchant_trade_no, sittingId: o.sitting_id, level: o.level, priceType: o.price_type, amount: Number(o.amount_twd),
    status: o.status, createdAt: o.created_at, paidAt: o.paid_at, refundRequestedAt: o.refund_requested_at,
    refund: refundEligibility({ status: o.status, paidAt: o.paid_at, firstPaidFeatureUsedAt: usedByOrder.get(o.id) ?? null, refundRequestedAt: o.refund_requested_at, now }),
  }));
  return { user, passes, entitlements: entitlementsByLevel(passes, now), orders };
}

/** 申請退款：只記錄申請，實際退款由擁有者在 PAYUNi 後台執行後以管理 API 標記 refunded。 */
export async function requestRefund(store: Store, o: { userId: string; orderId: string; reason: string | null; now: Date }):
  Promise<{ ok: true } | { ok: false; error: 'order_not_found' | RefundBlock }> {
  const order = await store.db.selectFrom('orders').selectAll().where('id', '=', o.orderId).where('user_id', '=', o.userId).executeTakeFirst();
  if (!order) return { ok: false, error: 'order_not_found' };
  const pass = await store.db.selectFrom('passes').select('first_paid_feature_used_at').where('order_id', '=', order.id).executeTakeFirst();
  const e = refundEligibility({ status: order.status, paidAt: order.paid_at, firstPaidFeatureUsedAt: pass?.first_paid_feature_used_at ?? null, refundRequestedAt: order.refund_requested_at, now: o.now });
  if (!e.eligible) return { ok: false, error: e.reason };
  const ts = o.now.toISOString();
  const r = await store.db.updateTable('orders').set({ refund_requested_at: ts, refund_reason: o.reason, updated_at: ts })
    .where('id', '=', order.id).where('refund_requested_at', 'is', null).executeTakeFirst();
  if (Number(r.numUpdatedRows ?? 0) === 0) return { ok: false, error: 'already_requested' };
  return { ok: true };
}

/** 管理者在 PAYUNi 完成退款後呼叫：訂單改為 refunded 並撤銷通行證（同一 batch）。 */
export async function markRefunded(store: Store, o: { orderId: string; now: Date }): Promise<{ ok: boolean }> {
  const ts = o.now.toISOString();
  const [upd] = await store.atomic([
    store.db.updateTable('orders').set({ status: 'refunded', refunded_at: ts, updated_at: ts }).where('id', '=', o.orderId).where('status', '=', 'paid'),
    store.db.updateTable('passes').set({ revoked_at: ts }).where('order_id', '=', o.orderId).where('revoked_at', 'is', null),
  ]);
  return { ok: upd.changes > 0 };
}

/**
 * 記錄首次使用付費功能（使退款資格失效）。只更新該級別目前有效、尚未記錄過的通行證。
 * 回傳是否有通行證因此被記錄。
 */
export async function recordPaidFeatureUse(store: Store, o: { userId: string; level: PassLevel; feature: string; now: Date }): Promise<{ recorded: number }> {
  const ts = o.now.toISOString();
  const r = await store.db.updateTable('passes').set({ first_paid_feature_used_at: ts, first_paid_feature: o.feature })
    .where('user_id', '=', o.userId).where('level', '=', o.level).where('revoked_at', 'is', null)
    .where('first_paid_feature_used_at', 'is', null).where('valid_from', '<=', ts).where('valid_until', '>=', ts)
    .executeTakeFirst();
  return { recorded: Number(r.numUpdatedRows ?? 0) };
}
