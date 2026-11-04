/**
 * /api/* 路由。其他路徑交給靜態資源（env.ASSETS）。
 *
 * 安全：
 * - 會改變狀態的 API（PAYUNi 回傳除外）要求 Origin 與網站相同（CSRF 防護；session cookie 為 SameSite=Lax）。
 * - PAYUNi 回傳以 HashInfo 驗章 + AES-GCM 解密驗證，不依賴 cookie。
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { isPassLevel, PASS_LEVELS } from '../src/lib/pricing';
import { createAuth, type Auth } from './auth';
import { d1Store, type Store } from './db';
import { emailSenderFromEnv, type EmailSender } from './email';
import type { Env } from './env';
import { createOrder, fulfilPayment, getMe, listOffers, markRefunded, recordPaidFeatureUse, requestRefund } from './orders';
import { buildCheckout, checkoutHtml, verifyPayuniForm, type PayuniConfig } from './payuni';
import { parseSyncBody, syncUser, loadSync } from './sync';

/** 主動使用即視為「已使用付費功能」的功能；須與 src/lib/entitlement.ts 的 countsAsPaidUse 一致（測試會比對） */
export const PAID_USE_FEATURES = ['exam', 'full', 'wrongbook', 'redo', 'weakness', 'plan'] as const;

export interface AppDeps {
  now?: () => Date;
  mailer?: (env: Env) => EmailSender;
}

interface Ctx { store: Store; auth: Auth }
type HonoEnv = { Bindings: Env; Variables: { ctx: Ctx } };
type C = Context<HonoEnv>;

const MAX_SYNC_BYTES = 10 * 1024 * 1024;

export function payuniConfig(env: Env): PayuniConfig | null {
  if (!env.PAYUNI_MER_ID || !env.PAYUNI_HASH_KEY || !env.PAYUNI_HASH_IV) return null;
  return { merId: env.PAYUNI_MER_ID, hashKey: env.PAYUNI_HASH_KEY, hashIV: env.PAYUNI_HASH_IV, env: env.PAYUNI_ENV === 'production' ? 'production' : 'sandbox' };
}

const checkoutSchema = z.object({ sittingId: z.string().min(1).max(100), consent: z.literal(true) });
const refundSchema = z.object({ orderId: z.string().min(1).max(100), reason: z.string().max(500).optional() });
const usageSchema = z.object({ level: z.enum(PASS_LEVELS as [string, ...string[]]).refine(isPassLevel), feature: z.enum(PAID_USE_FEATURES) });

const truthy = (v: unknown) => v === true || v === 'on' || v === 'true' || v === '1';

export function createApp(deps: AppDeps = {}) {
  const now = deps.now ?? (() => new Date());
  const ctxCache = new WeakMap<object, Ctx>();
  const app = new Hono<HonoEnv>();

  const origin = (c: C) => new URL(c.env.BETTER_AUTH_URL).origin;
  const sameOrigin = (c: C) => c.req.header('origin') === origin(c);
  const isForm = (c: C) => !(c.req.header('content-type') ?? '').includes('application/json');

  async function currentUser(c: C) {
    const s = await c.var.ctx.auth.api.getSession({ headers: c.req.raw.headers });
    return s?.user ?? null;
  }

  app.use('/api/*', async (c, next) => {
    let ctx = ctxCache.get(c.env);
    if (!ctx) {
      const store = d1Store(c.env.DB);
      ctx = { store, auth: createAuth(c.env, store.db, (deps.mailer ?? emailSenderFromEnv)(c.env)) };
      ctxCache.set(c.env, ctx);
    }
    c.set('ctx', ctx);
    await next();
    c.header('Cache-Control', 'no-store');
  });

  app.on(['GET', 'POST'], '/api/auth/*', (c) => c.var.ctx.auth.handler(c.req.raw));

  app.get('/api/me', async (c) => {
    const u = await currentUser(c);
    if (!u) return c.json({ error: 'unauthenticated' }, 401);
    return c.json(await getMe(c.var.ctx.store, { id: u.id, email: u.email, name: u.name, image: u.image ?? null }, now()));
  });

  app.get('/api/pricing', async (c) => {
    const u = await currentUser(c);
    return c.json({ sittings: await listOffers(c.var.ctx.store, u?.id ?? null, now()), signedIn: !!u });
  });

  app.post('/api/checkout', async (c) => {
    const form = isForm(c);
    const fail = (error: string, status: 400 | 401 | 403 | 409 | 503) =>
      form ? c.redirect(`/pricing/?error=${encodeURIComponent(error)}`, 303) : c.json({ error }, status);
    if (!sameOrigin(c)) return fail('bad_origin', 403);
    const cfg = payuniConfig(c.env);
    if (!cfg) return fail('payment_unavailable', 503);
    const u = await currentUser(c);
    if (!u) return form ? c.redirect('/login/?next=/pricing/', 303) : c.json({ error: 'unauthenticated' }, 401);
    let body: Record<string, unknown>;
    try { body = form ? await c.req.parseBody() : await c.req.json(); } catch { return fail('bad_request', 400); }
    const parsed = checkoutSchema.safeParse({ sittingId: body.sittingId, consent: truthy(body.consent) ? true : body.consent });
    if (!parsed.success) return fail(truthy(body.consent) ? 'bad_request' : 'consent_required', 400);
    const t = now();
    const r = await createOrder(c.var.ctx.store, { userId: u.id, sittingId: parsed.data.sittingId, now: t });
    if (!r.ok) return fail(r.error, r.error === 'already_owned' ? 409 : 400);
    const base = origin(c);
    const checkout = await buildCheckout(cfg, { merTradeNo: r.order.merchantTradeNo, amount: r.order.amount, prodDesc: r.order.prodDesc, email: u.email },
      { returnUrl: `${base}/api/payuni/return`, notifyUrl: `${base}/api/payuni/notify`, backUrl: `${base}/pricing/` }, t);
    if (form) return c.html(checkoutHtml(checkout));
    return c.json({ orderId: r.order.id, amount: r.order.amount, priceType: r.order.priceType, checkout });
  });

  async function handlePayuni(c: C) {
    const cfg = payuniConfig(c.env);
    if (!cfg) return { status: 503 as const, error: 'payment_unavailable' };
    let form: Record<string, string>;
    try {
      const b = await c.req.parseBody();
      form = Object.fromEntries(Object.entries(b).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    } catch { return { status: 400 as const, error: 'bad_request' }; }
    const v = await verifyPayuniForm(cfg, form);
    if (!v.ok) { console.error(`[payuni] verification failed: ${v.error}`); return { status: 400 as const, error: v.error }; }
    const r = await fulfilPayment(c.var.ctx.store, v.result, now());
    if (!r.ok) { console.error(`[payuni] ${v.result.merTradeNo}: ${r.error}`); return { status: 400 as const, error: r.error }; }
    return { status: 200 as const, result: r };
  }

  // NotifyURL：PAYUNi 伺服器對伺服器通知。
  // 待以 PAYUNi 官方文件確認：商店應回應的內容（目前回 200 + "SUCCESS"）與失敗時的重送機制。
  app.post('/api/payuni/notify', async (c) => {
    const r = await handlePayuni(c);
    return r.status === 200 ? c.text('SUCCESS') : c.text(r.error, r.status);
  });

  // ReturnURL：付款完成後使用者瀏覽器被帶回（跨站 POST，不帶 cookie）。也會處理入帳（冪等），以免 Notify 延遲。
  app.post('/api/payuni/return', async (c) => {
    const r = await handlePayuni(c);
    const payment = r.status === 200 ? r.result.outcome : 'error';
    return c.redirect(`/account/?payment=${payment}`, 303);
  });

  app.post('/api/refund-request', async (c) => {
    if (!sameOrigin(c)) return c.json({ error: 'bad_origin' }, 403);
    const u = await currentUser(c);
    if (!u) return c.json({ error: 'unauthenticated' }, 401);
    const p = refundSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: 'bad_request' }, 400);
    const r = await requestRefund(c.var.ctx.store, { userId: u.id, orderId: p.data.orderId, reason: p.data.reason ?? null, now: now() });
    return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, r.error === 'order_not_found' ? 404 : 409);
  });

  app.post('/api/usage/paid-feature', async (c) => {
    if (!sameOrigin(c)) return c.json({ error: 'bad_origin' }, 403);
    const u = await currentUser(c);
    if (!u) return c.json({ error: 'unauthenticated' }, 401);
    const p = usageSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: 'bad_request' }, 400);
    const r = await recordPaidFeatureUse(c.var.ctx.store, { userId: u.id, level: p.data.level as 'beginner' | 'intermediate', feature: p.data.feature, now: now() });
    return c.json(r);
  });

  app.get('/api/sync', async (c) => {
    const u = await currentUser(c);
    if (!u) return c.json({ error: 'unauthenticated' }, 401);
    return c.json({ schemaVersion: 1, ...(await loadSync(c.var.ctx.store, u.id)) });
  });

  app.put('/api/sync', async (c) => {
    if (!sameOrigin(c)) return c.json({ error: 'bad_origin' }, 403);
    const u = await currentUser(c);
    if (!u) return c.json({ error: 'unauthenticated' }, 401);
    if (Number(c.req.header('content-length') ?? 0) > MAX_SYNC_BYTES) return c.json({ error: 'too_large' }, 413);
    const p = parseSyncBody(await c.req.json().catch(() => null));
    if (!p.ok) return c.json({ error: 'bad_request', message: p.error }, 400);
    return c.json({ schemaVersion: 1, ...(await syncUser(c.var.ctx.store, u.id, p.data, now())) });
  });

  // 管理：擁有者在 PAYUNi 後台完成退款後標記，訂單改為 refunded 並撤銷通行證。
  app.post('/api/admin/orders/:id/refunded', async (c) => {
    if (!sameOrigin(c)) return c.json({ error: 'bad_origin' }, 403);
    const u = await currentUser(c);
    const admins = (c.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!u || !u.emailVerified || !admins.includes(u.email.toLowerCase())) return c.json({ error: 'forbidden' }, 403);
    const r = await markRefunded(c.var.ctx.store, { orderId: c.req.param('id'), now: now() });
    return r.ok ? c.json({ ok: true }) : c.json({ error: 'not_paid' }, 409);
  });

  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

  app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw as never) as unknown as Response);

  return app;
}
