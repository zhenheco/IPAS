# 會員、付費與帳號同步

本文件說明登入、購買考期通行證、金流（經 zhenheco affiliate 金流微服務）、權益判斷、退款與帳號同步的實作。決策依據見 [ADR 0001](adr/0001-exam-pass-pricing.md)、[ADR 0002](adr/0002-d1-database.md)、[ADR 0003](adr/0003-beginner-level-pass.md)（提案中）。術語見 [GLOSSARY](../GLOSSARY.md)「會員與付費」。

**目前狀態**：程式已完成但未啟用。正式站仍以 `wrangler.jsonc` 純靜態部署，前端 `PUBLIC_PAYWALL_ENABLED` 未設定，網站行為與自用版完全相同。

## 架構

```
瀏覽器 ──► Cloudflare Worker「ipas」（wrangler.app.jsonc）
            ├─ /api/*  → worker/index.ts（Hono）；/api/checkout ──► affiliate ──► PAYUNi UPP
            │            ├─ /api/auth/*        Better Auth（Google、magic link）
            │            ├─ /api/me、/api/pricing、/api/checkout、/api/refund-request
            │            ├─ /api/usage/paid-feature、/api/sync
            │            ├─ /api/payment/affiliate/webhook   ◄── affiliate 金流微服務（PAYUNi 結果）
            │            └─ /api/admin/orders/:id/refunded
            │            └─ D1（binding DB，經 Kysely + kysely-d1）
            └─ 其他路徑 → 靜態資源（dist/，run_worker_first 只含 /api/*）
```

| 檔案 | 內容 |
|---|---|
| `src/lib/pricing.ts` | 價格設定 `PRICING`、早鳥/續購/定價計算、有效期、可購買判斷、退款資格、各級別權益（純函式，前後端共用） |
| `src/lib/entitlement.ts` | `PAYWALL_ENABLED`、免費/付費功能清單、`canUse`、`shouldShowUpgradePrompt`、`shouldShowAds`（純函式） |
| `src/lib/account.ts` | 前端呼叫 `/api/me` 等 API；離線或 404 一律視為 paywall 停用 |
| `src/components/{Paywall,AdSlot,UpgradePrompt,Account,Pricing,Login}.tsx`、`useAccount.ts` | 前端元件 |
| `src/pages/{account,pricing,login}.astro` | 新頁面 |
| `worker/app.ts` | 路由、輸入驗證（zod）、Origin 檢查 |
| `worker/orders.ts` | 建立訂單、入帳（冪等）、`/api/me`、退款申請、標記退款、付費功能使用紀錄 |
| `worker/payment/gateway-client.ts` | affiliate 的 `src/lib/sdk/payment-gateway-client.ts` **原檔**（勿修改；更新時整檔覆蓋）：`createPayment`、`parseWebhookEvent`（HMAC 驗章） |
| `worker/payment/index.ts` | 由 `PAYMENT_*` 組態建立 SDK client（缺任一項回 null → 503）、自動送出的 PAYUNi 表單 HTML |
| `src/lib/paymentReturn.ts` | `/account/?status=…` 的提示文字（純函式；不信任網址，只有網址的 `orderId` 對應到已付款訂單、且該訂單名下有未撤銷通行證才說「已開通」） |
| `worker/sync.ts` | 帳號同步的合併規則與讀寫 |
| `worker/auth.ts`、`worker/email.ts` | Better Auth 設定；寄信介面（cf-email 中繼或 console） |
| `worker/db/` | Kysely 型別與 `Store`（`atomic()` = D1 batch） |
| `migrations/*.sql` | D1 migrations（可移植 SQL） |

## 資料模型

全部定義在 `migrations/0001_init.sql`。可移植規則：id 為應用程式產生的 TEXT（UUID）、時間為 ISO-8601 UTC 字串、金額為整數新臺幣元、布林用 `BOOLEAN` + `TRUE/FALSE`、不使用 JSON1 等資料庫函式（陣列以 JSON 字串存在 TEXT 欄位，只在應用程式端解析）、多列寫入使用 `ON CONFLICT`（SQLite 3.24+ 與 Postgres 皆支援）。

- **Better Auth**：`"user"`、`"session"`、`"account"`、`"verification"`（欄位沿用 Better Auth 預設 camelCase；magic link 使用 `verification`）。
- **`exam_sittings`**（梯次）：`id`、`level`（beginner/intermediate）、`exam_date`（YYYY-MM-DD 台灣日期）、`name`、`sale_open`。新梯次請新增 migration（見下方）。
- **`orders`**：`merchant_trade_no`（站內訂單編號，唯一；即傳給 affiliate 的 `orderId`，webhook 以此對回訂單）、`user_id`、`sitting_id`、`level`、`price_type`（early/regular/renewal）、`amount_twd`、`status`（pending/paid/failed/refunded）、`payuni_trade_no`（webhook 的 `tradeNo`＝PAYUNi 交易序號；欄名沿用歷史名稱）、`consent_at`（同意「數位內容立即提供、不適用 7 天鑑賞期」的時間）、`paid_at`、`refund_requested_at`、`refund_reason`、`refunded_at`、`last_notify`（最近一次 webhook 的精簡 JSON：paymentId、status、amount、tradeNo、paymentType、paidAt、errorMessage，供對帳）、`note`。
- **`passes`**（考期通行證）：`user_id`、`sitting_id`、`level`、`valid_from`（付款時間）、`valid_until`（考試日 + 30 天的台灣時間 23:59:59.999）、`order_id`（唯一）、`first_paid_feature_used_at`／`first_paid_feature`（退款資格用）、`revoked_at`（退款後撤銷）。`(user_id, sitting_id)` 唯一。
- **`sync_sessions`**、**`sync_question_stats`**：對應 `AppState.sessions`（Session）與 `AppState.questionStats`（QuestionStat），主鍵 `(user_id, session_id)`／`(user_id, question_id)`。

金額欄位以「整數新臺幣元」儲存：TWD 實務上沒有小數，affiliate／PAYUNi 的 TWD 金額亦須為整數元；此即「金額用整數、不用浮點數」的規則套用在 TWD 上。

D1 不支援互動式交易，需要「全部成功或全部失敗」的寫入（入帳＋建立通行證、退款＋撤銷通行證、同步）一律經 `Store.atomic()`，以 D1 `batch()`（單一交易）執行；日後遷移 Postgres 時以 `db.transaction()` 實作同一介面。D1 單一查詢最多 100 個綁定參數，多列寫入以 `chunk()` 切塊。

## 定價規則（`src/lib/pricing.ts`）

| | 中級 | 初級（擁有者 2026-11-05 確認，ADR 0003） |
|---|---|---|
| 定價 | NT$590 | NT$290 |
| 早鳥價（考試日前 45 天含以上） | NT$490 | NT$249 |
| 續購價（曾有已付款且未退款的通行證，不分級別） | NT$390 | NT$199 |

- 列出所有適用的價格後**取最低**；目前續購價最低，所以續購價優先於早鳥價。
- 「前 45 天」以購買當下的台灣日曆日與考試日相差天數計算。
- 金額一律由伺服器在 `/api/checkout` 重新計算，不信任前端。
- 改價：只改 `PRICING.prices`（前端價目頁與 Worker 共用同一物件），重新建置部署即可。

## 流程

### 登入

1. `/login/`：Google（`POST /api/auth/sign-in/social`，回傳 Google 授權網址）或 Email magic link（`POST /api/auth/sign-in/magic-link`，連結 5 分鐘有效）。
2. 回呼後 Better Auth 設定 session cookie：host-only（`ipas.zhenhe-co.com`）、HTTPS 下為 `__Secure-` 前綴 + Secure、HttpOnly、SameSite=Lax。
3. 寄信：`EMAIL_PROVIDER=cf-email` 經 service binding `CF_EMAIL`（zhenheco 中央 cf-email Worker，`POST /send`，同帳號不可直接 fetch 公開網址）寄出；`console` 只印在 Worker log（開發用）。未設定時，有 `CF_EMAIL` 綁定與 `CF_EMAIL_API_KEY` 就用 cf-email。`Idempotency-Key` 由信件內容雜湊產生，同一封重送不會重寄。
4. 同一 email 用 Google 與 magic link 登入會連結為同一帳號（`accountLinking`，Google 為信任來源）。

### 購買 → 入帳 → 通行證

1. `/pricing/` 呼叫 `GET /api/pricing`，列出尚未結束的梯次與目前使用者的價格。
2. 使用者勾選同意「數位內容立即提供、不適用 7 天鑑賞期」，表單以一般 POST 送 `/api/checkout`（`sittingId`、`consent=on`）。Worker 檢查 Origin、登入、同意、梯次可購買、未持有該梯次 → 重新計價 → 建立 `pending` 訂單（記錄 `consent_at`）→ 以 SDK `createPayment` 向 affiliate 建立付款：`orderId` = 訂單的 `merchant_trade_no`、`amount`、`currency: 'TWD'`、`description`、`email`、`buyerCountry: 'TW'`、`buyerType: 'individual'`，**不帶** `periodParams`（TWD 無 `periodParams` ＝ PAYUNi UPP 一次性付款，需 affiliate 站台 `payuni_onetime_enabled`）。成功時回傳自動送出的 HTML 表單（affiliate 回的 `payuniForm`，`Version` 2.0）POST 到 PAYUNi UPP；以 JSON 呼叫則回傳 `{ orderId, amount, priceType, checkout: payuniForm }`。affiliate 失敗、未回表單或未設定 `PAYMENT_*` 時：表單回 303 `/pricing/?error=payment_unavailable`，JSON 回 503。
3. 使用者在 PAYUNi 付款頁付款（載具／統編／捐贈碼由買方在 PAYUNi 頁面選擇，電子發票由 PAYUNi 商店後台設定的服務開立）。PAYUNi 的 Notify／Return 由 affiliate 接收與驗證，**本站不接觸 PAYUNi 的 HashKey／IV 或回呼**。
4. **webhook**（`POST /api/payment/affiliate/webhook`，affiliate → 本站，已登記於 affiliate）：以原始 body 與 `X-Webhook-Signature`（HMAC-SHA256 hex，secret = `PAYMENT_WEBHOOK_SECRET`）經 SDK `parseWebhookEvent` 驗章，簽章缺少／錯誤／body 被改一律回 401（未設定 `PAYMENT_*` 回 503）；此路徑不檢查 Origin（伺服器對伺服器），簽章是唯一的閘門。通過後：
   - `type` 有值（RECURRING／REFUND／訂閱類）、`currency` 不是 TWD、或 `status` 不是 `SUCCESS`／`FAILED`：忽略（200）。
   - 依 `orderId` 找訂單（找不到回 400）→ `amount` 必須等於訂單金額（不符回 400；非 2xx 時 affiliate 會重送）。
   - `SUCCESS`：在同一個 batch 中「訂單 pending/failed → paid」並建立通行證；建立通行證的 SQL 以「訂單已由本次通知標記為 paid」為條件，重送或並行的 webhook 不會重複建立。已退款的訂單收到 `SUCCESS` 不開通、回 200（重送也不會成功，避免無限重試）。
   - 退款後重買同一梯次（結帳允許，因為已撤銷的通行證不算持有）：`UNIQUE(user_id, sitting_id)` 被舊的已撤銷通行證佔住，所以同一個 batch 內把那一列的 `order_id` 改指向新訂單、重新啟用（`revoked_at` 清空、有效期重算、首次使用付費功能的紀錄清空，新訂單的退款資格重新計算）。舊訂單仍是 `refunded` 且保留 `refunded_at`，退款歷史在 `orders`。`/account/` 的「已開通」提示要求該訂單名下有未撤銷的通行證。
   - `FAILED`：pending → failed（之後同一訂單若 `SUCCESS` 仍可入帳；已 paid 不會被降級）。
   - ATM／超商取號未付款時 affiliate **不會**送 webhook，訂單維持 pending。
   - 同一使用者同一梯次已有通行證（兩筆訂單都付款）：訂單標記 `note = duplicate_pass`，需人工退款。
5. **瀏覽器返回**：affiliate 會 303 導回站台的 `callbackUrl`（`https://ipas.zhenhe-co.com/account/`，於 affiliate 設定），query 帶 `paymentId`、`orderId`、`status=success|failed|pending`。`/account/` 只顯示提示，**權益只來自 webhook**：`success` 時，須該 `orderId` 的訂單已付款且名下有未撤銷通行證才顯示「已開通」（持有其他梯次的通行證不算），否則顯示「確認中，請稍後重新整理」（`src/lib/paymentReturn.ts`）。
6. 統一發票：由 PAYUNi 商店後台設定自動開立（振禾有限公司，統編 83446730），本系統不另外處理。

### 權益判斷（前端）

- `GET /api/me` → `{ user, passes, entitlements: { beginner|intermediate: { paid, validUntil } }, orders }`。
- `PAYWALL_ENABLED` 為 false、或 `/api/me` 離線／404／非 JSON 時，`AccountState = disabled`：所有功能開放、不顯示廣告（與目前完全相同）。
- 免費：練習、作答歷史。付費（需該級別的有效通行證）：單科模考、全真模考、錯題本、錯題重做、弱點分析、讀書計畫、無廣告。
- 廣告：`AdSlot` 只在 paywall 啟用、`PUBLIC_ADSENSE_CLIENT` 已設定、帳號狀態已載入且使用者沒有該頁面所屬級別的有效通行證時顯示（中級通行證不隱藏初級頁面的廣告）。
- 升級提醒：成績頁對免費會員每個台灣日曆日至多顯示一次（`shouldShowUpgradePrompt`，上次顯示時間存在 localStorage）。

### 退款

1. 資格（`refundEligibility`）：訂單已付款、付款後 7×24 小時內、該通行證 `first_paid_feature_used_at` 為空、尚未申請過。
2. 只有「開始」單科模考／全真模考／錯題重做的作答時，前端才呼叫 `reportPaidFeatureUse(level, feature)`（`beginSession`）→ `POST /api/usage/paid-feature`，記錄該級別有效通行證的首次使用時間（只記第一次）。開啟錯題本、弱點分析、讀書計畫（`<Paywall>` 顯示內容）不回報；Worker 的 `PAID_USE_FEATURES` 僅接受 `exam`／`full`／`redo`，其餘功能名稱回 400，前端無法藉此結束退款資格；「無廣告」不算使用。
3. 使用者在 `/account/` 按「申請退款」→ `POST /api/refund-request`，訂單記錄 `refund_requested_at`、`refund_reason`。
4. **退款目前全程手動**（affiliate 尚無 PAYUNi 退款 API；其 `refundPayment` 只在 affiliate 內標記 `REFUNDED`，不會向 PAYUNi 退款，也**不會**送退款 webhook 給本站）：擁有者須 (a) 在 PAYUNi 商店後台手動退款（信用卡一次付清：收款後 180 天內），(b) 手動作廢／折讓 PAYUNi 開立的電子發票，(c) 再以 `ADMIN_EMAILS` 中的帳號（email 需已驗證）呼叫 `ADMIN_EMAILS` 中的帳號（email 需已驗證）`POST /api/admin/orders/:id/refunded`（同一 batch：訂單 → refunded、通行證 → revoked；此路由保留，是本站撤銷權益的唯一方式）。例如在已登入的 `/account/` 頁面於瀏覽器 console 執行：
   ```js
   fetch('/api/admin/orders/<訂單 id>/refunded', { method: 'POST' }).then((r) => r.json())
   ```
   待處理的申請可在 D1 查詢：`npx wrangler d1 execute ipas --remote -c wrangler.app.jsonc --command "SELECT id, merchant_trade_no, amount_twd, refund_requested_at, refund_reason FROM orders WHERE refund_requested_at IS NOT NULL AND status = 'paid'"`

### 帳號同步

- `GET /api/sync` 回傳帳號中的 `{ schemaVersion: 1, sessions, questionStats }`。
- `PUT /api/sync` 上傳本機的 `{ schemaVersion: 1, sessions, questionStats }`（與 `exportJson` 的格式相同），驗證規則與 `src/lib/storage.ts` 匯入相同（任一筆無效即整批拒絕），合併後回傳結果，前端再寫回 localStorage（`/account/` 的「立即同步」）。
- 合併規則（`worker/sync.ts`）：
  - sessions 依 id 聯集；同 id 保留伺服器版本（已交卷的作答不會變動）；依 `submittedAt`、`id` 排序。
  - questionStats 同一題「整筆擇一」：attempts 較多者 → lastWrongAt 較晚者 → 伺服器版本。不逐欄相加，避免重複計算並維持 `attempts = correct + wrong`、錯題本狀態一致。代價：同一題在兩台裝置「同步之前」各自作答時，次數較少那邊的增量會遺失；建議每台裝置開始作答前先同步。
  - 合併結果再合併一次不會改變（冪等）；只寫入新增或變動的列。
- 進行中的作答（`active`、`fullExam`）不同步，仍只在該裝置。

## 環境變數與秘密

`vars`（`wrangler.app.jsonc`）：`BETTER_AUTH_URL`（網站網址）、`PAYMENT_API_BASE`（`https://affiliate.1wayseo.com`；sandbox 為 `https://sandbox.affiliate.1wayseo.com`）、`PAYMENT_SITE_CODE`（`IPAS`）、`EMAIL_PROVIDER`、`EMAIL_FROM`。

秘密（`npx wrangler secret put <NAME> -c wrangler.app.jsonc`，本機放 `.dev.vars`，範本 `.dev.vars.example`）：`BETTER_AUTH_SECRET`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`PAYMENT_API_KEY`、`PAYMENT_WEBHOOK_SECRET`、`CF_EMAIL_API_KEY`、`ADMIN_EMAILS`（擁有者 Email，逗號分隔；倉庫為公開，不可寫進 `vars`，且同名 var 與 secret 會衝突）。

前端建置時變數（Astro `PUBLIC_*`）：`PUBLIC_PAYWALL_ENABLED=1` 啟用付費機制；`PUBLIC_ADSENSE_CLIENT=ca-pub-…` 啟用廣告。

未設定 `PAYMENT_*` 時 `/api/checkout` 與 webhook 回 503，其餘 API 正常。

`PAYMENT_API_KEY`、`PAYMENT_WEBHOOK_SECRET` 存在 1Password 項目 `zhenheco-payment-IPAS-prod`（vault `Dev`，欄位同名）。設定 Worker 秘密（以管線傳值，不經 echo、不落地、不進 shell history）：

```sh
op read "op://Dev/zhenheco-payment-IPAS-prod/PAYMENT_API_KEY" | tr -d '\n' | npx wrangler secret put PAYMENT_API_KEY -c wrangler.app.jsonc
op read "op://Dev/zhenheco-payment-IPAS-prod/PAYMENT_WEBHOOK_SECRET" | tr -d '\n' | npx wrangler secret put PAYMENT_WEBHOOK_SECRET -c wrangler.app.jsonc
```

本站不再持有 `PAYUNI_*`；若 Worker 上殘留舊的 `PAYUNI_MER_ID`／`PAYUNI_HASH_KEY`／`PAYUNI_HASH_IV` 秘密，上線後以 `npx wrangler secret delete <NAME> -c wrangler.app.jsonc` 刪除。

## 開發與測試

```sh
npm test                          # 全部單元測試（含 worker/**/*.test.ts）
npx tsc --noEmit -p worker        # Worker 型別檢查
npx astro build
npx wrangler d1 migrations apply ipas --local -c wrangler.app.jsonc
npx wrangler dev -c wrangler.app.jsonc   # 需要 .dev.vars
```

Worker 測試以 `node:sqlite` 記憶體資料庫模擬 D1（`worker/test/fake-d1.ts`），套用真正的 migrations，走與正式環境相同的 kysely-d1 與 batch 路徑，並以 magic link 實際登入 Better Auth。

本機 `wrangler dev` 注意：實測（wrangler 4.157）時 `.dev.vars` 的 `BETTER_AUTH_URL=http://localhost:8787` 未生效，請求的 Origin 檢查以 `wrangler.app.jsonc` 中的 `https://ipas.zhenhe-co.com` 為準；本機以 curl 測試時請送 `Origin: https://ipas.zhenhe-co.com`，或暫時修改 vars。Magic link 連結會指向正式網域，手動換成 `http://localhost:8787` 即可。

## 新增梯次

新增一個 migration，例如 `migrations/0003_sitting_2027_05.sql`：

```sql
INSERT INTO exam_sittings (id, level, exam_date, name, sale_open, created_at)
VALUES ('intermediate-2027-05-22', 'intermediate', '2027-05-22', '2027 年 5 月中級', TRUE, '2026-11-04T00:00:00.000Z');
```

然後 `npx wrangler d1 migrations apply ipas --remote -c wrangler.app.jsonc`。停止販售：`UPDATE exam_sittings SET sale_open = FALSE WHERE id = …`。初級 2026-11-07 已由 `migrations/0003_sitting_2026_11_beginner.sql` 建立（115 年度初級梯次 3/21、5/16、8/15、11/7；後續梯次比照新增）。

## 上線檢查清單

1. **D1**：`npx wrangler d1 create ipas`，把 `database_id` 填入 `wrangler.app.jsonc`；`npx wrangler d1 migrations apply ipas --remote -c wrangler.app.jsonc`。確認 `exam_sittings` 有要販售的梯次。
2. **Better Auth**：`openssl rand -base64 32` 產生 `BETTER_AUTH_SECRET` 並設定。
3. **Google OAuth**：Google Cloud Console 建立 OAuth 用戶端（網頁應用程式），授權的重新導向 URI：`https://ipas.zhenhe-co.com/api/auth/callback/google`，JavaScript 來源：`https://ipas.zhenhe-co.com`；設定 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`。OAuth 同意畫面需發布（否則只有測試使用者能登入）。
4. **Email**：走 cf-email 中繼，`zhenhe-co.com` 已是中繼的已驗證寄件網域，`EMAIL_FROM` 用純位址 `no-reply@zhenhe-co.com`。用 cf-mail repo 的 create-api-key script 建立 key，存進 1Password `op://Dev/CF_EMAIL_API_KEY_IPAS/credential`，再設定秘密：`op read op://Dev/CF_EMAIL_API_KEY_IPAS/credential | tr -d '\n' | npx wrangler secret put CF_EMAIL_API_KEY -c wrangler.app.jsonc`（等同 `printf "%s" "$KEY" | wrangler secret put ...`）。`wrangler.app.jsonc` 已含 `services` 綁定 `CF_EMAIL` → `cf-email`。部署後用 magic link 寄一封，再查投遞：每次寄出 Worker 會印一行 `[email:cf-email] id=<id> status=<status>`（`npx wrangler tail -c wrangler.app.jsonc` 查看）；用該 id 呼叫 cf-email 的 `GET /status/:id`。`/status` 需要另一把 scope 為 `status:read` 的 cf-email key（不是寄信用的 `CF_EMAIL_API_KEY`），不要把它設進這個 Worker。
5. **affiliate 金流（sandbox）**：
   - 確認 affiliate 已為站台 `IPAS` 啟用 `payuni_onetime_enabled`、`callbackUrl` 設為 `https://ipas.zhenhe-co.com/account/`、webhook 網址為 `https://ipas.zhenhe-co.com/api/payment/affiliate/webhook`、`PAYMENT_WEBHOOK_SECRET` 與 1Password 一致。
   - 設定 `PAYMENT_API_KEY`、`PAYMENT_WEBHOOK_SECRET` 秘密（見上）。本機或 sandbox 驗證時，把 `PAYMENT_API_BASE` 暫時改為 `https://sandbox.affiliate.1wayseo.com`（`.dev.vars` 覆寫）。
   - 實際走一次：購買 → 導向 PAYUNi 付款 → 付款成功 → 確認 Worker log 無 `[payment]` 錯誤、訂單 paid、通行證建立、`/account/` 顯示付費會員。
   - 測試付款失敗（訂單 failed）、重送 webhook（不重複建立通行證）、瀏覽器返回頁在 webhook 尚未到達時顯示「確認中」。
   - 確認 PAYUNi 後台已啟用自動開立統一發票（振禾有限公司，統編 83446730）。
6. **切換部署**：`npm run deploy:app`（即 `PUBLIC_PAYWALL_ENABLED=1 astro build`、`npm run check:dist`、`wrangler deploy -c wrangler.app.jsonc`；Worker 名稱同為 `ipas`，路由相同，會取代純靜態版本；回退時改用 `npm run deploy`（`wrangler.jsonc`，未設旗標的建置）即可）。
7. **正式收款**：`PAYMENT_API_BASE` 指向 production affiliate（`https://affiliate.1wayseo.com`），以小額實際購買並退款一次（退款與發票作廢皆為手動，見「退款」）。
8. 設定 `ADMIN_EMAILS` 秘密（`printf "%s" "<擁有者管理員 Email>" | npx wrangler secret put ADMIN_EMAILS -c wrangler.app.jsonc`），確認退款標記流程。
9. 退款、鑑賞期同意與付費功能說明已寫入服務條款／退款政策頁（`src/pages/terms.astro`、`src/pages/refund.astro`），資料蒐集、cookie 與 AdSense 揭露在隱私權政策頁（`src/pages/privacy.astro`）；調整退款規則或價格時需同步檢查這些頁面與結帳勾選文字（`src/components/Pricing.tsx`）。

## 已移除的 PAYUNi 直連

本站原本直接串接 PAYUNi UPP（`worker/payuni.ts`、`/api/payuni/notify`、`/api/payuni/return`、`PAYUNI_*` 設定）。依擁有者規則「網站不直接呼叫 PAYUNi、不持有 PAYUNi HashKey／IV，商家回呼歸 affiliate」，這些已全數移除，改由 affiliate 擁有 PAYUNi 端（UPP 表單、加解密、Notify／Return 驗證、Version 2.0、發票設定）。當時對 PAYUNi 官方文件的逐項核對留在 [docs/research/payuni-upp-verification.md](research/payuni-upp-verification.md)（歷史紀錄，與本站程式已無關）。

目前仍需注意：

- affiliate 的付款成功／失敗 webhook 才是入帳依據；取號未付款（ATM／超商）不會送 webhook。
- 退款沒有 API，也沒有退款 webhook（見「退款」）。
- 本站只驗證 affiliate 的 HMAC 簽章，不再驗證 PAYUNi 的 MerID。webhook 載荷中本站實際使用的欄位：`orderId`、`status`、`amount`、`tradeNo`、`paymentId`、`paymentType`、`paidAt`、`errorMessage`、`type`、`currency`（依 affiliate README「PAYUNi 一次性付款 webhook」）。

## 其他推論（非 PAYUNi）

- 「7 天內」以付款時間起算 7×24 小時。
- 有效期「考試日後 30 天止」解讀為考試日 + 30 天的台灣時間當日結束。
- 已退款的訂單不算「曾購買」，不適用續購價。
