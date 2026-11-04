/** 測試用：以 fake D1 + 真實 Hono app + Better Auth（magic link）登入，回傳可帶 cookie 呼叫 API 的 client。 */
import { createApp } from '../app';
import { ConsoleEmailSender } from '../email';
import type { Env } from '../env';
import { migratedD1 } from './fake-d1';

export const ORIGIN = 'https://ipas.test';
export const PAYUNI = { PAYUNI_MER_ID: 'S01234567', PAYUNI_HASH_KEY: '12345678901234567890123456789012', PAYUNI_HASH_IV: 'abcdefghijklmnop' };

export function harness(opts: { now?: Date; env?: Partial<Env> } = {}) {
  const db = migratedD1();
  const mailer = new ConsoleEmailSender();
  const clock = { now: opts.now ?? new Date('2026-09-01T04:00:00.000Z') };
  const env = {
    DB: db.d1, ASSETS: { fetch: async () => new Response('static asset') },
    BETTER_AUTH_URL: ORIGIN, BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-123',
    PAYUNI_ENV: 'sandbox', ...PAYUNI, EMAIL_PROVIDER: 'console', ...opts.env,
  } as unknown as Env;
  const app = createApp({ now: () => clock.now, mailer: () => mailer });
  const fetchApp = (path: string, init: RequestInit = {}) => app.fetch(new Request(`${ORIGIN}${path}`, init), env);

  /** 以 magic link 登入，回傳 Cookie 標頭值 */
  async function signIn(email: string): Promise<string> {
    const r = await fetchApp('/api/auth/sign-in/magic-link', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email, callbackURL: '/account/' }),
    });
    if (r.status !== 200) throw new Error(`magic link request failed: ${r.status} ${await r.text()}`);
    const msg = mailer.sent.findLast((m) => m.to === email);
    const url = msg?.text.match(/https?:\/\/\S+/)?.[0];
    if (!url) throw new Error('no magic link sent');
    const v = await app.fetch(new Request(url, { redirect: 'manual' }), env);
    const cookies = v.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.endsWith('='));
    if (!cookies.length) throw new Error(`no session cookie: ${v.status} ${await v.text()}`);
    return cookies.join('; ');
  }

  function client(cookie: string) {
    const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => fetchApp(path, {
      method, headers: { cookie, origin: ORIGIN, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      get: (p: string) => call('GET', p),
      post: (p: string, b?: unknown, h?: Record<string, string>) => call('POST', p, b ?? {}, h),
      put: (p: string, b?: unknown) => call('PUT', p, b),
      form: (p: string, fields: Record<string, string>, h: Record<string, string> = {}) =>
        fetchApp(p, { method: 'POST', headers: { cookie, origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded', ...h }, body: new URLSearchParams(fields).toString() }),
    };
  }

  return { db, mailer, clock, env, app, fetchApp, signIn, client };
}
