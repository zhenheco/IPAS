# 會員、付費與帳號同步

本文件說明登入、購買考期通行證、PAYUNi 金流、權益判斷、退款與帳號同步的實作。決策依據見 [ADR 0001](adr/0001-exam-pass-pricing.md)、[ADR 0002](adr/0002-d1-database.md)、[ADR 0003](adr/0003-beginner-level-pass.md)（提案中）。術語見 [GLOSSARY](../GLOSSARY.md)「會員與付費」。

**目前狀態**：程式已完成但未啟用。正式站仍以 `wrangler.jsonc` 純靜態部署，前端 `PUBLIC_PAYWALL_ENABLED` 未設定，網站行為與自用版完全相同。

## 架構

```
瀏覽器 ──► Cloudflare Worker「ipas」（wrangler.app.jsonc）
            ├─ /api/*  → worker/index.ts（Hono）
            │            ├─ /api/auth/*        Better Auth（Google、magic link）
            │            ├─ /api/me、/api/pricing、/api/checkout、/api/refund-request
            │            ├─ /api/usage/paid-feature、/api/sync
            │            ├─ /api/payuni/notify、/api/payuni/return   ◄── PAYUNi
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
| `worker/payuni.ts` | PAYUNi UPP 表單、AES-256-GCM 加解密、HashInfo、回傳驗證 |
| `worker/sync.ts` | 帳號同步的合併規則與讀寫 |
| `worker/auth.ts`、`worker/email.ts` | Better Auth 設定；寄信介面（Resend 或 console） |
| `worker/db/` | Kysely 型別與 `Store`（`atomic()` = D1 batch） |
| `migrations/*.sql` | D1 migrations（可移植 SQL） |

## 資料模型

全部定義在 `migrations/0001_init.sql`。可移植規則：id 為應用程式產生的 TEXT（UUID）、時間為 ISO-8601 UTC 字串、金額為整數新臺幣元、布林用 `BOOLEAN` + `TRUE/FALSE`、不使用 JSON1 等資料庫函式（陣列以 JSON 字串存在 TEXT 欄位，只在應用程式端解析）、多列寫入使用 `ON CONFLICT`（SQLite 3.24+ 與 Postgres 皆支援）。

- **Better Auth**：`"user"`、`"session"`、`"account"`、`"verification"`（欄位沿用 Better Auth 預設 camelCase；magic link 使用 `verification`）。
- **`exam_sittings`**（梯次）：`id`、`level`（beginner/intermediate）、`exam_date`（YYYY-MM-DD 台灣日期）、`name`、`sale_open`。新梯次請新增 migration（見下方）。
- **`orders`**：`merchant_trade_no`（送 PAYUNi 的 MerTradeNo，唯一）、`user_id`、`sitting_id`、`level`、`price_type`（early/regular/renewal）、`amount_twd`、`status`（pending/paid/failed/refunded）、`payuni_trade_no`、`consent_at`（同意「數位內容立即提供、不適用 7 天鑑賞期」的時間）、`paid_at`、`refund_requested_at`、`refund_reason`、`refunded_at`、`last_notify`（最近一次解密後回傳，供對帳）、`note`。
- **`passes`**（考期通行證）：`user_id`、`sitting_id`、`level`、`valid_from`（付款時間）、`valid_until`（考試日 + 30 天的台灣時間 23:59:59.999）、`order_id`（唯一）、`first_paid_feature_used_at`／`first_paid_feature`（退款資格用）、`revoked_at`（退款後撤銷）。`(user_id, sitting_id)` 唯一。
- **`sync_sessions`**、**`sync_question_stats`**：對應 `AppState.sessions`（Session）與 `AppState.questionStats`（QuestionStat），主鍵 `(user_id, session_id)`／`(user_id, question_id)`。

金額欄位以「整數新臺幣元」儲存：TWD 實務上沒有小數，PAYUNi `TradeAmt` 亦為整數元；此即「金額用整數、不用浮點數」的規則套用在 TWD 上。

D1 不支援互動式交易，需要「全部成功或全部失敗」的寫入（入帳＋建立通行證、退款＋撤銷通行證、同步）一律經 `Store.atomic()`，以 D1 `batch()`（單一交易）執行；日後遷移 Postgres 時以 `db.transaction()` 實作同一介面。D1 單一查詢最多 100 個綁定參數，多列寫入以 `chunk()` 切塊。

## 定價規則（`src/lib/pricing.ts`）

| | 中級 | 初級（推論，ADR 0003） |
|---|---|---|
| 定價 | NT$590 | NT$590 |
| 早鳥價（考試日前 45 天含以上） | NT$490 | NT$490 |
| 續購價（曾有已付款且未退款的通行證，不分級別） | NT$390 | NT$390 |

- 列出所有適用的價格後**取最低**；目前續購價最低，所以續購價優先於早鳥價。
- 「前 45 天」以購買當下的台灣日曆日與考試日相差天數計算。
- 金額一律由伺服器在 `/api/checkout` 重新計算，不信任前端。
- 改價：只改 `PRICING.prices`（前端價目頁與 Worker 共用同一物件），重新建置部署即可。

## 流程

### 登入

1. `/login/`：Google（`POST /api/auth/sign-in/social`，回傳 Google 授權網址）或 Email magic link（`POST /api/auth/sign-in/magic-link`，連結 5 分鐘有效）。
2. 回呼後 Better Auth 設定 session cookie：host-only（`ipas.zhenhe-co.com`）、HTTPS 下為 `__Secure-` 前綴 + Secure、HttpOnly、SameSite=Lax。
3. 寄信：`EMAIL_PROVIDER=resend` 用 Resend API；`console` 只印在 Worker log（開發用）。未設定時有 `RESEND_API_KEY` 就用 Resend。
4. 同一 email 用 Google 與 magic link 登入會連結為同一帳號（`accountLinking`，Google 為信任來源）。

### 購買 → 入帳 → 通行證

1. `/pricing/` 呼叫 `GET /api/pricing`，列出尚未結束的梯次與目前使用者的價格。
2. 使用者勾選同意「數位內容立即提供、不適用 7 天鑑賞期」，表單以一般 POST 送 `/api/checkout`（`sittingId`、`consent=on`）。Worker 檢查 Origin、登入、同意、梯次可購買、未持有該梯次 → 重新計價 → 建立 `pending` 訂單（記錄 `consent_at`）→ 回傳自動送出的 HTML 表單（`MerID`、`Version`、`EncryptInfo`、`HashInfo`）POST 到 PAYUNi UPP。以 JSON 呼叫則回傳 `{ orderId, amount, priceType, checkout: { action, fields } }`。
3. 使用者在 PAYUNi 付款。
4. **NotifyURL**（`/api/payuni/notify`，伺服器對伺服器）：驗證 HashInfo → 解密 → 內外層 MerID 必須是本商店 → 依 MerTradeNo 找訂單 → `TradeAmt` 必須等於訂單金額 → 判斷結果：
   - 已付款：在同一個 batch 中「訂單 pending/failed → paid」並建立通行證；建立通行證的 SQL 以「訂單已由本次通知標記為 paid」為條件，重複或並行的通知不會重複建立，已退款的訂單也不會被補發。
   - 失敗：pending → failed（之後同一訂單若成功仍可入帳）。
   - 其他（例如 ATM／超商已取號未付款）：維持 pending。
   - 同一使用者同一梯次已有通行證（兩筆訂單都付款）：訂單標記 `note = duplicate_pass`，需人工退款。
5. **ReturnURL**（`/api/payuni/return`）：瀏覽器被帶回時做相同的驗證與冪等入帳（避免 Notify 延遲），再 303 導向 `/account/?payment=paid|pending|failed|error`。
6. 統一發票：由 PAYUNi 商店後台設定自動開立（振禾有限公司，統編 83446730），本系統不另外處理。

### 權益判斷（前端）

- `GET /api/me` → `{ user, passes, entitlements: { beginner|intermediate: { paid, validUntil } }, orders }`。
- `PAYWALL_ENABLED` 為 false、或 `/api/me` 離線／404／非 JSON 時，`AccountState = disabled`：所有功能開放、不顯示廣告（與目前完全相同）。
- 免費：練習、作答歷史。付費（需該級別的有效通行證）：單科模考、全真模考、錯題本、錯題重做、弱點分析、讀書計畫、無廣告。
- 廣告：`AdSlot` 只在 paywall 啟用、`PUBLIC_ADSENSE_CLIENT` 已設定、帳號狀態已載入且使用者不是付費會員時顯示。
- 升級提醒：成績頁對免費會員每個台灣日曆日至多顯示一次（`shouldShowUpgradePrompt`，上次顯示時間存在 localStorage）。

### 退款

1. 資格（`refundEligibility`）：訂單已付款、付款後 7×24 小時內、該通行證 `first_paid_feature_used_at` 為空、尚未申請過。
2. 前端在主動使用付費功能時呼叫 `reportPaidFeatureUse(level, feature)` → `POST /api/usage/paid-feature`，記錄該級別有效通行證的首次使用時間（只記第一次）；「無廣告」不算使用。
3. 使用者在 `/account/` 按「申請退款」→ `POST /api/refund-request`，訂單記錄 `refund_requested_at`、`refund_reason`。
4. 擁有者在 PAYUNi 後台退款後，以 `ADMIN_EMAILS` 中的帳號（email 需已驗證）呼叫 `POST /api/admin/orders/:id/refunded`（同一 batch：訂單 → refunded、通行證 → revoked）。例如在已登入的 `/account/` 頁面於瀏覽器 console 執行：
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

`vars`（`wrangler.app.jsonc`）：`BETTER_AUTH_URL`（網站網址）、`PAYUNI_ENV`（sandbox/production）、`EMAIL_PROVIDER`、`EMAIL_FROM`、`ADMIN_EMAILS`。

秘密（`npx wrangler secret put <NAME> -c wrangler.app.jsonc`，本機放 `.dev.vars`，範本 `.dev.vars.example`）：`BETTER_AUTH_SECRET`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`PAYUNI_MER_ID`、`PAYUNI_HASH_KEY`、`PAYUNI_HASH_IV`、`RESEND_API_KEY`。

前端建置時變數（Astro `PUBLIC_*`）：`PUBLIC_PAYWALL_ENABLED=1` 啟用付費機制；`PUBLIC_ADSENSE_CLIENT=ca-pub-…` 啟用廣告。

未設定 PAYUNi 秘密時 `/api/checkout` 回 503，其餘 API 正常。

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

然後 `npx wrangler d1 migrations apply ipas --remote -c wrangler.app.jsonc`。停止販售：`UPDATE exam_sittings SET sale_open = FALSE WHERE id = …`。初級梯次日期尚未確認，未預先建立。

## 上線檢查清單

1. **D1**：`npx wrangler d1 create ipas`，把 `database_id` 填入 `wrangler.app.jsonc`；`npx wrangler d1 migrations apply ipas --remote -c wrangler.app.jsonc`。確認 `exam_sittings` 有要販售的梯次。
2. **Better Auth**：`openssl rand -base64 32` 產生 `BETTER_AUTH_SECRET` 並設定。
3. **Google OAuth**：Google Cloud Console 建立 OAuth 用戶端（網頁應用程式），授權的重新導向 URI：`https://ipas.zhenhe-co.com/api/auth/callback/google`，JavaScript 來源：`https://ipas.zhenhe-co.com`；設定 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`。OAuth 同意畫面需發布（否則只有測試使用者能登入）。
4. **Email**：Resend 驗證寄件網域（`zhenhe-co.com` 的 DNS 紀錄），設定 `RESEND_API_KEY`、`EMAIL_FROM`。
5. **PAYUNi sandbox**：
   - 取得測試商店的 MerID／HashKey／HashIV，`PAYUNI_ENV=sandbox`。
   - 商店後台設定 NotifyURL／ReturnURL 允許的網址（若後台有此設定）：`https://ipas.zhenhe-co.com/api/payuni/notify`、`/api/payuni/return`。
   - 實際走一次：購買 → 付款成功 → 確認 Worker log 無驗證錯誤、訂單 paid、通行證建立、`/account/` 顯示付費會員。
   - 測試付款失敗、重複通知（PAYUNi 後台若可重送）、ReturnURL 導回。
   - **逐條核對下方「待確認假設」**，有差異就改 `worker/payuni.ts` 並更新測試向量。
   - 確認 PAYUNi 後台已啟用自動開立統一發票（振禾有限公司，統編 83446730）。
6. **切換部署**：`PUBLIC_PAYWALL_ENABLED=1 npx astro build && npx wrangler deploy -c wrangler.app.jsonc`（Worker 名稱同為 `ipas`，路由相同，會取代純靜態版本；回退時改用 `npx wrangler deploy`（`wrangler.jsonc`）並以未設旗標的建置部署即可）。
7. **正式收款**：換成正式商店秘密、`PAYUNI_ENV=production`，以小額實際購買並退款一次。
8. 設定 `ADMIN_EMAILS`，確認退款標記流程。
9. 退款、鑑賞期同意與付費功能說明需同步寫入網站的服務條款／退款政策頁（尚未建立）。

## 待以 PAYUNi 官方文件確認的假設

撰寫時無法連線 payuni.com.tw 官方文件。已驗證：本實作的加密輸出與「官方 PHP 範例寫法」（以 PHP 8.3 執行 `openssl_encrypt(..., 'aes-256-gcm', ...)` + `bin2hex(密文:::base64(tag))` + `strtoupper(hash('sha256', key.加密字串.iv))`）**位元組完全一致**（測試向量在 `worker/payuni.test.ts`）；並與第三方套件 `payuni-sdk-ts` 1.1.2（自稱改寫自官方 .NET SDK）的端點、Version、加解密、雜湊與欄位名稱一致。仍未經官方文件確認的項目（程式中皆標註「待以 PAYUNi 官方文件確認」）：

1. UPP 端點 `https://sandbox-api.payuni.com.tw/api/upp`／`https://api.payuni.com.tw/api/upp`，`Version=1.0`。
2. HashKey 32 字元、HashIV 16 字元，trim 後直接以 UTF-8 位元組作為 AES-256 金鑰與 GCM IV；tag 16 位元組。
3. UPP 加密參數名稱與必填：`MerID`、`MerTradeNo`、`TradeAmt`（整數元）、`Timestamp`（Unix 秒）、`ProdDesc`、`UsrMail`、`ReturnURL`、`NotifyURL`、`BackURL`；未指定付款方式時顯示商店啟用的全部方式。
4. `MerTradeNo` 長度上限與允許字元（目前產生 20 字元英數：`IP` + 台灣時間 yyMMddHHmmss + 6 碼）。
5. Notify／Return 表單欄位為 `Status`、`MerID`、`Version`、`EncryptInfo`、`HashInfo`；解密後欄位為 `Status`、`MerID`、`MerTradeNo`、`TradeNo`、`TradeAmt`、`TradeStatus`（query string；也相容 JSON）。
6. 付款結果判斷：`Status=SUCCESS` 且 `TradeStatus=1` 為已付款；`TradeStatus` 2／3 為失敗／取消；其他（如 0 = 已取號未付款）視為待付款。
7. NotifyURL 應回應的內容（目前回 HTTP 200 + `SUCCESS`；第三方 SDK 範例為 `1|OK`）與失敗重送機制。
8. ReturnURL 是否也帶相同的加密結果（目前假設相同並一併入帳，冪等）。
9. 退款：目前由擁有者在 PAYUNi 後台手動退款，未串接退款 API。
10. 統一發票由 PAYUNi 後台設定自動開立，不需在 UPP 參數中帶發票資訊。

## 其他推論（非 PAYUNi）

- 初級價格與中級相同、續購價不分級別、考試日結束後停止販售（ADR 0003）。
- 「7 天內」以付款時間起算 7×24 小時。
- 有效期「考試日後 30 天止」解讀為考試日 + 30 天的台灣時間當日結束。
- 已退款的訂單不算「曾購買」，不適用續購價。
