-- iPAS 會員與付費資料表。
-- 可移植 SQL（ADR 0002）：只用 SQLite 與 Postgres 皆可執行的語法。
--   * id 一律為應用程式產生的 TEXT（UUID），不使用 AUTOINCREMENT / SERIAL
--   * 時間一律為 ISO-8601 UTC 字串（TEXT），例如 2026-11-04T08:00:00.000Z；考試日為 YYYY-MM-DD
--   * 金額為整數（新臺幣元），不使用浮點數
--   * 布林用 BOOLEAN + TRUE/FALSE（SQLite 以 0/1 儲存）
--   * 不使用 JSON1 等資料庫函式；需要存陣列時以 TEXT 保存 JSON 字串，只在應用程式端解析
--   * "user" 為 Postgres 保留字，一律加雙引號；Better Auth 欄位沿用其預設 camelCase，也加雙引號

-- ── Better Auth（核心表 + magic link 使用 verification）────────────────────────
CREATE TABLE "user" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
  "image" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE TABLE "session" (
  "id" TEXT PRIMARY KEY,
  "expiresAt" TEXT NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX "session_userId_idx" ON "session" ("userId");

CREATE TABLE "account" (
  "id" TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TEXT,
  "refreshTokenExpiresAt" TEXT,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE INDEX "account_userId_idx" ON "account" ("userId");

CREATE TABLE "verification" (
  "id" TEXT PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");

-- ── 梯次 ──────────────────────────────────────────────────────────────────────
CREATE TABLE exam_sittings (
  id TEXT PRIMARY KEY,                 -- 例：intermediate-2026-11-14
  level TEXT NOT NULL CHECK (level IN ('beginner', 'intermediate')),
  exam_date TEXT NOT NULL,             -- YYYY-MM-DD（台灣日期）
  name TEXT NOT NULL,                  -- 顯示名稱，例：2026 年第二梯次中級
  sale_open BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TEXT NOT NULL,
  UNIQUE (level, exam_date)
);

-- ── 訂單 ──────────────────────────────────────────────────────────────────────
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  merchant_trade_no TEXT NOT NULL UNIQUE,    -- 送給 PAYUNi 的 MerTradeNo
  user_id TEXT NOT NULL REFERENCES "user" ("id"),
  sitting_id TEXT NOT NULL REFERENCES exam_sittings (id),
  level TEXT NOT NULL CHECK (level IN ('beginner', 'intermediate')),
  price_type TEXT NOT NULL CHECK (price_type IN ('early', 'regular', 'renewal')),
  amount_twd INTEGER NOT NULL CHECK (amount_twd > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  payuni_trade_no TEXT,                      -- PAYUNi 回傳的 TradeNo
  consent_at TEXT NOT NULL,                  -- 同意「數位內容立即提供、不適用 7 天鑑賞期」的時間
  paid_at TEXT,
  refund_requested_at TEXT,
  refund_reason TEXT,
  refunded_at TEXT,
  last_notify TEXT,                          -- 最近一次 PAYUNi 回傳（解密後 query string），供對帳
  note TEXT,                                 -- 例：duplicate_pass（重複付款，需人工退款）
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX orders_user_id_idx ON orders (user_id);

-- ── 考期通行證 ────────────────────────────────────────────────────────────────
CREATE TABLE passes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" ("id"),
  sitting_id TEXT NOT NULL REFERENCES exam_sittings (id),
  level TEXT NOT NULL CHECK (level IN ('beginner', 'intermediate')),
  valid_from TEXT NOT NULL,
  valid_until TEXT NOT NULL,                 -- 考試日 + 30 天，台灣時間當日結束
  order_id TEXT NOT NULL UNIQUE REFERENCES orders (id),
  first_paid_feature_used_at TEXT,           -- 首次使用付費功能；有值即不可退款
  first_paid_feature TEXT,
  revoked_at TEXT,                           -- 退款後撤銷
  created_at TEXT NOT NULL,
  UNIQUE (user_id, sitting_id)
);
CREATE INDEX passes_user_id_idx ON passes (user_id);

-- ── 帳號同步（對應 localStorage AppState 的 Session 與 QuestionStat）───────────
CREATE TABLE sync_sessions (
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  subject INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  question_ids TEXT NOT NULL,                -- JSON 陣列字串
  answers TEXT NOT NULL,                     -- JSON 陣列字串（0-3 或 null）
  score INTEGER NOT NULL,
  full_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, session_id)
);

CREATE TABLE sync_question_stats (
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  wrong INTEGER NOT NULL,
  last_wrong_at TEXT,
  redo_streak INTEGER NOT NULL,
  in_wrong_book BOOLEAN NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, question_id)
);
