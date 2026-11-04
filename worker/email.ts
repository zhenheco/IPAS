/** 寄信介面；magic link 透過此介面寄出，依環境變數選擇 zhenheco cf-email 中繼（service binding）或 console（開發用）。 */
import type { Fetcher, Response as CfResponse } from '@cloudflare/workers-types';
import type { Env } from './env';

export interface EmailMessage { to: string; subject: string; text: string; html: string }
export interface EmailSender { send(m: EmailMessage): Promise<void> }

export class ConsoleEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  constructor(private log = true) {}
  async send(m: EmailMessage) {
    this.sent.push(m);
    if (this.log) console.log(`[email:console] to=${m.to} subject=${m.subject}\n${m.text}`);
  }
}

/** zhenheco 中央 cf-email 中繼。同帳號 Worker 不能 fetch 公開網址（error 1042），須走 service binding。 */
export class CfEmailSender implements EmailSender {
  constructor(private cf: Pick<Fetcher, 'fetch'>, private apiKey: string, private from: string) {}
  // 例外與日誌「絕不」帶入中繼回應文字或 fetch 錯誤訊息（可能回顯 key，含 JSON \uXXXX 跳脫）：
  // 只允許狀態碼，以及解析後通過白名單格式的 error.code / status / id。
  private safe(v: unknown, re: RegExp): string | undefined {
    return typeof v === 'string' && re.test(v) && !v.includes(this.apiKey) ? v : undefined;
  }
  async send(m: EmailMessage) {
    // 同一封信重送得到同一把 key（中繼端重放而非重寄），新連結則是新 key
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${m.to}\n${m.subject}\n${m.text}`));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    // 主機名會被忽略，只有路徑有意義
    let r: CfResponse;
    try {
      r = await this.cf.fetch('https://cf-email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': this.apiKey, 'Idempotency-Key': `ipas:magic-link:${hex}` },
        // v1 body：已部署的中繼會拒絕 v2
        body: JSON.stringify({ to: m.to, from: this.from, subject: m.subject, text: m.text, html: m.html, tags: ['ipas', 'magic-link'] }),
      });
    } catch {
      throw new Error('cf-email 呼叫失敗');
    }
    const text = await r.text().catch(() => '');
    let parsed: { id?: unknown; status?: unknown; error?: { code?: unknown } } | undefined;
    try { parsed = JSON.parse(text) ?? undefined; } catch { /* 非 JSON */ }
    const suppressed = (extra: string) =>
      new Error(`cf-email 拒絕寄信：收件者在 suppression list（recipient_suppressed），無法寄出登入連結${extra}`);
    if (!r.ok) {
      const code = this.safe(parsed?.error?.code, /^[a-z_]{1,64}$/);
      if (r.status === 403 && code === 'recipient_suppressed') throw suppressed('');
      // Cloudflare 平台封鎖（例：error code: 1042）是純文字，只取數字
      const cf = /^error code: (\d{1,6})$/.exec(text.trim())?.[1];
      throw new Error(`cf-email 寄信失敗：${r.status}${code ? ` code=${code}` : ''}${cf ? ` cloudflare_error=${cf}` : ''}`);
    }
    // 冪等重放回報的是目前狀態，不能一律當成功
    if (!parsed || typeof parsed !== 'object') throw new Error(`cf-email 回應不是 JSON 物件：${r.status}`);
    const id = this.safe(parsed.id, /^[A-Za-z0-9_-]{1,64}$/) ?? '<invalid>';
    const status = parsed.status;
    if (status === 'suppressed') throw suppressed(`（id=${id}）`);
    if (status === 'failed') throw new Error(`cf-email 寄信失敗：id=${id} status=failed`);
    if (status === 'bounced' || status === 'complained') {
      throw new Error(`cf-email 信件 ${status}（id=${id}），收件者不會收到登入連結`);
    }
    if (status !== 'pending' && status !== 'sent' && status !== 'delivered') {
      throw new Error(`cf-email 回應缺少或不認得 status：id=${id}`);
    }
    // 只記 id 與 status 供維運用 wrangler tail 查投遞，不含 key 或信件內容
    console.log(`[email:cf-email] id=${id} status=${status}`);
  }
}

export function emailSenderFromEnv(env: Pick<Env, 'EMAIL_PROVIDER' | 'EMAIL_FROM' | 'CF_EMAIL' | 'CF_EMAIL_API_KEY'>): EmailSender {
  const provider = env.EMAIL_PROVIDER ?? (env.CF_EMAIL && env.CF_EMAIL_API_KEY ? 'cf-email' : 'console');
  if (provider === 'cf-email') {
    if (!env.CF_EMAIL) throw new Error('EMAIL_PROVIDER=cf-email 但未設定 CF_EMAIL service binding（見 wrangler.app.jsonc services）');
    if (!env.CF_EMAIL_API_KEY) throw new Error('EMAIL_PROVIDER=cf-email 但未設定 CF_EMAIL_API_KEY');
    return new CfEmailSender(env.CF_EMAIL, env.CF_EMAIL_API_KEY, env.EMAIL_FROM ?? 'no-reply@zhenhe-co.com');
  }
  return new ConsoleEmailSender();
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function magicLinkEmail(to: string, url: string): EmailMessage {
  return {
    to,
    subject: '登入 iPAS AI 應用規劃師練習',
    text: `請點下列連結登入（5 分鐘內有效）：\n${url}\n\n若您沒有要求登入，請忽略這封信。`,
    html: `<p>請點下列連結登入（5 分鐘內有效）：</p><p><a href="${escHtml(url)}">登入 iPAS 練習</a></p><p>若您沒有要求登入，請忽略這封信。</p>`,
  };
}
