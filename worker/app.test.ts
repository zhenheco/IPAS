import { describe, expect, it } from 'vitest';
import { PAID_FEATURES, countsAsPaidUse } from '../src/lib/entitlement';
import type { QuestionStat, Session } from '../src/lib/types';
import { PAID_USE_FEATURES } from './app';
import { decryptInfo, encryptInfo, hashInfo } from './payuni';
import { ORIGIN, PAYUNI, harness } from './test/harness';

const SITTING = 'intermediate-2026-11-14';
const KEY = PAYUNI.PAYUNI_HASH_KEY;
const IV = PAYUNI.PAYUNI_HASH_IV;

async function notifyBody(o: { merTradeNo: string; amount: number; tradeStatus?: string; status?: string; merId?: string }) {
  const data = { Status: o.status ?? 'SUCCESS', MerID: o.merId ?? PAYUNI.PAYUNI_MER_ID, MerTradeNo: o.merTradeNo, TradeNo: `T${o.merTradeNo}`, TradeAmt: o.amount, TradeStatus: o.tradeStatus ?? '1' };
  const EncryptInfo = await encryptInfo(data, KEY, IV);
  return new URLSearchParams({ Status: data.Status, MerID: data.MerID, Version: '2.0', EncryptInfo, HashInfo: await hashInfo(EncryptInfo, KEY, IV) }).toString();
}

async function setup(opts: Parameters<typeof harness>[0] = {}) {
  const h = harness(opts);
  const cookie = await h.signIn('buyer@example.com');
  const api = h.client(cookie);
  const notify = async (o: Parameters<typeof notifyBody>[0], path = '/api/payuni/notify') =>
    h.fetchApp(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: await notifyBody(o) });
  const checkout = async (sittingId = SITTING) => {
    const r = await api.post('/api/checkout', { sittingId, consent: true });
    const j = await r.json() as { orderId: string; amount: number; priceType: string; checkout: { action: string; fields: Record<string, string> } };
    if (r.status !== 200) throw new Error(JSON.stringify(j));
    const plain = await decryptInfo(j.checkout.fields.EncryptInfo, KEY, IV);
    return { ...j, merTradeNo: plain.MerTradeNo, plain };
  };
  const rows = (sql: string, ...p: (string | number)[]) => h.db.raw.prepare(sql).all(...p) as Record<string, unknown>[];
  return { ...h, api, notify, checkout, rows };
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
  it('creates a pending order priced server-side with consent recorded', async () => {
    const s = await setup();
    const c = await s.checkout();
    expect(c).toMatchObject({ amount: 490, priceType: 'early' });
    expect(c.checkout.action).toBe('https://sandbox-api.payuni.com.tw/api/upp');
    expect(c.plain).toMatchObject({ MerID: 'S01234567', TradeAmt: '490', UsrMail: 'buyer@example.com', NotifyURL: `${ORIGIN}/api/payuni/notify`, ReturnURL: `${ORIGIN}/api/payuni/return` });
    expect(s.rows('select status, amount_twd, price_type, consent_at from orders')).toEqual([{ status: 'pending', amount_twd: 490, price_type: 'early', consent_at: '2026-09-01T04:00:00.000Z' }]);
  });
  it('form checkout returns an auto-submit HTML page; form errors redirect to /pricing/', async () => {
    const s = await setup();
    const r = await s.api.form('/api/checkout', { sittingId: SITTING, consent: 'on' });
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(await r.text()).toContain('action="https://sandbox-api.payuni.com.tw/api/upp"');
    const bad = await s.api.form('/api/checkout', { sittingId: SITTING });
    expect(bad.status).toBe(303);
    expect(bad.headers.get('location')).toBe('/pricing/?error=consent_required');
    const anon = await s.fetchApp('/api/checkout', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' }, body: 'sittingId=x&consent=on' });
    expect(anon.headers.get('location')).toBe('/login/?next=/pricing/');
  });
  it('is unavailable without PAYUNi secrets', async () => {
    const h = harness({ env: { PAYUNI_MER_ID: undefined } });
    const api = h.client(await h.signIn('x@example.com'));
    expect((await api.post('/api/checkout', { sittingId: SITTING, consent: true })).status).toBe(503);
  });
  it('refuses checkout after the exam day', async () => {
    const s = await setup({ now: new Date('2026-11-14T16:00:00Z') });
    const r = await s.api.post('/api/checkout', { sittingId: SITTING, consent: true });
    expect(await r.json()).toEqual({ error: 'not_purchasable' });
  });
});

describe('PAYUNi notify', () => {
  it('marks the order paid and creates the pass; /api/me shows the entitlement', async () => {
    const s = await setup();
    const c = await s.checkout();
    const r = await s.notify({ merTradeNo: c.merTradeNo, amount: 490 });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('SUCCESS');
    expect(s.rows('select status, paid_at, payuni_trade_no from orders')).toEqual([{ status: 'paid', paid_at: '2026-09-01T04:00:00.000Z', payuni_trade_no: `T${c.merTradeNo}` }]);
    expect(s.rows('select level, valid_from, valid_until from passes')).toEqual([{ level: 'intermediate', valid_from: '2026-09-01T04:00:00.000Z', valid_until: '2026-12-14T15:59:59.999Z' }]);
    const me = await (await s.api.get('/api/me')).json() as { user: { email: string }; entitlements: unknown; passes: unknown[]; orders: { refund: unknown }[] };
    expect(me.user.email).toBe('buyer@example.com');
    expect(me.entitlements).toEqual({ intermediate: { paid: true, validUntil: '2026-12-14T15:59:59.999Z' }, beginner: { paid: false, validUntil: null } });
    expect(me.passes).toHaveLength(1);
    expect(me.orders[0].refund).toEqual({ eligible: true });
  });
  it('is idempotent for replays and concurrent deliveries', async () => {
    const s = await setup();
    const c = await s.checkout();
    const all = await Promise.all([1, 2, 3].map(() => s.notify({ merTradeNo: c.merTradeNo, amount: 490 })));
    expect(all.map((r) => r.status)).toEqual([200, 200, 200]);
    s.clock.now = new Date('2026-09-02T00:00:00Z');
    expect((await s.notify({ merTradeNo: c.merTradeNo, amount: 490 })).status).toBe(200);
    expect(s.rows('select count(*) as n from passes')).toEqual([{ n: 1 }]);
    expect(s.rows('select paid_at from orders')).toEqual([{ paid_at: '2026-09-01T04:00:00.000Z' }]);
  });
  it('rejects amount mismatch, unknown order, foreign merchant and bad signatures', async () => {
    const s = await setup();
    const c = await s.checkout();
    expect((await s.notify({ merTradeNo: c.merTradeNo, amount: 1 })).status).toBe(400);
    expect((await s.notify({ merTradeNo: 'IPUNKNOWN', amount: 490 })).status).toBe(400);
    expect((await s.notify({ merTradeNo: c.merTradeNo, amount: 490, merId: 'OTHER' })).status).toBe(400);
    const body = new URLSearchParams(await notifyBody({ merTradeNo: c.merTradeNo, amount: 490 }));
    body.set('HashInfo', '0'.repeat(64));
    expect((await s.fetchApp('/api/payuni/notify', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() })).status).toBe(400);
    expect(s.rows('select status from orders')).toEqual([{ status: 'pending' }]);
    expect(s.rows('select count(*) as n from passes')).toEqual([{ n: 0 }]);
  });
  it('an UNKNOWN / UNAPPROVED Status or TradeStatus 8 leaves the order pending, and the later success still fulfils', async () => {
    const s = await setup();
    const c = await s.checkout();
    await s.notify({ merTradeNo: c.merTradeNo, amount: 490, status: 'UNKNOWN', tradeStatus: '' });
    await s.notify({ merTradeNo: c.merTradeNo, amount: 490, status: 'unapproved', tradeStatus: '' });
    await s.notify({ merTradeNo: c.merTradeNo, amount: 490, tradeStatus: '8' });
    expect(s.rows('select status from orders')).toEqual([{ status: 'pending' }]);
    await s.notify({ merTradeNo: c.merTradeNo, amount: 490 });
    expect(s.rows('select status from orders')).toEqual([{ status: 'paid' }]);
  });
  it('failed payment marks failed; a later success on the same order still fulfils', async () => {
    const s = await setup();
    const c = await s.checkout();
    await s.notify({ merTradeNo: c.merTradeNo, amount: 490, tradeStatus: '2' });
    expect(s.rows('select status from orders')).toEqual([{ status: 'failed' }]);
    await s.notify({ merTradeNo: c.merTradeNo, amount: 490, tradeStatus: '0' });
    expect(s.rows('select status from orders')).toEqual([{ status: 'failed' }]);
    await s.notify({ merTradeNo: c.merTradeNo, amount: 490 });
    expect(s.rows('select status from orders')).toEqual([{ status: 'paid' }]);
    expect(s.rows('select count(*) as n from passes')).toEqual([{ n: 1 }]);
  });
  it('pending status (e.g. ATM 取號) leaves the order pending; a failure after paid does not downgrade', async () => {
    const s = await setup();
    const c = await s.checkout();
    await s.notify({ merTradeNo: c.merTradeNo, amount: 490, tradeStatus: '0' });
    expect(s.rows('select status from orders')).toEqual([{ status: 'pending' }]);
    await s.notify({ merTradeNo: c.merTradeNo, amount: 490 });
    await s.notify({ merTradeNo: c.merTradeNo, amount: 490, tradeStatus: '2' });
    expect(s.rows('select status from orders')).toEqual([{ status: 'paid' }]);
  });
  it('ReturnURL verifies, fulfils idempotently and redirects to the account page', async () => {
    const s = await setup();
    const c = await s.checkout();
    const r = await s.notify({ merTradeNo: c.merTradeNo, amount: 490 }, '/api/payuni/return');
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/account/?payment=paid');
    expect(s.rows('select count(*) as n from passes')).toEqual([{ n: 1 }]);
    const bad = await s.fetchApp('/api/payuni/return', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'EncryptInfo=00&HashInfo=00' });
    expect(bad.headers.get('location')).toBe('/account/?payment=error');
  });
  it('a second paid order for the same sitting is flagged for manual refund instead of a second pass', async () => {
    const s = await setup();
    const a = await s.checkout();
    const b = await s.checkout();
    await s.notify({ merTradeNo: a.merTradeNo, amount: 490 });
    await s.notify({ merTradeNo: b.merTradeNo, amount: 490 });
    expect(s.rows('select status, note from orders order by note')).toEqual([{ status: 'paid', note: null }, { status: 'paid', note: 'duplicate_pass' }]);
    expect(s.rows('select count(*) as n from passes')).toEqual([{ n: 1 }]);
    expect((await s.api.post('/api/checkout', { sittingId: SITTING, consent: true })).status).toBe(409);
  });
});

describe('renewal, refund, paid-feature usage', () => {
  async function paid() {
    const s = await setup();
    const c = await s.checkout();
    await s.notify({ merTradeNo: c.merTradeNo, amount: 490 });
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
    expect((await s.notify({ merTradeNo, amount: 490 })).status).toBe(400);
    expect(s.rows('select status from orders')).toEqual([{ status: 'refunded' }]);
    // 退款後不再算「曾購買」，續購價不適用
    const p = await (await s.api.get('/api/pricing')).json() as { sittings: { quote: { priceType: string } }[] };
    expect(p.sittings[0].quote.priceType).toBe('early');
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
