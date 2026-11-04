/**
 * Worker 入口（wrangler.app.jsonc 的 main）。/api/* 由 Hono 處理，其餘交給靜態資源。
 * 目前正式部署仍使用 wrangler.jsonc（純靜態）；切換方式見 docs/payments.md。
 */
import { createApp } from './app';

const app = createApp();

export default { fetch: app.fetch };
