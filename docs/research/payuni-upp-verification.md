# PAYUNi UPP 串接核對紀錄

核對日期（as-of）：2026-11-04。對象：`worker/payuni.ts`、`worker/app.ts`、`worker/orders.ts`。

來源：PAYUNi 官方 API 文件（ShowDoc，`docs.payuni.com.tw/server/index.php?s=/api/page/info&page_id=N`，以下簡稱 page N）與官方 PHP SDK（`github.com/payuni/PHP_SDK`）。本檔的核對結果由專案擁有者端的協調者在 2026-11-04 對照上述頁面後提供；撰寫本檔的 agent 沒有重新連線取得原文，page 編號與欄位細節請以官方文件為準。**以下全部尚未經 sandbox 實測。**

| # | 項目 | 結果 | 依據 | 程式處理 |
|---|---|---|---|---|
| 1 | UPP 端點與 Version | 端點已確認。Version 原假設 `1.0`，官方為固定 **2.0**；更新紀錄（page 25）寫 1.0 仍可用，但電子發票功能不支援舊版 1.0／1.1。 | page 34、25 | `UPP_VERSION = '2.0'`。 |
| 2 | 加解密與 HashInfo | 已確認：AES-256-GCM、`bin2hex(密文:::base64(tag))`、`HashInfo = strtoupper(sha256(HashKey + EncryptInfo + HashIV))`。HashKey 32 字元／HashIV 16 字元只出現在官方範例，文件未明訂長度。 | PHP SDK 的 Encrypt／HashInfo；page 29、343、312 | 不變；仍以長度檢查擋下不符的金鑰，實際值以 sandbox 取得為準。 |
| 3 | UPP 參數 | 已確認。必填：`MerID`、`MerTradeNo`、`TradeAmt`、`Timestamp`、`ProdDesc`（最長 550）。`ReturnURL`／`NotifyURL`／`BackURL`／`UsrMail` 為條件式。NotifyURL 僅支援 80／443 埠。沒有付款方式參數，未指定時依商店後台預設。 | page 34 | 不變（本站 NotifyURL 為 https 443）。 |
| 4 | `MerTradeNo` | 已確認：最長 25 字元，允許 `[A-Za-z0-9_-]`，10 分鐘內不可重複。 | page 34 | `newMerTradeNo` 產生 20 字元英數，符合。 |
| 5 | Notify 欄位 | 已確認：Form Post，外層 `Status`、`MerID`、`Version`、`EncryptInfo`、`HashInfo`；解密後含 `Status`、`MerID`、`MerTradeNo`、`TradeNo`、`TradeAmt`、`TradeStatus`。 | page 80 | 不變。 |
| 6 | 付款結果判斷 | **已修正**。`TradeStatus`：0 取號成功、1 已付款、2 付款失敗、3 付款取消、8 訂單待確認。外層 `Status` 可為 `UNKNOWN`（等待授權結果逾期／系統忙碌）、`UNAPPROVED`。原程式把非 SUCCESS 一律當失敗，會把「結果未定」的訂單標成失敗。 | page 34 | `paymentOutcome`：TradeStatus 2／3 → failed；Status UNKNOWN／UNAPPROVED（不分大小寫）→ pending，絕不入帳；SUCCESS 且 TradeStatus 1 → paid；SUCCESS 且 0／8 → pending；其他 Status → failed。失敗訂單日後收到成功通知仍可入帳（原有行為）。 |
| 7 | NotifyURL 應回應的內容與重送規則 | **官方文件沒有載明**。只找到「交易結果請以 NotifyURL 為主」與「可於 15 分鐘後查詢交易」。 | — | 仍回 HTTP 200 + `SUCCESS`。待 sandbox 實測或來信 service@payuni.com.tw 確認。 |
| 8 | ReturnURL | 前景通知，Form Post；格式與 Notify 相同（官方 SDK 以同一組驗證處理）為依 SDK 推得，文件未逐字載明。以 NotifyURL 為準。 | page 34、80；PHP SDK | 沿用：Return 也驗證並冪等入帳。 |
| 9 | 退款 API | 存在，**本站未串接**。信用卡：`POST /api/trade/close`，`CloseType=2`，180 天內（page 38）。ATM／超商：`/api/trade/offline/refund`，需申請核准（page 76）。 | page 38、76 | 維持擁有者在 PAYUNi 後台手動退款，再標記退款。 |
| 10 | 統一發票 | 新增送出 `TradeInvoice=1`（page 34 選填：1 啟用）。page 24 說明發票依商店後台電子發票設定開立，所以後台仍須完成電子發票設定。 | page 34、24 | `buildCheckout` 加 `TradeInvoice: 1`。待 sandbox 確認發票實際開立。 |

## 仍未解決

- 第 7 項（Notify 回應字串與重送機制）。
- 第 1、10 項在 sandbox 上實測：Version 2.0 的請求是否被接受、`TradeInvoice=1` 是否如預期開立發票。
- 實際 HashKey／HashIV 長度。
