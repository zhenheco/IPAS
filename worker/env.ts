import type { D1Database, Fetcher } from '@cloudflare/workers-types';

/** Worker 綁定與環境變數。秘密以 `wrangler secret put` 設定，清單見 .dev.vars.example。 */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** 網站對外網址，例：https://ipas.zhenhe-co.com（Better Auth baseURL 的基準） */
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** zhenheco affiliate 金流微服務：網址與站台代碼（vars），金鑰與 webhook 秘密（secrets，見 docs/payments.md） */
  PAYMENT_API_BASE?: string;
  PAYMENT_SITE_CODE?: string;
  PAYMENT_API_KEY?: string;
  PAYMENT_WEBHOOK_SECRET?: string;
  /** cf-email | console（預設：有 CF_EMAIL 綁定與 CF_EMAIL_API_KEY 用 cf-email，否則 console） */
  EMAIL_PROVIDER?: string;
  /** 純 email 位址（中繼會移除顯示名稱），須為已驗證的寄件網域 */
  EMAIL_FROM?: string;
  /** cf-email Worker 的 service binding（同帳號不可直接 fetch 公開網址） */
  CF_EMAIL?: Fetcher;
  /** cf-email 的 X-API-Key 秘密（wrangler secret put CF_EMAIL_API_KEY） */
  CF_EMAIL_API_KEY?: string;
  /** 逗號分隔；可呼叫 /api/admin/* 的管理者 email */
  ADMIN_EMAILS?: string;
  /** Workers Rate Limiting binding（wrangler.app.jsonc ratelimits）；未綁定時不限流 */
  CONTACT_LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> };
}
