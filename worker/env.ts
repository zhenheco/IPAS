import type { D1Database, Fetcher } from '@cloudflare/workers-types';
import type { PayuniEnv } from './payuni';

/** Worker 綁定與環境變數。秘密以 `wrangler secret put` 設定，清單見 .dev.vars.example。 */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** 網站對外網址，例：https://ipas.zhenhe-co.com（Better Auth baseURL 與 PAYUNi 回傳網址的基準） */
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  PAYUNI_ENV?: PayuniEnv;
  PAYUNI_MER_ID?: string;
  PAYUNI_HASH_KEY?: string;
  PAYUNI_HASH_IV?: string;
  /** resend | console（預設：有 RESEND_API_KEY 用 resend，否則 console） */
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  /** 逗號分隔；可呼叫 /api/admin/* 的管理者 email */
  ADMIN_EMAILS?: string;
}
