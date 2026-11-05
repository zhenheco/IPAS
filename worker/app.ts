/**
 * /api/* 路由。其他路徑交給靜態資源（env.ASSETS）。
 *
 * 安全：
 * - 會改變狀態的 API（affiliate webhook 除外）要求 Origin 與網站相同（CSRF 防護；session cookie 為 SameSite=Lax）。
 * - 收款經 affiliate 金流微服務；webhook 以 X-Webhook-Signature（HMAC-SHA256 原始 body）驗章，不依賴 cookie。
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { createAuth, type Auth } from './auth';
import { d1Store, type Store } from './db';
import { emailSenderFromEnv, type EmailSender } from './email';
import type { Env } from './env';
import { createOrder, fulfilPayment, getMe, listOffers, markRefunded, recordPaidFeatureUse, requestRefund } from './orders';
import { checkoutHtml, paymentClient } from './payment';
import { PaymentGatewayError } from './payment/gateway-client';
import { parseSyncBody, syncUser, loadSync } from './sync';

/** 開始作答即視為「已使用付費功能」的功能；須與 src/lib/entitlement.ts 的 countsAsPaidUse 一致（測試會比對） */
export const PAID_USE_FEATURES = ['exam', 'full', 'redo'] as const;

export interface AppDeps {
  now?: () => Date;
  mailer?: (env: Env) => EmailSender;
}

interface Ctx { store: Store; auth: Auth }
type HonoEnv = { Bindings: Env; Variables: { ctx: Ctx } };
type C = Context<HonoEnv>;

const MAX_SYNC_BYTES = 10 * 1024 * 1024;

const checkoutSchema = z.object({ sittingId: z.string().min(1).max(100), consent: z.literal(true) });
const refundSchema = z.object({ orderId: z.string().min(1).max(100), reason: z.string().max(500).optional() });
const usageSchema = z.object({ level: z.enum(['beginner', 'intermediate']), feature: z.enum(PAID_USE_FEATURES) });

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
    const client = paymentClient(c.env);
    if (!client) return fail('payment_unavailable', 503);
    const u = await currentUser(c);
    if (!u) return form ? c.redirect('/login/?next=/pricing/', 303) : c.json({ error: 'unauthenticated' }, 401);
    let body: Record<string, unknown>;
    try { body = form ? await c.req.parseBody() : await c.req.json(); } catch { return fail('bad_request', 400); }
    const parsed = checkoutSchema.safeParse({ sittingId: body.sittingId, consent: truthy(body.consent) ? true : body.consent });
    if (!parsed.success) return fail(truthy(body.consent) ? 'bad_request' : 'consent_required', 400);
    const t = now();
    const r = await createOrder(c.var.ctx.store, { userId: u.id, sittingId: parsed.data.sittingId, now: t });
    if (!r.ok) return fail(r.error, r.error === 'already_owned' ? 409 : 400);
    let checkout;
    try {
      // 經 affiliate 建立 TWD 一次性付款（無 periodParams → PAYUNi UPP）；orderId 用本站 merchant_trade_no，webhook 以此對回訂單
      checkout = (await client.createPayment({
        orderId: r.order.merchantTradeNo, amount: r.order.amount, currency: 'TWD', description: r.order.prodDesc,
        email: u.email, buyerCountry: 'TW', buyerType: 'individual',
      })).payuniForm;
    } catch (e) { console.error(`[payment] createPayment ${r.order.merchantTradeNo}: ${e instanceof Error ? e.message : e}`); }
    if (!checkout) return fail('payment_unavailable', 503);
    if (form) return c.html(checkoutHtml(checkout));
    return c.json({ orderId: r.order.id, amount: r.order.amount, priceType: r.order.priceType, checkout });
  });

  // affiliate → 本站 webhook（此路徑已登記於 affiliate）。付款成功／失敗的唯一入帳來源；回非 2xx 時 affiliate 會重試。
  app.post('/api/payment/affiliate/webhook', async (c) => {
    const client = paymentClient(c.env);
    if (!client) return c.json({ error: 'payment_unavailable' }, 503);
    let ev;
    try { ev = await client.parseWebhookEvent(await c.req.text(), c.req.header('x-webhook-signature') ?? null); }
    catch (e) {
      if (!(e instanceof PaymentGatewayError)) throw e;
      return c.json({ error: 'invalid_signature' }, 401);
    }
    // 只處理一次性 TWD 付款結果；續期／退款／訂閱等其他事件與非終態（PENDING）一律忽略（200，避免重送）
    if (ev.type || (ev.currency && ev.currency !== 'TWD') || (ev.status !== 'SUCCESS' && ev.status !== 'FAILED')) return c.json({ ok: true, ignored: true });
    const r = await fulfilPayment(c.var.ctx.store, {
      orderId: ev.orderId, status: ev.status, amount: Number(ev.amount), tradeNo: ev.tradeNo ?? '',
      raw: JSON.stringify({ paymentId: ev.paymentId, status: ev.status, amount: ev.amount, tradeNo: ev.tradeNo, paymentType: ev.paymentType, paidAt: ev.paidAt, errorMessage: ev.errorMessage }),
    }, now());
    // 已退款訂單不會因重送而成功，回 200 以停止重試（仍不開通）；其餘錯誤回 400 讓 affiliate 重送並留下紀錄
    if (!r.ok && r.error === 'order_refunded') { console.error(`[payment] ${ev.orderId}: success event for refunded order ignored`); return c.json({ ok: true, ignored: true }); }
    if (!r.ok) { console.error(`[payment] ${ev.orderId}: ${r.error}`); return c.json({ error: r.error }, 400); }
    return c.json({ ok: true, outcome: r.outcome });
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
    const r = await recordPaidFeatureUse(c.var.ctx.store, { userId: u.id, level: p.data.level, feature: p.data.feature, now: now() });
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
