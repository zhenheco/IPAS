/** Kysely 型別，對應 migrations/*.sql。布林欄位在 SQLite 讀回為 0/1，在 Postgres 為 true/false，一律以 Boolean() 正規化。 */
import type { PassLevel, PriceType } from '../../src/lib/pricing';

type Bool = boolean | number;

export type OrderStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export interface UserTable {
  id: string;
  name: string;
  email: string;
  emailVerified: Bool;
  image: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExamSittingTable {
  id: string;
  level: PassLevel;
  exam_date: string;
  name: string;
  sale_open: Bool;
  created_at: string;
}

export interface OrderTable {
  id: string;
  merchant_trade_no: string;
  user_id: string;
  sitting_id: string;
  level: PassLevel;
  price_type: PriceType;
  amount_twd: number;
  status: OrderStatus;
  payuni_trade_no: string | null;
  consent_at: string;
  paid_at: string | null;
  refund_requested_at: string | null;
  refund_reason: string | null;
  refunded_at: string | null;
  last_notify: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface PassTable {
  id: string;
  user_id: string;
  sitting_id: string;
  level: PassLevel;
  valid_from: string;
  valid_until: string;
  order_id: string;
  first_paid_feature_used_at: string | null;
  first_paid_feature: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface SyncSessionTable {
  user_id: string;
  session_id: string;
  mode: string;
  subject: number;
  started_at: string;
  submitted_at: string;
  question_ids: string;
  answers: string;
  score: number;
  full_id: string | null;
  created_at: string;
}

export interface SyncQuestionStatTable {
  user_id: string;
  question_id: string;
  attempts: number;
  correct: number;
  wrong: number;
  last_wrong_at: string | null;
  redo_streak: number;
  in_wrong_book: Bool;
  updated_at: string;
}

export interface Database {
  user: UserTable;
  exam_sittings: ExamSittingTable;
  orders: OrderTable;
  passes: PassTable;
  sync_sessions: SyncSessionTable;
  sync_question_stats: SyncQuestionStatTable;
}
