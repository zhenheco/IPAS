# 交接：初級題庫、模擬試卷、帳號與收費（2026-11-04）

這份是給擁有者在本機接手用的待辦清單。技術細節在 `docs/payments.md`，決策在 `docs/adr/0003-beginner-level-pass.md`。

## 已完成、已在 main

- **初級題庫 504 題**：`data/questions/subject-11.json`（科目1 L11，252 題）、`subject-12.json`（科目2 L12，252 題），全數經過逐題審查。
- **模擬試卷 19 回**：`data/papers.json`（初級 5+5、中級 5+4），在「單科模考 → 試卷」選擇。新增題目後跑 `npm run papers`，只會追加新回，不動舊卷。
- **初級／中級切換**：首頁、練習、單科模考、全真模考、讀書計畫都有級別分頁。
- **帳號與收費**：Better Auth 登入（Google、magic link）、D1 帳號同步、考期通行證、PAYUNi 結帳、廣告、升級提醒。**預設全部關閉**，目前網站行為與之前相同。

## 先做（不需要外部帳號）

### 1. 確認初級考試規格

已於 2026-11-04 對照官方 115 年度簡章（0410 版）確認，GLOSSARY「科目」「證書類別」已更新：

- [x] 每科作答時間 **75 分鐘**
- [x] 每科 **70 分**及格；初級證書另有條件（同時報考：平均 70 分且每科不低於 60 分；非同時報考：每科 70 分），**程式尚未實作證書判定**
- [x] 每科 **50 題**單選

之後若簡章改了，改 `src/lib/levels.ts` 的 `SUBJECT_INFO[11]`、`SUBJECT_INFO[12]`（`minutes`、`passScore`），GLOSSARY 一併更新。

### 2. 填初級考試日期

- [x] `src/config.ts` → `EXAM_DATES.beginner` 已填 `'2026-11-07'`（115 年度初級最後一梯，簡章 0410 版；全年梯次為 3/21、5/16、8/15、11/7）。

11/7 考完後，倒數會顯示「本梯次已結束」；請改成下一個初級梯次日期，並同步新增 `exam_sittings` migration（`docs/payments.md`「新增梯次」）。設為 `null` 則不顯示倒數，讀書計畫會提示先設定日期。

### 3. 抽查初級題目

審查已重算所有計算題，也沒有發現答案錯誤，但建議你自己抽幾題看語氣與難度是否符合初級：

```bash
npm run dev
```

開 `http://localhost:4321/?level=beginner` 會直接切到初級；練習頁可依知識點出題，例如 `http://localhost:4321/practice/?subject=11&item=L11301`。

### 4. 本機建置的已知問題

- [x] 已在正常路徑的 worktree 驗證：`npx vitest run` 與 `npm run build` 皆通過，無此問題。

（雲端 worktree 位於 `.claude/` 隱藏資料夾時 `astro build` 會報 `Tsconfig not found astro/tsconfigs/strict`；一般資料夾不受影響。）

## 決策（需要你拍板）

ADR 0003 目前是 `proposed`，請確認後改成 `accepted`：

- [ ] 初級與中級**分開販售**通行證（各自計價、各自有效期）。
- [x] 初級價格：定價 NT$290／早鳥 249／續購 199（擁有者 2026-11-05 確認；中級維持 590／490／390）。
- [x] 續購價**不分級別**（考完初級再買中級也算續購）（擁有者 2026-11-05 確認）。
- [x] 考試日當天結束後停止販售該梯次（擁有者 2026-11-05 確認）。
- [x] 2026-11-14 這一梯不開放付費販售，以下一梯為目標（擁有者 2026-11-05）。
- [x] 退款資格只在買家實際開始單科模考／全真模考／錯題重做時結束，僅開啟錯題本、弱點分析、讀書計畫不影響（擁有者 2026-11-05）。

價格集中在 `src/lib/pricing.ts` 的 `PRICING.prices`。

## 上線收費前（需要外部帳號，依序做）

詳細指令見 `docs/payments.md`「上線檢查清單」。

1. **D1**：
   - [x] `npx wrangler d1 create ipas`，`database_id` 已填入 `wrangler.app.jsonc`。
   - [ ] 執行 migrations：
   ```bash
   npx wrangler d1 migrations apply ipas --remote -c wrangler.app.jsonc
   ```
2. [x] **初級梯次**：`migrations/0003_sitting_2026_11_beginner.sql` 已新增初級 2026-11-07（與中級 2026-11-14）；套用 migrations 後才會生效。之後的梯次照 `docs/payments.md`「新增梯次」。
3. [ ] **秘密**：`BETTER_AUTH_SECRET`（`openssl rand -base64 32`）。清單見 `.dev.vars.example`，用 `npx wrangler secret put <NAME> -c wrangler.app.jsonc` 設定。
4. [ ] **Google OAuth**：重新導向 URI `https://ipas.zhenhe-co.com/api/auth/callback/google`，並發布 OAuth 同意畫面。
5. [ ] **Email**：改走 zhenheco 中央 cf-email（`wrangler.app.jsonc` 已有 `CF_EMAIL` service binding，寄件網域 `zhenhe-co.com` 已驗證）。用 cf-mail repo 的 create-api-key script 建 key，存 1Password `op://Dev/CF_EMAIL_API_KEY_IPAS/credential`，再 `printf "%s" "$KEY" | npx wrangler secret put CF_EMAIL_API_KEY -c wrangler.app.jsonc`。部署後寄一封 magic link，從 `npx wrangler tail -c wrangler.app.jsonc` 取得 `[email:cf-email] id=<id> status=<status>` 的 id，再呼叫 cf-email 的 `GET /status/:id` 確認投遞；這需要另一把 scope 為 `status:read` 的 cf-email key（不是寄信用的 `CF_EMAIL_API_KEY`）。
6. [ ] **PAYUNi sandbox**：取得測試商店 MerID／HashKey／HashIV，實際走一次 購買 → 付款成功 → `/account/` 顯示付費會員；也測付款失敗與重複通知。
7. [ ] **核對 PAYUNi**：官方文件已於 2026-11-04 核對（`docs/research/payuni-upp-verification.md`），Version 已改 2.0、付款結果判斷已修正、已送 `TradeInvoice=1`。只剩一項需確認：**Notify 要回什麼字串、失敗如何重送**（目前回 `SUCCESS`；官方文件沒寫，需 sandbox 實測或來信 service@payuni.com.tw）。同時在 sandbox 確認 Version 2.0 與 `TradeInvoice=1` 實際可用。
8. [ ] **統一發票**：PAYUNi 後台啟用自動開立（振禾有限公司，統編 83446730）。
9. [x] **服務條款／退款政策／隱私權政策頁**：已建立 `/terms/`、`/refund/`（最後更新 2026-11-05）與 `/privacy/`（生效 2026-11-05，含 AdSense cookie 揭露），頁尾、價目頁、付費牆都有連結，結帳勾選框已改為同意服務條款與退款政策。上線前請自行確認內容（尤其是帳號資料刪除、準據法、非官方網站的說法）。
10. [ ] **切換部署**：
    ```bash
    PUBLIC_PAYWALL_ENABLED=1 npx astro build && npx wrangler deploy -c wrangler.app.jsonc
    ```
    要回到純靜態版：不設旗標重新建置，再 `npx wrangler deploy`。
11. [ ] **正式收款**：換正式商店秘密、`PAYUNI_ENV=production`，小額實買一次並退款。
12. [ ] 設定 `ADMIN_EMAILS` 秘密（倉庫為公開，不要寫進 `wrangler.app.jsonc`；`<擁有者管理員 Email>` 換成實際位址）：`printf "%s" "<擁有者管理員 Email>" | npx wrangler secret put ADMIN_EMAILS -c wrangler.app.jsonc`，確認退款標記流程（目前退款要先在 PAYUNi 後台手動退，再呼叫 `POST /api/admin/orders/:id/refunded`）。
13. [ ] （選用）廣告：建置時加 `PUBLIC_ADSENSE_CLIENT=ca-pub-…`。

## 之後可以做

- 匯入官方初級試題（`data/official/`，不公開）後，初級出題可改為以官方題校準；目前出題工具對初級會在沒有官方題時「不校準」直接出題。
- 初級變體題（`--variants`）目前只支援中級，等有官方初級題再開放。
