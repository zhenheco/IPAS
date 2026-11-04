/** 寄信介面；magic link 透過此介面寄出，依環境變數選擇 Resend 或 console（開發用）。 */
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

export class ResendEmailSender implements EmailSender {
  constructor(private apiKey: string, private from: string, private fetchImpl: typeof fetch = fetch) {}
  async send(m: EmailMessage) {
    const r = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
    });
    if (!r.ok) throw new Error(`Resend 寄信失敗：${r.status} ${await r.text().catch(() => '')}`);
  }
}

export function emailSenderFromEnv(env: Pick<Env, 'EMAIL_PROVIDER' | 'RESEND_API_KEY' | 'EMAIL_FROM'>): EmailSender {
  const provider = env.EMAIL_PROVIDER ?? (env.RESEND_API_KEY ? 'resend' : 'console');
  if (provider === 'resend') {
    if (!env.RESEND_API_KEY) throw new Error('EMAIL_PROVIDER=resend 但未設定 RESEND_API_KEY');
    return new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM ?? 'iPAS 練習 <no-reply@zhenhe-co.com>');
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
