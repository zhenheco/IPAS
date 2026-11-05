/**
 * 收款一律經 zhenheco affiliate 金流微服務：本站不呼叫 PAYUNi，也不持有 PAYUNi HashKey／IV。
 * gateway-client.ts 是 affiliate 的 src/lib/sdk/payment-gateway-client.ts 原檔（勿修改，更新時整檔覆蓋）；這裡只負責組態與 HTML。
 */
import type { Env } from '../env';
import { PaymentGatewayClient, type PaymentResult } from './gateway-client';

/** 缺任何一項回 null（呼叫端回 503）。PAYMENT_API_BASE 覆寫 SDK 預設網址（正式為 https://affiliate.1wayseo.com）。 */
export function paymentClient(env: Env): PaymentGatewayClient | null {
  if (!env.PAYMENT_API_KEY || !env.PAYMENT_WEBHOOK_SECRET || !env.PAYMENT_SITE_CODE || !env.PAYMENT_API_BASE) return null;
  return new PaymentGatewayClient({ apiKey: env.PAYMENT_API_KEY, siteCode: env.PAYMENT_SITE_CODE, webhookSecret: env.PAYMENT_WEBHOOK_SECRET, baseUrl: env.PAYMENT_API_BASE });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** 自動送出的 HTML 表單（瀏覽器以 POST 前往 affiliate 回傳的 PAYUNi 付款頁） */
export function checkoutHtml(f: NonNullable<PaymentResult['payuniForm']>): string {
  const inputs = Object.entries(f.fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>前往付款</title></head>
<body><form id="payuni" method="post" action="${esc(f.action)}">${inputs}<p>正在前往 PAYUNi 付款頁…</p><noscript><button type="submit">前往付款</button></noscript></form>
<script>document.getElementById('payuni').submit()</script></body></html>`;
}
