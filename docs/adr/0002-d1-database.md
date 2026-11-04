---
status: accepted
---

# 以 Cloudflare D1 為資料庫，保留遷移至 Neon Postgres 的路徑

網站部署為 Cloudflare Workers（靜態資源加 API），網域 ipas.zhenhe-co.com；資料庫用 Cloudflare D1，認證用 Better Auth（Google 登入與 magic link，執行於 Worker 內），所有資料存取一律透過 Kysely，且只使用 SQLite 與 Postgres 皆可移植的 SQL，使日後可經 Hyperdrive 遷移至 Neon Postgres。

## 理由

預期規模小、成本與維運負擔低，D1 與 Workers 同平台、無額外連線管理。以 Kysely 加可移植 SQL 把遷移成本壓低，所以現在不必為了「以後可能要換」而提早採用 Postgres。

## Considered Options

- **第一天就用 Neon Postgres**：擁有者規則為「不確定時選 Postgres」。未採用的原因是目前資料量遠低於 D1 上限，且多一套外部資料庫會增加連線、成本與維運面；改以可移植 SQL 保留切換能力。

## 容量估算（推論）

每梯次約 3,000 名註冊會員 × 每人 1,500 筆作答 × 每筆約 100 bytes，約 0.45 GB；每年約 1 GB，三年約 3 GB，低於 5 GB 的遷移觸發線。若加入初級考試，可能接近該線。

## 遷移觸發條件

任一條成立即評估遷移至 Neon Postgres：

- 單一 D1 資料庫接近 5 GB
- 需要跨租戶的複雜報表或全文檢索
- 需與既有 Postgres 系統共用資料庫

## Consequences

- 禁止使用 D1 或 SQLite 專屬語法，所有 SQL 須能在 Postgres 執行；資料存取不得繞過 Kysely。
- 2026-11-14 前的自用版本不登入，紀錄只存在瀏覽器；其資料形狀須與未來資料庫 schema 一致，以便日後匯入。
