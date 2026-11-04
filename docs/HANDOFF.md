# 交接：初級題庫、模擬試卷、帳號與收費（2026-11-04）

這份是給擁有者在本機接手用的待辦清單。技術細節在 `docs/payments.md`，決策在 `docs/adr/0003-beginner-level-pass.md`。

## 已完成、已在 main

- **初級題庫 504 題**：`data/questions/subject-11.json`（科目1 L11，252 題）、`subject-12.json`（科目2 L12，252 題），全數經過逐題審查。
- **模擬試卷 19 回**：`data/papers.json`（初級 5+5、中級 5+4），在「單科模考 → 試卷」選擇。新增題目後跑 `npm run papers`，只會追加新回，不動舊卷。
- **初級／中級切換**：首頁、練習、單科模考、全真模考、讀書計畫都有級別分頁。
- **帳號與收費**：Better Auth 登入（Google、magic link）、D1 帳號同步、考期通行證、PAYUNi 結帳、廣告、升級提醒。**預設全部關閉**，目前網站行為與之前相同。

## 先做（不需要外部帳號）

### 1. 確認初級考試規格

雲端環境連不到 ipas.org.tw，下列數字是依搜尋摘要推論，請對照官方 115 年度簡章：

- [ ] 每科作答時間 **75 分鐘**
- [ ] 每科 **70 分**及格（以及是否另有「總分」門檻）
- [ ] 每科 **50 題**單選

要改的話改 `src/lib/levels.ts` 的 `SUBJECT_INFO[11]`、`SUBJECT_INFO[12]`（`minutes`、`passScore`），GLOSSARY「科目」一併更新。

### 2. 填初級考試日期

- [ ] `src/config.ts` → `EXAM_DATES.beginner` 填你要準備的初級梯次日期（例如 `'2027-03-20'`）。

沒填之前，首頁不顯示初級考試倒數，讀書計畫也會提示要先設定日期。

### 3. 抽查初級題目

審查已重算所有計算題，也沒有發現答案錯誤，但建議你自己抽幾題看語氣與難度是否符合初級：

```bash
npm run dev
```

開 `http://localhost:4321/?level=beginner` 會直接切到初級；練習頁可依知識點出題，例如 `http://localhost:4321/practice/?subject=11&item=L11301`。

### 4. 本機建置的已知問題

雲端 worktree 位於 `.claude/` 隱藏資料夾時 `astro build` 會報 `Tsconfig not found astro/tsconfigs/strict`；一般資料夾的 clone 不受影響。若本機也遇到，確認是在正常路徑底下建置。

## 決策（需要你拍板）

ADR 0003 目前是 `proposed`，請確認後改成 `accepted`：

- [ ] 初級與中級**分開販售**通行證（各自計價、各自有效期）。
- [ ] 初級價格暫定與中級相同（NT$590／早鳥 490／續購 390）。競品初級題庫電子檔只要 NT$79，初級可能要更低價，甚至考慮初級免費、只賣中級。
- [ ] 續購價**不分級別**（考完初級再買中級也算續購）。
- [ ] 考試日當天結束後停止販售該梯次。

價格集中在 `src/lib/pricing.ts` 的 `PRICING.prices`。

## 上線收費前（需要外部帳號，依序做）

詳細指令見 `docs/payments.md`「上線檢查清單」。

1. [ ] **D1**：`npx wrangler d1 create ipas`，把 `database_id` 填入 `wrangler.app.jsonc`，再執行 migrations：
   ```bash
   npx wrangler d1 migrations apply ipas --remote -c wrangler.app.jsonc
   ```
2. [ ] **初級梯次**：新增 migration 把初級梯次寫進 `exam_sittings`（目前只有中級 2026-11-14）。範例在 `docs/payments.md`「新增梯次」。
3. [ ] **秘密**：`BETTER_AUTH_SECRET`（`openssl rand -base64 32`）。清單見 `.dev.vars.example`，用 `npx wrangler secret put <NAME> -c wrangler.app.jsonc` 設定。
4. [ ] **Google OAuth**：重新導向 URI `https://ipas.zhenhe-co.com/api/auth/callback/google`，並發布 OAuth 同意畫面。
5. [ ] **Email**：Resend 驗證 `zhenhe-co.com` 寄件網域，設定 `RESEND_API_KEY`。
6. [ ] **PAYUNi sandbox**：取得測試商店 MerID／HashKey／HashIV，實際走一次 購買 → 付款成功 → `/account/` 顯示付費會員；也測付款失敗與重複通知。
7. [ ] **核對 PAYUNi 假設**（程式中標註「待以 PAYUNi 官方文件確認」，共 10 項，見 `docs/payments.md` 末段）。最需要看官方文件確認的三項：
   - 付款通知（Notify）的欄位名稱與 `TradeStatus` 代碼（目前假設 1 = 已付款）
   - Notify 要回什麼（目前回 `SUCCESS`；第三方 SDK 範例是 `1|OK`）
   - `MerTradeNo` 長度與允許字元
8. [ ] **統一發票**：PAYUNi 後台啟用自動開立（振禾有限公司，統編 83446730）。
9. [ ] **服務條款／退款政策頁**：尚未建立。需寫明 7 天內未使用付費功能可退款、結帳時同意「數位內容立即提供、不適用 7 天鑑賞期」。
10. [ ] **切換部署**：
    ```bash
    PUBLIC_PAYWALL_ENABLED=1 npx astro build && npx wrangler deploy -c wrangler.app.jsonc
    ```
    要回到純靜態版：不設旗標重新建置，再 `npx wrangler deploy`。
11. [ ] **正式收款**：換正式商店秘密、`PAYUNI_ENV=production`，小額實買一次並退款。
12. [ ] 設定 `ADMIN_EMAILS`，確認退款標記流程（目前退款要先在 PAYUNi 後台手動退，再呼叫 `POST /api/admin/orders/:id/refunded`）。
13. [ ] （選用）廣告：建置時加 `PUBLIC_ADSENSE_CLIENT=ca-pub-…`。

## 之後可以做

- 匯入官方初級試題（`data/official/`，不公開）後，初級出題可改為以官方題校準；目前出題工具對初級會在沒有官方題時「不校準」直接出題。
- 初級變體題（`--variants`）目前只支援中級，等有官方初級題再開放。
