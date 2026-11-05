import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAID_FEATURES, countsAsPaidUse } from '../src/lib/entitlement';
import type { QuestionStat, Session } from '../src/lib/types';
import { PAID_USE_FEATURES } from './app';
import { ORIGIN, PAYMENT, harness } from './test/harness';

const SITTING = 'intermediate-2026-11-14';
const FORM = { action: 'https://sandbox-api.payuni.com.tw/api/upp', method: 'POST', fields: { MerID: 'S01234567', Version: '2.0', EncryptInfo: 'ab12', HashInfo: 'CD34' } };

/** 與 affiliate 相同的簽章：HMAC-SHA256(secret, 原始 body) 的 hex（刻意不用 SDK 產生，獨立驗證契約） */
const sign = (raw: string, secret = PAYMENT.PAYMENT_WEBHOOK_SECRET) => createHmac('sha256', secret).update(raw).digest('hex');

interface Hook { orderId: string; amount: number; status?: 'SUCCESS' | 'FAILED'; tradeNo?: string; extra?: Record<string, unknown> }
const hookBody = (o: Hook) => JSON.stringify({
  paymentId: `pay-${o.orderId}`, orderId: o.orderId, providerOrderNo: 'IPAS-x-abc123', status: o.status ?? 'SUCCESS', amount: o.amount,
  ...((o.status ?? 'SUCCESS') === 'SUCCESS' ? { paidAt: '2026-09-01T03:59:00.000Z' } : { errorMessage: 'card declined' }),
  tradeNo: o.tradeNo ?? `T${o.orderId}`, paymentType: '1', metadata: {}, provider: 'payuni', currency: 'TWD', chargeSequence: 1, ...o.extra,
});

const fetchCalls: { url: string; init: RequestInit }[] = [];
function mockAffiliate(respond: () => Response = () => Response.json({ success: true, paymentId: 'pay-1', payuniForm: FORM })) {
  fetchCalls.length = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => { fetchCalls.push({ url, init }); return respond(); });
}
afterEach(() => vi.unstubAllGlobals());

async function setup(opts: Parameters<typeof harness>[0] = {}) {
  const h = harness(opts);
  const cookie = await h.signIn('buyer@example.com');
  const api = h.client(cookie);
  const webhook = (raw: string, headers: Record<string, string> = { 'x-webhook-signature': sign(raw) }) =>
    h.fetchApp('/api/payment/affiliate/webhook', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw });
  const pay = (o: Hook) => webhook(hookBody(o));
  const checkout = async (sittingId = SITTING) => {
    mockAffiliate();
    const r = await api.post('/api/checkout', { sittingId, consent: true });
    const j = await r.json() as { orderId: string; amount: number; priceType: string; checkout: typeof FORM };
    if (r.status !== 200) throw new Error(JSON.stringify(j));
    const order = h.db.raw.prepare('select merchant_trade_no from orders where id = ?').get(j.orderId) as { merchant_trade_no: string };
    return { ...j, merTradeNo: order.merchant_trade_no };
  };
  const rows = (sql: string, ...p: (string | number)[]) => h.db.raw.prepare(sql).all(...p) as Record<string, unknown>[];
  return { ...h, api, webhook, pay, checkout, rows };
}

describe('routing', () => {
  it('serves static assets for non-API paths and 404 JSON for unknown API paths', async () => {
    const h = harness();
    expect(await (await h.fetchApp('/practice/')).text()).toBe('static asset');
    const r = await h.fetchApp('/api/nope');
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'not_found' });
  });
  it('requires login for /api/me and /api/sync', async () => {
    const h = harness();
    expect((await h.fetchApp('/api/me')).status).toBe(401);
    expect((await h.fetchApp('/api/sync')).status).toBe(401);
  });
  it('worker accepts exactly the features that count as paid use', () => {
    expect([...PAID_USE_FEATURES].sort()).toEqual(PAID_FEATURES.filter(countsAsPaidUse).sort());
  });
});

describe('pricing + checkout', () => {
  it('anonymous pricing lists the seeded 梯次 (初級 11/07, 中級 11/14) with early-bird prices 67/74 days before the exam', async () => {
    const h = harness();
    const j = await (await h.fetchApp('/api/pricing')).json() as { sittings: { id: string; level: string; examDate: string; quote: { priceType: string; amount: number }; validUntil: string }[]; signedIn: boolean };
    expect(j.signedIn).toBe(false);
    expect(j.sittings).toHaveLength(2);
    expect(j.sittings[0]).toMatchObject({ id: 'beginner-2026-11-07', level: 'beginner', examDate: '2026-11-07', quote: { priceType: 'early', amount: 249 }, validUntil: '2026-12-07T15:59:59.999Z' });
    expect(j.sittings[1]).toMatchObject({ id: SITTING, quote: { priceType: 'early', amount: 490 }, validUntil: '2026-12-14T15:59:59.999Z' });
  });
  it('requires same origin, login and explicit consent', async () => {
    const s = await setup();
    expect((await s.api.post('/api/checkout', { sittingId: SITTING, consent: true }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await s.fetchApp('/api/checkout', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ sittingId: SITTING, consent: true }) })).status).toBe(401);
    const r = await s.api.post('/api/checkout', { sittingId: SITTING, consent: false });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'consent_required' });
    expect((await s.api.post('/api/checkout', { sittingId: 'nope', consent: true })).status).toBe(400);
    expect(s.rows('select * from orders')).toHaveLength(0);
  });
  it('creates a pending order priced server-side and asks affiliate for a TWD one-time payment', async () => {
    const s = await setup();
    const c = await s.checkout();
    expect(c).toMatchObject({ amount: 490, priceType: 'early', checkout: FORM });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('https://affiliate.test/api/payment/create');
    expect(fetchCalls[0].init.method).toBe('POST');
    expect(fetchCalls[0].init.headers).toMatchObject({ 'X-API-Key': 'test-api-key', 'X-Site-Code': 'IPAS' });
    const body = JSON.parse(fetchCalls[0].init.body as string);
    expect(body).toEqual({
      orderId: c.merTradeNo, amount: 490, currency: 'TWD', description: 'iPAS AI 應用規劃師中級考期通行證（2026-11-14 梯次）',
      email: 'buyer@example.com', buyerCountry: 'TW', buyerType: 'individual', siteCode: 'IPAS',
    });
    expect(body).not.toHaveProperty('periodParams');
    expect(s.rows('select status, amount_twd, price_type, consent_at from orders')).toEqual([{ status: 'pending', amount_twd: 490, price_type: 'early', consent_at: '2026-09-01T04:00:00.000Z' }]);
  });
  it('form checkout returns an auto-submit HTML page; form errors redirect to /pricing/', async () => {
    const s = await setup();
    mockAffiliate();
    const r = await s.api.form('/api/checkout', { sittingId: SITTING, consent: 'on' });
    expect(r.headers.get('content-type')).toContain('text/html');
    const html = await r.text();
    expect(html).toContain('action="https://sandbox-api.payuni.com.tw/api/upp"');
    expect(html).toContain('name="EncryptInfo" value="ab12"');
    const bad = await s.api.form('/api/checkout', { sittingId: SITTING });
    expect(bad.status).toBe(303);
    expect(bad.headers.get('location')).toBe('/pricing/?error=consent_required');
    const anon = await s.fetchApp('/api/checkout', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' }, body: 'sittingId=x&consent=on' });
    expect(anon.headers.get('location')).toBe('/login/?next=/pricing/');
  });
  it('is unavailable without payment secrets, and when affiliate rejects or returns no form', async () => {
    const h = harness({ env: { PAYMENT_API_KEY: undefined } });
    const api = h.client(await h.signIn('x@example.com'));
    expect((await api.post('/api/checkout', { sittingId: SITTING, consent: true })).status).toBe(503);
    const s = await setup();
    mockAffiliate(() => Response.json({ error: 'UNSUPPORTED_CURRENCY' }, { status: 400 }));
    const r = await s.api.post('/api/checkout', { sittingId: SITTING, consent: true });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'payment_unavailable' });
    mockAffiliate(() => Response.json({ success: true, paymentId: 'p', checkoutUrl: 'https://stripe.test' }));
    expect((await s.api.post('/api/checkout', { sittingId: SITTING, consent: true })).status).toBe(503);
    mockAffiliate(() => Response.json({ error: 'x' }, { status: 500 }));
    const f = await s.api.form('/api/checkout', { sittingId: SITTING, consent: 'on' });
    expect(f.headers.get('location')).toBe('/pricing/?error=payment_unavailable');
  });
  it('refuses checkout after the exam day', async () => {
    const s = await setup({ now: new Date('2026-11-14T16:00:00Z') });
    const r = await s.api.post('/api/checkout', { sittingId: SITTING, consent: true });
    expect(await r.json()).toEqual({ error: 'not_purchasable' });
  });
});

describe('affiliate payment webhook', () => {
  it('marks the order paid and creates the pass; /api/me shows the entitlement', async () => {
    const s = await setup();
    const c = await s.checkout();
    const r = await s.pay({ orderId: c.merTradeNo, amount: 490 });
    expect(r.status).toBe(200);
    expect(s.rows('select status, paid_at, payuni_trade_no from orders')).toEqual([{ status: 'paid', paid_at: '2026-09-01T04:00:00.000Z', payuni_trade_no: `T${c.merTradeNo}` }]);
    expect(s.rows('select level, valid_from, valid_until from passes')).toEqual([{ level: 'intermediate', valid_from: '2026-09-01T04:00:00.000Z', valid_until: '2026-12-14T15:59:59.999Z' }]);
    const me = await (await s.api.get('/api/me')).json() as { user: { email: string }; entitlements: unknown; passes: unknown[]; orders: { refund: unknown }[] };
    expect(me.user.email).toBe('buyer@example.com');
    expect(me.entitlements).toEqual({ intermediate: { paid: true, validUntil: '2026-12-14T15:59:59.999Z' }, beginner: { paid: false, validUntil: null } });
    expect(me.passes).toHaveLength(1);
    expect(me.orders[0].refund).toEqual({ eligible: true });
  });
  it('does not need an Origin header (server-to-server) and the signature is the only gate', async () => {
    const s = await setup();
    const c = await s.checkout();
    const raw = hookBody({ orderId: c.merTradeNo, amount: 490 });
    expect((await s.webhook(raw, { 'x-webhook-signature': sign(raw), origin: 'https://evil.example' })).status).toBe(200);
  });
  it('is idempotent for replays and concurrent deliveries', async () => {
    const s = await setup();
    const c = await s.checkout();
    const all = await Promise.all([1, 2, 3].map(() => s.pay({ orderId: c.merTradeNo, amount: 490 })));
    expect(all.map((r) => r.status)).toEqual([200, 200, 200]);
    s.clock.now = new Date('2026-09-02T00:00:00Z');
    expect((await s.pay({ orderId: c.merTradeNo, amount: 490 })).status).toBe(200);
    expect(s.rows('select count(*) as n from passes')).toEqual([{ n: 1 }]);
    expect(s.rows('select paid_at from orders')).toEqual([{ paid_at: '2026-09-01T04:00:00.000Z' }]);
  });
  it('rejects missing, wrong, tampered or unconfigured signatures with 401/503 and never touches the order', async () => {
    const s = await setup();
    const c = await s.checkout();
    const raw = hookBody({ orderId: c.merTradeNo, amount: 490 });
    expect((await s.webhook(raw, {})).status).toBe(401);
    expect((await s.webhook(raw, { 'x-webhook-signature': '0'.repeat(64) })).status).toBe(401);
    expect((await s.webhook(raw, { 'x-webhook-signature': sign(raw, 'other-secret') })).status).toBe(401);
    expect((await s.webhook(raw.replace('490', '1'), { 'x-webhook-signature': sign(raw) })).status).toBe(401);
    expect((await s.webhook('not json', { 'x-webhook-signature': sign('not json') })).status).toBe(401);
    expect(s.rows('select status from orders')).toEqual([{ status: 'pending' }]);
    expect(s.rows('select count(*) as n from passes')).toEqual([{ n: 0 }]);
    const u = harness({ env: { PAYMENT_WEBHOOK_SECRET: undefined } });
    expect((await u.fetchApp('/api/payment/affiliate/webhook', { method: 'POST', body: raw, headers: { 'x-webhook-signature': sign(raw) } })).status).toBe(503);
  });
  it('rejects amount mismatch and unknown orders (non-2xx so affiliate retries and the problem is visible)', async () => {
    const s = await setup();
    const c = await s.checkout();
    expect((await s.pay({ orderId: c.merTradeNo, amount: 1 })).status).toBe(400);
    expect((await s.pay({ orderId: 'IPUNKNOWN', amount: 490 })).status).toBe(400);
    expect(s.rows('select status from orders')).toEqual([{ status: 'pending' }]);
    expect(s.rows('select count(*) as n from passes')).toEqual([{ n: 0 }]);
  });
  it('ignores events that are not a one-time TWD payment result', async () => {
    const s = await setup();
    const c = await s.checkout();
    for (const extra of [{ type: 'RECURRING' }, { type: 'REFUND' }, { currency: 'USD' }, { status: 'PENDING' }]) {
      expect((await s.pay({ orderId: c.merTradeNo, amount: 490, extra })).status).toBe(200);
    }
    expect(s.rows('select status from orders')).toEqual([{ status: 'pending' }]);
    expect(s.rows('select count(*) as n from passes')).toEqual([{ n: 0 }]);
  });
  it('FAILED marks failed; a later SUCCESS (buyer retried on the PAYUNi page) still fulfils; a FAILED after paid does not downgrade', async () => {
    const s = await setup();
    const c = await s.checkout();
    await s.pay({ orderId: c.merTradeNo, amount: 490, status: 'FAILED' });
    expect(s.rows('select status from orders')).toEqual([{ status: 'failed' }]);
    await s.pay({ orderId: c.merTradeNo, amount: 490 });
    expect(s.rows('select status from orders')).toEqual([{ status: 'paid' }]);
    expect(s.rows('select count(*) as n from passes')).toEqual([{ n: 1 }]);
    await s.pay({ orderId: c.merTradeNo, amount: 490, status: 'FAILED' });
    expect(s.rows('select status from orders')).toEqual([{ status: 'paid' }]);
  });
  it('a second paid order for the same sitting is flagged for manual refund instead of a second pass', async () => {
    const s = await setup();
    const a = await s.checkout();
    const b = await s.checkout();
    await s.pay({ orderId: a.merTradeNo, amount: 490 });
    await s.pay({ orderId: b.merTradeNo, amount: 490 });
    expect(s.rows('select status, note from orders order by note')).toEqual([{ status: 'paid', note: null }, { status: 'paid', note: 'duplicate_pass' }]);
    expect(s.rows('select count(*) as n from passes')).toEqual([{ n: 1 }]);
    expect((await s.api.post('/api/checkout', { sittingId: SITTING, consent: true })).status).toBe(409);
  });
  it('the old direct PAYUNi routes are gone', async () => {
    const s = await setup();
    for (const p of ['/api/payuni/notify', '/api/payuni/return']) {
      const r = await s.fetchApp(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'EncryptInfo=00&HashInfo=00' });
      expect(r.status).toBe(404);
    }
  });
});

describe('renewal, refund, paid-feature usage', () => {
  async function paid() {
    const s = await setup();
    const c = await s.checkout();
    await s.pay({ orderId: c.merTradeNo, amount: 490 });
    return { ...s, orderId: c.orderId };
  }
  it('renewal price (中級 NT$390, 初級 NT$199) for the next sitting once a pass was paid', async () => {
    const s = await paid();
    s.db.raw.exec(`insert into exam_sittings (id, level, exam_date, name, sale_open, created_at) values ('intermediate-2027-05-22', 'intermediate', '2027-05-22', 'x', 1, 'x'), ('beginner-2027-03-20', 'beginner', '2027-03-20', 'y', 1, 'y')`);
    const j = await (await s.api.get('/api/pricing')).json() as { sittings: { id: string; owned: boolean; purchasable: boolean; quote: { priceType: string; amount: number } }[] };
    expect(j.sittings.map((x) => [x.id, x.owned, x.purchasable, x.quote.priceType, x.quote.amount])).toEqual([
      ['beginner-2026-11-07', false, true, 'renewal', 199],
      [SITTING, true, false, 'renewal', 390], // 已持有：不可再購買
      ['beginner-2027-03-20', false, true, 'renewal', 199],
      ['intermediate-2027-05-22', false, true, 'renewal', 390],
    ]);
    const c = await s.checkout('intermediate-2027-05-22');
    expect(c).toMatchObject({ amount: 390, priceType: 'renewal' });
  });
  it('refund request within 7 days with no paid feature used', async () => {
    const s = await paid();
    const r = await s.api.post('/api/refund-request', { orderId: s.orderId, reason: '買錯' });
    expect(r.status).toBe(200);
    expect(s.rows('select refund_reason from orders')).toEqual([{ refund_reason: '買錯' }]);
    const again = await s.api.post('/api/refund-request', { orderId: s.orderId });
    expect(await again.json()).toEqual({ error: 'already_requested' });
    expect((await s.api.post('/api/refund-request', { orderId: 'nope' })).status).toBe(404);
    expect((await s.api.post('/api/refund-request', { orderId: 5 })).status).toBe(400);
  });
  it('refund refused after 7 days', async () => {
    const s = await paid();
    s.clock.now = new Date('2026-09-08T04:00:00.001Z');
    expect(await (await s.api.post('/api/refund-request', { orderId: s.orderId })).json()).toEqual({ error: 'window_passed' });
  });
  it('first paid-feature use is recorded once and kills refund eligibility', async () => {
    const s = await paid();
    expect(await (await s.api.post('/api/usage/paid-feature', { level: 'beginner', feature: 'exam' })).json()).toEqual({ recorded: 0 });
    expect((await s.api.post('/api/usage/paid-feature', { level: 'intermediate', feature: 'noAds' })).status).toBe(400);
    // viewing-only features must not end eligibility, even if a client posts them
    for (const feature of ['wrongbook', 'weakness', 'plan']) expect((await s.api.post('/api/usage/paid-feature', { level: 'intermediate', feature })).status).toBe(400);
    expect(s.rows('select first_paid_feature_used_at from passes')).toEqual([{ first_paid_feature_used_at: null }]);
    expect(await (await s.api.post('/api/usage/paid-feature', { level: 'intermediate', feature: 'exam' })).json()).toEqual({ recorded: 1 });
    s.clock.now = new Date('2026-09-01T05:00:00Z');
    expect(await (await s.api.post('/api/usage/paid-feature', { level: 'intermediate', feature: 'full' })).json()).toEqual({ recorded: 0 });
    expect(s.rows('select first_paid_feature_used_at, first_paid_feature from passes')).toEqual([{ first_paid_feature_used_at: '2026-09-01T04:00:00.000Z', first_paid_feature: 'exam' }]);
    const me = await (await s.api.get('/api/me')).json() as { orders: { refund: unknown }[] };
    expect(me.orders[0].refund).toEqual({ eligible: false, reason: 'feature_used' });
    expect(await (await s.api.post('/api/refund-request', { orderId: s.orderId })).json()).toEqual({ error: 'feature_used' });
  });
  it('admin marks refunded: order refunded, pass revoked, entitlement gone, late notify ignored', async () => {
    const s = await paid();
    expect((await s.api.post(`/api/admin/orders/${s.orderId}/refunded`)).status).toBe(403);
    const h2 = { ...s, env: { ...s.env, ADMIN_EMAILS: 'owner@example.com' } };
    const adminCookie = await s.signIn('owner@example.com');
    s.db.raw.exec(`update "user" set "emailVerified" = 1 where email = 'owner@example.com'`);
    const r = await s.app.fetch(new Request(`${ORIGIN}/api/admin/orders/${s.orderId}/refunded`, { method: 'POST', headers: { cookie: adminCookie, origin: ORIGIN } }), h2.env);
    expect(r.status).toBe(200);
    expect(s.rows('select status from orders')).toEqual([{ status: 'refunded' }]);
    const me = await (await s.api.get('/api/me')).json() as { entitlements: { intermediate: { paid: boolean } } };
    expect(me.entitlements.intermediate.paid).toBe(false);
    const merTradeNo = (s.rows('select merchant_trade_no from orders')[0] as { merchant_trade_no: string }).merchant_trade_no;
    expect((await s.pay({ orderId: merTradeNo, amount: 490 })).status).toBe(200);
    expect(s.rows('select status from orders')).toEqual([{ status: 'refunded' }]);
    // 退款後不再算「曾購買」，續購價不適用
    const p = await (await s.api.get('/api/pricing')).json() as { sittings: { quote: { priceType: string } }[] };
    expect(p.sittings[0].quote.priceType).toBe('early');
  });
  it('rebuying the same sitting after a refund re-activates the revoked pass for the new order (atomic, idempotent, history kept)', async () => {
    const s = await paid();
    const adminCookie = await s.signIn('owner@example.com');
    s.db.raw.exec(`update "user" set "emailVerified" = 1 where email = 'owner@example.com'`);
    const env = { ...s.env, ADMIN_EMAILS: 'owner@example.com' };
    const refund = (id: string) => s.app.fetch(new Request(`${ORIGIN}/api/admin/orders/${id}/refunded`, { method: 'POST', headers: { cookie: adminCookie, origin: ORIGIN } }), env);
    await s.api.post('/api/usage/paid-feature', { level: 'intermediate', feature: 'exam' });
    expect((await refund(s.orderId)).status).toBe(200);
    expect(s.rows('select order_id, revoked_at is not null as revoked from passes')).toEqual([{ order_id: s.orderId, revoked: 1 }]);

    s.clock.now = new Date('2026-09-20T04:00:00.000Z');
    const again = await s.checkout(); // 檢查：退款後同一梯次允許再購買
    const results = await Promise.all([1, 2, 3].map(() => s.pay({ orderId: again.merTradeNo, amount: 490 })));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(s.rows('select order_id, valid_from, revoked_at, first_paid_feature_used_at, first_paid_feature from passes')).toEqual([
      { order_id: again.orderId, valid_from: '2026-09-20T04:00:00.000Z', revoked_at: null, first_paid_feature_used_at: null, first_paid_feature: null },
    ]);
    expect(s.rows('select id, status, paid_at, refunded_at, note from orders order by created_at, id').map((o) => [o.status, o.refunded_at !== null, o.note])).toEqual(
      expect.arrayContaining([['refunded', true, null], ['paid', false, null]]));
    const me = await (await s.api.get('/api/me')).json() as { entitlements: { intermediate: { paid: boolean } }; passes: { orderId: string; revokedAt: string | null }[]; orders: { id: string; status: string; refund: unknown }[] };
    expect(me.entitlements.intermediate.paid).toBe(true);
    expect(me.passes).toEqual([expect.objectContaining({ orderId: again.orderId, revokedAt: null })]);
    expect(me.orders.find((o) => o.id === s.orderId)).toMatchObject({ status: 'refunded' });
    expect(me.orders.find((o) => o.id === again.orderId)?.refund).toEqual({ eligible: true });
    // 重送不會改動
    s.clock.now = new Date('2026-09-21T00:00:00.000Z');
    await s.pay({ orderId: again.merTradeNo, amount: 490 });
    expect(s.rows('select valid_from from passes')).toEqual([{ valid_from: '2026-09-20T04:00:00.000Z' }]);
    // 第二次也能退款並再次重買
    expect((await refund(again.orderId)).status).toBe(200);
    expect(s.rows('select revoked_at is not null as revoked from passes')).toEqual([{ revoked: 1 }]);
    const third = await s.checkout();
    await s.pay({ orderId: third.merTradeNo, amount: 490 });
    expect(s.rows('select order_id, revoked_at from passes')).toEqual([{ order_id: third.orderId, revoked_at: null }]);
  });
});

describe('sync', () => {
  const sess = (id: string, submittedAt: string, subject: 1 | 11 = 1): Session => ({
    id, mode: 'practice', subject, startedAt: '2026-09-01T00:00:00.000Z', submittedAt, questionIds: ['q1', 'q2'], answers: [0, null], score: 50,
  });
  const stat = (attempts: number, wrong: number, lastWrongAt: string | null = null): QuestionStat => ({ attempts, correct: attempts - wrong, wrong, lastWrongAt, redoStreak: 0, inWrongBook: wrong > 0 });

  it('merges two devices into the account', async () => {
    const s = await setup();
    const a = await s.api.put('/api/sync', { schemaVersion: 1, sessions: [sess('s2', '2026-09-02T00:00:00.000Z'), sess('s1', '2026-09-01T01:00:00.000Z')], questionStats: { q1: stat(2, 1, '2026-09-01T01:00:00.000Z'), q2: stat(1, 0) } });
    expect(a.status).toBe(200);
    const b = await (await s.api.put('/api/sync', { schemaVersion: 1, sessions: [{ ...sess('s1', '2026-09-01T01:00:00.000Z'), score: 99 }, sess('s3', '2026-09-03T00:00:00.000Z', 11)], questionStats: { q1: stat(1, 1, '2026-09-05T00:00:00.000Z'), q2: stat(3, 1, '2026-09-04T00:00:00.000Z'), q3: stat(1, 0) } })).json() as { sessions: Session[]; questionStats: Record<string, QuestionStat> };
    expect(b.sessions.map((x) => [x.id, x.score, x.subject])).toEqual([['s1', 50, 1], ['s2', 50, 1], ['s3', 50, 11]]);
    expect(b.questionStats).toEqual({ q1: stat(2, 1, '2026-09-01T01:00:00.000Z'), q2: stat(3, 1, '2026-09-04T00:00:00.000Z'), q3: stat(1, 0) });
    const g = await (await s.api.get('/api/sync')).json();
    expect(g).toEqual({ schemaVersion: 1, ...b });
  });
  it('rejects invalid bodies and cross-origin writes', async () => {
    const s = await setup();
    expect((await s.api.put('/api/sync', { schemaVersion: 2, sessions: [], questionStats: {} })).status).toBe(400);
    const r = await s.api.put('/api/sync', { schemaVersion: 1, sessions: [{ ...sess('x', '2026-09-01T00:00:00.000Z'), score: 101 }], questionStats: {} });
    expect(r.status).toBe(400);
    expect((await r.json() as { message: string }).message).toContain('score');
    expect((await s.api.put('/api/sync', { schemaVersion: 1, sessions: [], questionStats: { q: { attempts: 2, correct: 0, wrong: 1, lastWrongAt: null, redoStreak: 0, inWrongBook: true } } })).status).toBe(400);
    const evil = await s.fetchApp('/api/sync', { method: 'PUT', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
    expect(evil.status).toBe(403);
  });
  it('handles large uploads (chunked under D1 parameter limits)', async () => {
    const s = await setup();
    const sessions = Array.from({ length: 300 }, (_, i) => sess(`s${String(i).padStart(4, '0')}`, `2026-09-01T00:${String(i % 60).padStart(2, '0')}:00.000Z`));
    const questionStats = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`q${i}`, stat(1, 0)]));
    const r = await s.api.put('/api/sync', { schemaVersion: 1, sessions, questionStats });
    expect(r.status).toBe(200);
    expect(s.rows('select count(*) as n from sync_sessions')).toEqual([{ n: 300 }]);
    expect(s.rows('select count(*) as n from sync_question_stats')).toEqual([{ n: 1000 }]);
  });
});
