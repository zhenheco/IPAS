/**
 * Better Auth（執行於 Worker 內）：Google 登入 + magic link。
 * 資料表見 migrations/0001_init.sql；資料存取經 Kysely（ADR 0002）。
 * Session cookie 為 host-only（ipas.zhenhe-co.com），HTTPS 下自動加 Secure，SameSite=Lax。
 */
import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins/magic-link';
import type { DB } from './db';
import type { EmailSender } from './email';
import { magicLinkEmail } from './email';
import type { Env } from './env';

export function createAuth(env: Env, db: DB, mailer: EmailSender) {
  const origin = new URL(env.BETTER_AUTH_URL).origin;
  const google = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
    : {};
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [origin],
    database: { db, type: 'sqlite' },
    socialProviders: google,
    // Google 回呼網址：{BETTER_AUTH_URL}/api/auth/callback/google
    account: { accountLinking: { enabled: true, trustedProviders: ['google'] } },
    plugins: [
      magicLink({
        expiresIn: 300,
        sendMagicLink: async ({ email, url }) => { await mailer.send(magicLinkEmail(email, url)); },
      }),
    ],
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
